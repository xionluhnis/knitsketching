#include <emscripten.h>
#include <algorithm>
#include <limits.h>
#include <string>
#include <vector>
#include <stdio.h>

#include "../nlopt/src/api/nlopt.h"
#include "../nlopt/src/util/nlopt-util.h"
#include "build/nlopt.hpp"

typedef size_t index_t;

enum bound_t {
    FirstMin = 0,
    FirstMax,
    NextMin,
    NextMax,
    LastMin,
    LastMax
};

struct DynamicBoundConstraint {
    index_t index;
    bound_t type;
};

// inputs
static std::vector<double>  cdata;
static double               ns_start;
static double               ns_end;
static double               F = 2;
static double               iF = 0.5;
static double               w_c = 1;
static double               w_s = 0.1;

// nlopt config
static bool                 verbose = false;
static index_t              curr_iter = 0;
static nlopt::algorithm     main_algo = nlopt::AUGLAG;
static nlopt::algorithm     local_algo = nlopt::LD_LBFGS;
static bool                 use_constraints = true;
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

// forward declaration
double local_constraint_error(const std::vector<double> &);

double local_sampling(
    const std::vector<double>   &ns,
    std::vector<double>         &grad,
    void*                       f_data
){
    const size_t N = ns.size();
    double Ec = 0;
    double Es = 0;

    // simplicity with fixed first value
    first: {
        double diff = ns[0] - ns_start;
        Es += loss(diff);
        if(grad.size())
            grad[0] += w_s * 2 * diff;
    }

    // course errors (and possibly gradient)
    for(size_t i = 0; i < N; ++i){
        // course accuracy term
        accuracy: {
            double diff = ns[i] - cdata[i];
            Ec += loss(diff);
            if(grad.size() > 0){
                // course accuracy term
                grad[i] += w_c * 2 * diff;
            }
        }
        
        // simplicity term between variables
        if(i + 1 < N){
            double diff = ns[i] - ns[i+1];
            Es += loss(diff);
            if(grad.size()){
                grad[i+0] += w_s * 2 * diff;
                grad[i+1] -= w_s * 2 * diff; 
            }
        }
    }

    // simplicity with fixed last value
    last: {
        double diff = ns[N-1] - ns_end;
        Es += loss(diff);
        if(grad.size())
            grad[N-1] += w_s * 2 * diff;
    }
    
    // return objective value
    double E = Ec * w_c + Es * w_s;
    if(verbose && curr_iter){
        double ce = local_constraint_error(ns);
        printf("eval %zu: %g (cerr=%g)\n", curr_iter++, E, ce);
    }
    return E;
}

double local_constraint(
    const std::vector<double>   &ns,
    std::vector<double>         &grad,
    void*                       bnd_data
){
    DynamicBoundConstraint* nptr = static_cast<DynamicBoundConstraint*>(bnd_data);
    DynamicBoundConstraint &bound = *nptr;
    
    index_t i = bound.index;
    // note: iF = 1/F
    switch(bound.type){

        case FirstMin:
            // ns_start / F = ns_start * iF <= ns[0]
            // <=>
            // ns_start * iF - ns[0] <= 0 
            if(grad.size())
                grad[0] = -1.0;
            return ns_start * iF - ns[0];

        case FirstMax:
            // ns[0] <= ns_start * F
            // -ns_start * F + ns[0] <= 0
            if(grad.size())
                grad[0] = 1.0;
            return -ns_start * F + ns[0];

        case NextMin:
            // ns[i] / F <= ns[i+1]
            // ns[i] * iF - ns[i+1] <= 0
            if(grad.size()){
                grad[i] = iF;
                grad[i+1] = -1.0;
            }
            return ns[i] * iF - ns[i+1];

        case NextMax:
            // ns[i] * F >= ns[i+1]
            // ns[i+1] <= ns[i] * F
            // -ns[i] * F + ns[i+1] <= 0
            if(grad.size()){
                grad[i] = -F;
                grad[i+1] = 1.0;
            }
            return -ns[i] * F + ns[i+1];

        case LastMin:
            // ns[i] >= ns_end / F
            // ns_end * iF <= ns[i]
            // ns_end * iF - ns[i] <= 0
            if(grad.size())
                grad[i] = -1.0;
            return ns_end * iF - ns[i];

        case LastMax:
            // ns[i] <= ns_end * F
            // ns[i] - ns_end * F <= 0
            if(grad.size())
                grad[i] = 1.0;
            return ns[i] - ns_end * F;

        default:
            // should never reach here
            return std::numeric_limits<double>::quiet_NaN();
    }
}

std::vector<DynamicBoundConstraint> get_constraints(
    bool use_first = false,
    bool use_last  = false
){
    const size_t N = cdata.size();
    std::vector<DynamicBoundConstraint> constraints;
    if(use_first && use_last)
        constraints.resize(2*N+2);
    else if(use_first || use_last)
        constraints.resize(2*N);
    else
        constraints.resize(2*N-2);
    
    index_t c = 0;
    // first bounds
    if(use_first){
        constraints[c++] = { 0, FirstMin };
        constraints[c++] = { 0, FirstMax };
    }
    // next bounds
    for(index_t i = 0; i + 1 < N; ++i){
        constraints[c++] = { i, NextMin };
        constraints[c++] = { i, NextMax };
    }
    // last bounds
    if(use_last){
        constraints[c++] = { N-1, LastMin };
        constraints[c++] = { N-1, LastMax };
    }
    return constraints;
}

