#include <emscripten.h>
#include <emscripten/bind.h> 
#include <algorithm>
#include <limits.h>
#include <string>
#include <vector>
#include <stdio.h>

#include "../nlopt/src/api/nlopt.h"
#include "../nlopt/src/util/nlopt-util.h"
#include "build/nlopt.hpp"

typedef size_t index_t;

// inputs
static std::vector<double>  cdata;
static bool                 circular;
static bool                 simp_L2 = true;
static double               w_w = 1;
static double               w_s = 0.1;

// nlopt config
static bool                 verbose = false;
static index_t              curr_iter = 0;
static nlopt::algorithm     main_algo = nlopt::LD_LBFGS;
static nlopt::algorithm     local_algo = nlopt::LD_LBFGS;
static double               main_ftol_rel = 0;
static size_t               max_eval = 1e3;
static double               max_time = 0.0;
static double               local_ftol_rel = 1e-3;
static double               constraint_tol = 1e-1;
static size_t               seed = 0xDEADBEEF;
static bool                 gaussian_start = false;

// outputs
static std::vector<double>  nvars;
static std::vector<double>  ngrad;
static double               objval;
static std::vector<double>  nograd;

inline double loss(double x){
    return x * x;
}

inline double simplicity(
    const std::vector<double>   &ns,
    std::vector<double>         &grad,
    size_t i0, size_t i1
){
    double diff = ns[i0] - ns[i1];
    if(simp_L2){
        // L2 simplicity
        // dEs = (ns[i0] - ns[i1])^2
        if(grad.size()){
            grad[i0] += w_s * 2 * diff;
            grad[i1] -= w_s * 2 * diff; 
        }
        return loss(diff);

    } else {
        // L1 simplicity
        // dEs = |ns[i0] - ns[i1]|
        double sign = diff >= 0 ? 1 : -1;
        if(grad.size()){
            grad[i0] = w_s * sign;
            grad[i1] = -w_s * sign;
        }
        return sign * diff;
    }
}

double rs_sampling(
    const std::vector<double>   &ns,
    std::vector<double>         &grad,
    void*                       f_data
){
    const size_t N = ns.size();
    double Ew = 0;
    double Es = 0;

    // wale errors (and possibly gradient)
    for(size_t i = 0; i < N; ++i){
        // course accuracy term
        double diff = ns[i] - cdata[i];
        Ew += loss(diff);
        if(grad.size() > 0){
            // course accuracy term
            grad[i] += w_w * 2 * diff;
        }
        
        // simplicity term between adjacent variables
        if(i > 0){
            Es += simplicity(ns, grad, i, i - 1);
        }
    }
    // circular simplicity term
    if(circular){
        Es += simplicity(ns, grad, 0, N - 1);
    }
    
    // return objective value
    double E = Ew * w_w + Es * w_s;
    if(verbose && curr_iter){
        printf("eval %zu: %g (Ew=%g, Es=%g)\n", curr_iter++, E, Ew, Es);
    }
    return E;
}

double get_gradient_error(
    const std::vector<double> ns,
    nlopt::vfunc f, void *f_data,
    double epsilon,
    bool relative = true
){
    double max_err = 0;
    // compute analytical gradient
    std::vector<double> grad_ana(ns.size());
    f(ns, grad_ana, f_data);

    // compute numerical gradients for each dimension
    // and accumulate error per dimension
    std::vector<double> ns_delta = ns; // copy
    for(index_t i = 0; i < cdata.size(); ++i){
        // plus value
        ns_delta[i] = ns[i] + epsilon;
        double f_p = f(ns_delta, nograd, f_data);
        // minus value
        ns_delta[i] = ns[i] - epsilon;
        double f_n = f(ns_delta, nograd, f_data);

        // reset ns_delta to ns
        ns_delta[i] = ns[i];
        
        // compute numerical gradient
        double grad_num = (f_p - f_n) / (2 * epsilon);
        
        // get absolute error
        double abs_err = std::abs(grad_ana[i] - grad_num);
        if(!relative){
            max_err = std::max(max_err, abs_err);

        } else {
            // get relative error
            double rel_err;
            if(grad_ana[i] > 1e-8)
                rel_err = abs_err / grad_ana[i];
            else
                rel_err = abs_err;
            max_err = std::max(max_err, rel_err);
        }
    }
    return max_err;
}