std::vector<double> local_constraint_errors(
    const std::vector<double> &ns
){
    const size_t N = ns.size();
    std::vector<DynamicBoundConstraint> constraints = get_constraints(true, true);
    std::vector<double> err(N * 2 + 2);
    for(index_t i = 0; i < N*2+2; ++i)
        err[i] = local_constraint(ns, nograd, &constraints[i]);
    return err;
}

double local_constraint_error(
    const std::vector<double> &ns
){
    std::vector<double> err = local_constraint_errors(ns);
    double sum = 0.0;
    for(double e : err)
        sum += e;
    return sum;
}

double local_constraint_max_error(
    const std::vector<double> &ns
){
    std::vector<double> err = local_constraint_errors(ns);
    double max = 0.0;
    for(double e : err)
        max = std::max(max, e);
    return max;
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

extern "C" {

    EMSCRIPTEN_KEEPALIVE
    void reset(){
        nvars.clear();
        cdata.clear();
    }

    EMSCRIPTEN_KEEPALIVE
    void allocate(size_t num_edges){
        reset();
        nvars.resize(num_edges);
        ngrad.resize(num_edges);
        cdata.resize(num_edges);
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
        opt.set_min_objective(local_sampling, NULL);
        
        // user defined
        if(main_ftol_rel){
            opt.set_ftol_rel(main_ftol_rel);
            debug("Using ftol_rel=%g\n", main_ftol_rel);
        }
        if(max_eval){
            opt.set_maxeval(max_eval);
            debug("Using max_eval=%u\n", max_eval);
        } else {
            opt.set_maxeval(1e3); // enforce some maximum number (to terminate)
            debug("Using default max_eval=%u\n", 1e3);
        }
        if(max_time){
            opt.set_maxtime(max_time);
            debug("Using maxtime=%g\n", max_time);
        }
        
        // set the problem bounds
        // and record initial value (based on cdata + bounds)
        std::vector<double> ns_min(n);
        std::vector<double> ns_max(n);
        for(index_t i = 0; i < n; ++i){
            double cw = cdata[i];
            // box around ns_start
            double nss_min = std::max(2.0, ns_start * std::pow(iF, i + 1));
            double nss_max = std::min(1e4, ns_start * std::pow(F, i + 1));
            // box around ns_end
            double nse_min = std::max(2.0, ns_end * std::pow(iF, n - i));
            double nse_max = std::min(1e4, ns_end * std::pow(F, n - i));
            // bounds (must be in intersection of two boxes)
            ns_min[i] = std::max(nss_min, nse_min);
            ns_max[i] = std::min(nss_max, nse_max);
            // initial solution within box
            if(cw < ns_min[i])
                cw = ns_min[i];
            else if(cw > ns_max[i])
                cw = ns_max[i];
            // else we're fine
            nvars[i] = cw;

            // debug
            debug("Using bounds[%d]: min=%g, max=%g, init=%g\n",
                i, ns_min[i], ns_max[i], nvars[i]);
        }
        opt.set_lower_bounds(ns_min);
        opt.set_upper_bounds(ns_max);

        // add equality constraints
        std::vector<DynamicBoundConstraint> constraints;
        if(use_constraints){
            // first and last are encoded in variable bounds
            // => no need to add additional constraints for those
            constraints = get_constraints(false, false);
            for(DynamicBoundConstraint &constr : constraints){
                opt.add_inequality_constraint(
                    local_constraint, &constr, constraint_tol
                );
            }
        }

        // perturb starting point with Gaussian noise
        if(gaussian_start){
            // perturb starting point with Gaussian noise
            for(index_t i = 0; i < nvars.size(); ++i){
                nvars[i] = std::max(
                    ns_min[i], std::min(
                    ns_max[i],
                    nvars[i] + nlopt_nrand(0.0, 1.0)
                ));
            }
        }
        
        if(verbose){
            std::vector<double> grad(n);
            double err0 = local_sampling(nvars, grad, NULL);
            printf("Initial error: %g\n", err0);
            for(index_t i = 0; i < n; ++i){
                printf("grad[%zu] = %g\n", i, grad[i]);
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
    void set_ns_start(double value){
        ns_start = value;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_ns_end(double value){
        ns_end = value;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_shaping(double shaping){
        F = std::max(1.01, std::min(2.0, shaping));
        iF = 1.0 / F;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_weights(double wc, double ws){
        w_c = wc;
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
    void set_use_constraints(bool u){
        use_constraints = u;
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
    double get_constraint_error(){
        return local_constraint_error(nvars);
    }
    EMSCRIPTEN_KEEPALIVE
    double get_constraint_max_error(){
        return local_constraint_max_error(nvars);
    }
    EMSCRIPTEN_KEEPALIVE
    double get_constraint_mean_error(){
        size_t N = nvars.size();
        size_t nc = 2*N+2;
        return nc == 0 ? 0 : get_constraint_error() / nc;
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
        max_err = std::max(max_err, error_of(local_sampling, NULL));
        // go over constraints
        std::vector<DynamicBoundConstraint> constraints = get_constraints(false, false);
        for(DynamicBoundConstraint &constr : constraints){
            max_err = std::max(max_err, error_of(
                local_constraint,
                static_cast<void *>(&constr)
            ));
        }
        
        if(print){
            printf("Gradient max relative error: %g for step %g\n", max_err, eps);
        }
        verbose = pre_verbose;
        return max_err;
    }

};