std::string getExceptionMessage(intptr_t exceptionPtr) {
    return std::string(reinterpret_cast<std::exception *>(exceptionPtr)->what());
}

EMSCRIPTEN_BINDINGS(Bindings) {
  emscripten::function("getExceptionMessage", &getExceptionMessage);
};

extern "C" {

    EMSCRIPTEN_KEEPALIVE
    void reset(){
        nvars.clear();
        cdata.clear();
    }

    EMSCRIPTEN_KEEPALIVE
    void allocate(size_t num_samples){
        reset();
        nvars.resize(num_samples);
        ngrad.resize(num_samples);
        cdata.resize(num_samples);
    }

    void set_nlopt_defaults(nlopt::opt &opt){
        opt.set_population(0);
        opt.set_initial_step(1.0);
        opt.set_stopval(-HUGE_VAL);
        opt.set_ftol_abs(0.0);
        opt.set_xtol_rel(0.0);
        opt.set_xtol_abs(0.0);
        opt.set_x_weights(1.0);
        opt.set_vector_storage(0);
    }

    // call solver and return its return code
    EMSCRIPTEN_KEEPALIVE
    int solve(bool verbose = false){
        // local debug function
        const auto debug = [&verbose](auto&& ...args){
            if(!verbose)
                return;
            printf(args...);
        };

        // reset seed
        nlopt::srand(seed);

        // reset iter number
        curr_iter = 0;

        // create nlopt optimizer(s)
        const size_t n = nvars.size();
        nlopt::opt opt(main_algo, n);
        nlopt::opt local_opt(local_algo, n);

        // defaults
        set_nlopt_defaults(opt);
        set_nlopt_defaults(local_opt);

        debug("Using algorithm: %s\n", opt.get_algorithm_name());

        // register local optimizer
        if(main_algo >= nlopt::AUGLAG){
            // set relative tolerance
            local_opt.set_ftol_rel(local_ftol_rel);
            // set local optimizer
            opt.set_local_optimizer(local_opt);

            debug("Using local optimizer: %s with ftol_rel=%g\n",
                local_opt.get_algorithm_name(),
                local_ftol_rel
            );
        }

        // set optimizer parameters
        opt.set_min_objective(rs_sampling, NULL);
        
        // user defined
        if(main_ftol_rel){
            opt.set_ftol_rel(main_ftol_rel);
            debug("Using ftol_rel=%g\n", main_ftol_rel);
        }
        if(max_eval){
            opt.set_maxeval(max_eval);
            debug("Using max_eval=%u\n", max_eval);
        } else {
            opt.set_maxeval(1e2); // enforce some maximum number (to terminate)
            debug("Using default max_eval=%u\n", 1e2);
        }
        if(max_time){
            opt.set_maxtime(max_time);
            debug("Using maxtime=%g\n", max_time);
        }
        
        // set the problem lower bound and initial values
        opt.set_lower_bounds(0);
        for(index_t i = 0; i < n; ++i){
            nvars[i] = std::max(0.0, cdata[i]);
        }

        // perturb starting point with Gaussian noise
        if(gaussian_start){
            // perturb starting point with Gaussian noise
            for(index_t i = 0; i < nvars.size(); ++i){
                nvars[i] = std::max(
                    0.0,
                    nvars[i] + nlopt_nrand(0.0, 1.0)
                );
            }
        }
        
        if(verbose){
            std::vector<double> grad(n);
            double err0 = rs_sampling(nvars, grad, NULL);
            printf("Initial error: %g\n", err0);
            for(index_t i = 0; i < n; ++i){
                printf("rs[%zu] = %g, grad[%zu] = %g\n", i, nvars[i], i, grad[i]);
            }
        }

        int rc = 0;

        // perform optimization
        try {
            curr_iter = 1; // start considering iterations
            nlopt::result res = opt.optimize(nvars, objval);

            debug("Solved after %u iterations\n", opt.get_numevals());

            // return the result code as an integer
            // + positive: success
            //  1 = generic success
            //  2 = stopval reached
            //  3 = ftol reached
            //  4 = xtol reached
            //  5 = maxeval reached
            //  6 = maxtime reached
            // - negative: error
            //  -1 = generic failure
            //  -2 = invalid argument (e.g. bounds or algorithm)
            //  -3 = out-of-memory
            //  -4 = roundoff errors limiting progress
            //  -5 = forced stop
            rc = static_cast<int>(res);

        } catch (const std::exception& ex) {
            printf("\nException(ex): %s\n", ex.what());
            printf("Message: %s\n", opt.get_errmsg());
            printf("After %u iterations\n", opt.get_numevals());

        } catch (const std::string& ex) {
            printf("\nException(str): %s\n", ex.c_str());
            printf("Message: %s\n", opt.get_errmsg());
            printf("After %u iterations\n", opt.get_numevals());

        } catch (...) {
            printf("\nUnknown exception\n");
            printf("Message: %s\n", opt.get_errmsg());
            printf("After %u iterations\n", opt.get_numevals());
        }

        return rc;
    }

    // input setters
    EMSCRIPTEN_KEEPALIVE
    void set_cdata(index_t index, double value){
        cdata[index] = value;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_circular(bool c){
        circular = c;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_simplicity_power(int power){
        switch(power){
            case 1:
                simp_L2 = false;
                break;
            case 2:
                simp_L2 = true;
                break;
            default:
                printf("Power not supported: %d\n", power);
                break;
        }
    }
    EMSCRIPTEN_KEEPALIVE
    void set_weights(double ww, double ws){
        w_w = ww;
        w_s = ws;
    }

    // nlopt setters/getters
    EMSCRIPTEN_KEEPALIVE
    void set_seed(int s){
        seed = s;
    }
    EMSCRIPTEN_KEEPALIVE
    void use_noise(bool noise){
        gaussian_start = noise;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_verbose(bool v){
        verbose = v;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_main_algorithm(int algo){
        main_algo = static_cast<nlopt::algorithm>(algo);
    }
    EMSCRIPTEN_KEEPALIVE
    int get_main_algorithm(){
        return static_cast<int>(main_algo);
    }
    EMSCRIPTEN_KEEPALIVE
    void set_local_algorithm(int algo){
        local_algo = static_cast<nlopt::algorithm>(algo);
    }
    EMSCRIPTEN_KEEPALIVE
    int get_local_algorithm(){
        return static_cast<int>(local_algo);
    }
    EMSCRIPTEN_KEEPALIVE
    void print_algorithm_list(){
        const index_t n = static_cast<index_t>(nlopt::NUM_ALGORITHMS);
        for(index_t i = 0; i < n; ++i){
            auto algo = static_cast<nlopt::algorithm>(i);
            printf("%2zu: %s\n", i, nlopt::algorithm_name(algo));
        }
    }
    EMSCRIPTEN_KEEPALIVE
    void set_max_eval(size_t n){
        max_eval = n;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_max_time(double t){
        max_time = t;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_main_ftol_rel(double tol){
        main_ftol_rel = tol;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_local_ftol_rel(double tol){
        local_ftol_rel = tol;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_constraint_tol(double tol){
        constraint_tol = tol;
    }

    // output reading functions
    EMSCRIPTEN_KEEPALIVE
    size_t get_variable_number(){
        return nvars.size();
    }
    EMSCRIPTEN_KEEPALIVE
    double get_variable_value(index_t index){
        return nvars[index];
    }
    EMSCRIPTEN_KEEPALIVE
    double get_objective_value(){
        return objval;
    }
    EMSCRIPTEN_KEEPALIVE
    double check_gradient(bool print = true, double eps = 1e-4){
        bool pre_verbose = verbose;
        verbose = false; // disable so we can evaluate without info
        const auto error_of = [&eps](nlopt::vfunc f, void* f_data){
            return std::max(
                get_gradient_error(cdata, f, f_data, eps, true),
                get_gradient_error(nvars, f, f_data, eps, true)
            );
        };
        double max_err = 0;
        // go over functions
        max_err = std::max(max_err, error_of(rs_sampling, NULL));
        
        if(print){
            printf("Gradient max relative error: %g for step %g\n", max_err, eps);
        }
        verbose = pre_verbose;
        return max_err;
    }

};