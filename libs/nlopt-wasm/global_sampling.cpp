#include <emscripten.h>
#include <algorithm>
#include <string>
#include <vector>
#include <stdio.h>

#include "../nlopt/src/api/nlopt.h"
#include "../nlopt/src/util/nlopt-util.h"
#include "build/nlopt.hpp"

typedef size_t index_t;

struct Node {
    index_t              index;
    bool                 simple;
    std::vector<index_t> inp_edges;
    std::vector<index_t> out_edges;

    inline bool has_interface_constraint() const {
        return inp_edges.size() > 0
            && out_edges.size() > 0
            && !simple;
    }

    inline bool has_range_constraint() const {
        return simple;
    }

    inline index_t inp() const {
        return inp_edges[0];
    }
    inline index_t out() const {
        return out_edges[0];
    }
};

struct VarAlias {
    index_t              index;
    std::vector<index_t> pos;
    std::vector<index_t> neg;
    double               min_bound;

    inline bool empty() const {
        return pos.empty() && neg.empty();
    }
    inline bool is_valid() const {
        // if we have a negative term,
        // then we need to have a positive one (else it's not a valid alias)
        return neg.empty() || !pos.empty();
    }
    inline bool has_constraint() const {
        // if aliased using negative terms,
        // then we need a constraint to ensure this alias is above the minimum bound
        return neg.size() > 1; 
    }
};

// inputs
static std::vector<double>  cdata;
static std::vector<double>  wdata;
static std::vector<double>  iwdata;
static std::vector<Node>    nodes;
static double               w_c = 1;
static double               w_s = 0.1;

// aliasing / reduction data
static std::vector<VarAlias>    aliases;
static bool                     aliased;
static std::vector<bool>        reduced;
static enum AliasingLevel {
    NONE    = 0,
    TRIVIAL = 1,
    BASIC   = 2,
    COMPLEX = 3,
    NUM_ALIASING_LEVELS = 4
}                               aliasing_level = NONE;
static std::vector<index_t>     redToAlias;     // map from reduced variable to alias
static std::vector<index_t>     aliasToRed;     // map from alias to reduced variable
static std::vector<double>      rvars;          // reduced variables

// nlopt config
static bool                 verbose = false;
static index_t              curr_iter = 0;
static nlopt::algorithm     main_algo = nlopt::AUGLAG_EQ;
static nlopt::algorithm     local_algo = nlopt::LD_LBFGS;
static bool                 use_constraints = true;
static double               main_ftol_rel = 0;
static size_t               max_eval = 1e3;
static double               max_time = 0.0;
static double               local_ftol_rel = 1e-3;
static double               constraint_tol = 1e-1;
static size_t               seed = 0xDEADBEEF;
static bool                 gaussian_start = false;
static bool                 global_shaping = false;

// outputs
static std::vector<double>  nvars;
static std::vector<double>  ngrad;
static double               objval;
static std::vector<double>  nograd;

inline double loss(double x){
    return x * x;
}

template<typename T>
inline void from_reduced_to_aliases(
    const std::vector<T> &rns,
    std::vector<T>       &ns
){
    // gather operation
    for(index_t i = 0; i < ns.size(); ++i){
        const VarAlias &alias = aliases[i];
        if(alias.empty()){
            // use data from matching variable directly
            ns[i] = rns[aliasToRed[i]];

        } else {
            // gather data from aliased variables
            T val = 0;
            for(index_t idx : alias.pos)
                val += rns[aliasToRed[idx]];
            for(index_t idx : alias.neg)
                val -= rns[aliasToRed[idx]];
            ns[i] = val;
        }
    }
}

template<typename T>
inline void from_aliases_to_reduced(
    const std::vector<T> &ns,
    std::vector<T>       &rns,
    bool                 rnsIsZeroed = false
){
    // reset output to zero if not already zeroed
    if(!rnsIsZeroed)
        rns.assign(rns.size(), T(0));
    // spread operation
    for(index_t i = 0; i < ns.size(); ++i){
        const VarAlias &alias = aliases[i];
        if(alias.empty()){
            // unaliased transfer
            rns[aliasToRed[i]] += ns[i];

        } else {
            for(index_t idx : alias.pos)
                rns[aliasToRed[idx]] += ns[i];
            for(index_t idx : alias.neg)
                rns[aliasToRed[idx]] -= ns[i];
        }
    }
    /*
    for(index_t i = 0; i < rns.size(); ++i)
        rns[i] = ns[redToAlias[i]]; // no gather, just direct copy
    */
}

template<typename T>
inline void set_reduced_from_aliases(
    const std::vector<T> &ns,
    std::vector<T>       &rns
){
    for(index_t i = 0; i < rns.size(); ++i)
        rns[i] = ns[redToAlias[i]]; // no gather, just direct copy
}

void compute_aliases(){
    if(aliased)
        return; // already done
    
    // reset aliases
    VarAlias noAlias;
    aliases.assign(aliases.size(), noAlias);
    for(index_t i = 0; i < aliases.size(); ++i)
        aliases[i].index = i;
    reduced.assign(reduced.size(), false);
    aliased = true;

    // compute aliases for the expected level
    if(aliasing_level == NONE)
        return; // nothing to do

    // go over nodes and find cases to reduce
    // /!\ this assumes the graph is bipartite with blue/green separation
    //     so that we can go over nodes and never create an aliasing conflict
    for(const Node &node: nodes){
        if(reduced[node.index]
        || !node.has_interface_constraint())
            continue; // already reduced, or nothing to do

        // else the node has a constraint
        size_t num_inp = node.inp_edges.size();
        size_t num_out = node.out_edges.size();

        // different situation depending on in/out and aliasing level
        if(num_inp == 1 && num_out == 1){
            // lowest level of aliasing
            // => create alias
            VarAlias &alias = aliases[node.out_edges[0]];
            alias.pos = node.inp_edges;

        } else if(num_inp == 1 || num_out == 1){
            // only alias if basic level or more
            if(aliasing_level < BASIC)
                continue; // skip
            // else, create alias
            if(num_inp == 1){
                // input is sum of outputs
                VarAlias &alias = aliases[node.inp_edges[0]];
                alias.pos = node.out_edges;

            } else {
                // output is sum of inputs
                VarAlias &alias = aliases[node.out_edges[0]];
                alias.pos = node.inp_edges;
            }

        } else if(aliasing_level == COMPLEX){
            // case n => m, with n,m>1
            // this is a complex aliasing case with additional constraint
            // we use the first output as alias
            VarAlias &alias = aliases[node.out_edges[0]];
            alias.pos = node.inp_edges;
            for(index_t i = 1; i < node.out_edges.size(); ++i)
                alias.neg.push_back(node.out_edges[i]);

        } else {
            // else no aliasing to be done
            continue;
        }
        // mark node as reduced
        reduced[node.index] = true;
    }

    // create mappings
    redToAlias.clear();
    aliasToRed.clear();
    for(const VarAlias &alias : aliases){
        index_t redIdx = redToAlias.size();
        if(alias.empty()){
            // variable in reduced formulation
            redToAlias.push_back(alias.index);
            aliasToRed.push_back(redIdx);

        } else {
            // aliased variable => not part of reduced problem (implicitly there)
            aliasToRed.push_back(std::numeric_limits<index_t>::max());
        }
    }

    // allocate reduced variables
    rvars.resize(redToAlias.size());
}

extern "C" {

    // forward declaration
    double global_constraint_error(const std::vector<double> &);

    double global_sampling(
        const std::vector<double>   &ns,
        std::vector<double>         &grad,
        void*                       f_data
    ){
        double Ec = 0;
        double Es = 0;

        // course errors (and possibly gradient)
        if(grad.size() > 0){
            for(size_t i = 0, n = cdata.size(); i < n; ++i){
                Ec += loss(ns[i] - cdata[i]);
                grad[i] = w_c * 2 * (ns[i] - cdata[i]);
            }
        } else {
            for(size_t i = 0, n = cdata.size(); i < n; ++i)
                Ec += loss(ns[i] - cdata[i]);
        }

        // node errors (wales + singularity)
        for(const Node &node : nodes){
            if(!node.simple
            || node.inp_edges.empty()
            || node.out_edges.empty())
                continue; // no error associated

            // green node with inputs + outputs
            double inp = 0;
            double out = 0;
            for(index_t idx : node.inp_edges)
                inp += ns[idx];
            for(index_t idx : node.out_edges)
                out += ns[idx];

            double diff = inp - out;
            double range = std::abs(diff);
            Es += loss(range);

            // gradient
            if(grad.empty())
                continue; // skip
            // add gradients of penalties on green nodes
            // d(diff)/dns_i = 1 for i in inpVar
            //               = -1 for i in outVar
            //               = 0 otherwise
            // d(range)/dns_i = d(diff)/dns_i if diff >= 0
            //                = -d(diff)/dns_i if diff < 0
            //                = sign(diff) * d(diff)/dns_i

            // Es = Es + range.^2;
            // d(Es)/dns_i
            // = 2 * range * d(range)/dns_i
            // = 2 * range * sign(diff) * d(diff)/dns_i
            //    /!\ range*sign(diff)=diff
            // = 2 * diff * d(diff)/dns_i
            // = { 2 * diff for i in inpIdx
            //     -2* diff for i in outIdx
            //       0 otherwise
            const double s_grad = w_s * 2 * diff;
            for(index_t idx : node.inp_edges)
                grad[idx] += s_grad;
            for(index_t idx : node.out_edges)
                grad[idx] -= s_grad;
        }

        // return objective value
        double E = Ec * w_c + Es * w_s;
        if(verbose && curr_iter){
            double ce = global_constraint_error(ns);
            printf("eval %zu: %g (cerr=%g)\n", curr_iter++, E, ce);
        }
        return E;
    }

    double global_reduced_sampling(
        const std::vector<double>   &rns,
        std::vector<double>         &rgrad,
        void*                       f_data
    ){
        // compute unreduced variable values
        from_reduced_to_aliases(rns, nvars);

        // simple case without gradient
        if(rgrad.empty())
            return global_sampling(nvars, nograd, f_data);

        // case with gradient (needs map back)
        double E = global_sampling(nvars, ngrad, f_data);

        // map gradient back
        from_aliases_to_reduced(ngrad, rgrad);

        // return error
        return E;
    }

    double global_interface_constraint(
        const std::vector<double>   &ns,
        std::vector<double>         &grad,
        void*                       eq_data
    ){
        Node* nptr = static_cast<Node*>(eq_data);
        Node &node = *nptr;
        
        double value = 0.0;
        // go over inputs
        for(const index_t &idx : node.inp_edges){
            value += ns[idx];
            if(grad.size() > 0)
                grad[idx] = 1;
        }
        // go over outputs
        for(const index_t &idx : node.out_edges){
            value -= ns[idx];
            if(grad.size() > 0)
                grad[idx] = -1;
        }

        return value;
    }

    double global_reduced_constraint(
        const std::vector<double>   &rns,
        std::vector<double>         &rgrad,
        void*                       eq_data
    ){
        // compute unreduced variable values
        from_reduced_to_aliases(rns, nvars);

        // simple case without gradient
        if(rgrad.empty())
            return global_interface_constraint(nvars, nograd, eq_data);

        // case with gradient (needs map back)
        double E = global_interface_constraint(nvars, ngrad, eq_data);

        // map gradient back
        from_aliases_to_reduced(ngrad, rgrad);

        // return error
        return E;
    }

    double global_alias_constraint(
        const std::vector<double>   &rns,
        std::vector<double>         &rgrad,
        void*                       a_data
    ){
        VarAlias* aptr = static_cast<VarAlias*>(a_data);
        VarAlias &alias = *aptr;

        // constraint: 
        //  sum(ns[pos]) - sum(ns[neg]) >= min_bound
        // <=>
        //  res = min_bound + sum(ns[neg]) - sum(ns[pos]) <= 0

        double res = alias.min_bound;
        // go over positive counts
        for(const index_t &idx : alias.pos){
            res -= rns[aliasToRed[idx]];
            if(rgrad.size() > 0)
                rgrad[aliasToRed[idx]] -= 1;
        }
        // go over negative counts
        for(const index_t &idx : alias.neg){
            res += rns[aliasToRed[idx]];
            if(rgrad.size() > 0)
                rgrad[aliasToRed[idx]] += 1;
        }
        return res;
    }

    double global_urange_constraint(
        const std::vector<double>   &ns,
        std::vector<double>         &grad,
        void*                       r_data
    ){
        Node* nptr = reinterpret_cast<Node*>(r_data);
        Node &node = *nptr;
        index_t inp = node.inp();
        index_t out = node.out();

        // constraint: 
        //  ns[node.inp()] <= ns[node.out()] * wdata[node.index]
        // <=>
        //  ns[node.inp()] - ns[node.out()] * wdata[node.index] <= 0
        double res = ns[inp] - ns[out] * wdata[node.index];
        if(grad.size()){
            grad[inp] += 1;
            grad[out] -= wdata[node.index];
        }
        return res;
    }

    double global_lrange_constraint(
        const std::vector<double>   &ns,
        std::vector<double>         &grad,
        void*                       r_data
    ){
        Node* nptr = reinterpret_cast<Node*>(r_data);
        Node &node = *nptr;
        index_t inp = node.inp();
        index_t out = node.out();

        // constraint: 
        //  ns[node.inp()] >= ns[node.out()] / wdata[node.index]
        // <=>
        //  ns[node.inp()] >= ns[node.out()] * iwdata[node.index]
        // <=>
        //  ns[node.out()] * iwdata[node.index] - ns[node.inp()] <= 0
        double res = ns[out] * iwdata[node.index] - ns[inp];
        if(grad.size()){
            grad[inp] -= 1;
            grad[out] += iwdata[node.index];
        }
        return res;
    }

    double global_constraint_error(
        const std::vector<double> &ns
    ){
        double err = 0;
        for(Node &node : nodes){
            if(node.has_interface_constraint()){
                err += std::abs(
                    global_interface_constraint(ns, nograd, &node)
                );
                // printf("n#%zu: %g\n", node.index, err);
            } else if(global_shaping && node.has_range_constraint()){
                err += std::abs(
                    global_urange_constraint(ns, nograd, &node)
                ) + std::abs(
                    global_lrange_constraint(ns, nograd, &node)
                );
            }
        }
        return err;
    }

    double global_constraint_max_error(
        const std::vector<double> &ns
    ){
        double max_err = 0;
        for(Node &node : nodes){
            if(node.has_interface_constraint()){
                max_err = std::max(max_err, std::abs(
                    global_interface_constraint(ns, nograd, &node)
                ));
                // printf("n#%zu: %g\n", node.index, err);
            } else if(global_shaping && node.has_range_constraint()){
                max_err = std::max(max_err, std::abs(
                    global_urange_constraint(ns, nograd, &node)
                ));
                max_err = std::max(max_err, std::abs(
                    global_lrange_constraint(ns, nograd, &node)
                ));
            }
        }
        return max_err;
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

    EMSCRIPTEN_KEEPALIVE
    void reset(){
        nvars.clear();
        cdata.clear();
        aliases.clear();
        reduced.clear();
        wdata.clear();
        iwdata.clear();
        nodes.clear();
        aliased = false;
    }

    EMSCRIPTEN_KEEPALIVE
    void allocate(size_t num_edges, size_t num_nodes){
        reset();
        nvars.resize(num_edges);
        ngrad.resize(num_edges);
        cdata.resize(num_edges);
        aliases.resize(num_edges);
        wdata.resize(num_nodes);
        iwdata.resize(num_nodes);
        nodes.resize(num_nodes);
        reduced.resize(num_nodes);
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

        // recompute aliasing
        compute_aliases();
        if(aliasing_level > NONE)
            debug("Aliasing: from %u to %u variables\n", nvars.size(), rvars.size());

        // reset iter number
        curr_iter = 0;

        // create nlopt optimizer(s)
        const size_t n = aliasing_level == NONE ? nvars.size() : rvars.size();
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
        nlopt::vfunc objective_func;
        if(aliasing_level == NONE)
            objective_func = global_sampling;
        else
            objective_func = global_reduced_sampling;
        opt.set_min_objective(objective_func, NULL);
        
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
        double min_bound = 1e3;
        double max_bound = 2;
        for(const double &val : cdata){
            min_bound = std::min(min_bound, std::floor(val * 0.5));
            max_bound = std::max(max_bound, std::ceil(val * 2.0));
        }
        min_bound = std::max(2.0, min_bound);
        opt.set_lower_bounds(min_bound);
        opt.set_upper_bounds(max_bound);
        debug("Using bounds: min=%g, max=%g\n\n", min_bound, max_bound);

        // add equality constraints
        if(use_constraints){
            nlopt::vfunc constraint_func;
            if(aliasing_level == NONE)
                constraint_func = global_interface_constraint;
            else
                constraint_func = global_reduced_constraint;
            
            // unreduced node constraints
            for(Node &node : nodes){
                if(node.has_interface_constraint()
                && !reduced[node.index]){
                    opt.add_equality_constraint(
                        constraint_func, &node, constraint_tol
                    );
                    debug("Constraint on node #%u (#inp=%u, #out=%u)\n",
                        node.index,
                        node.inp_edges.size(),
                        node.out_edges.size()
                    );
                }
            }
            // complex aliasing reductions
            for(VarAlias &alias : aliases){
                if(alias.has_constraint()){
                    alias.min_bound = min_bound;
                    opt.add_inequality_constraint(
                        global_alias_constraint, &alias, constraint_tol
                    );
                    debug("Constraint on alias #%u (#pos=%u, #neg=%u) > %g\n",
                        alias.index,
                        alias.pos.size(),
                        alias.neg.size(),
                        min_bound
                    );
                }
            }
        }
        if(global_shaping){
            for(Node &node : nodes){
                if(node.has_range_constraint()){
                    opt.add_inequality_constraint(
                        global_urange_constraint, &node, constraint_tol
                    );
                    opt.add_inequality_constraint(
                        global_lrange_constraint, &node, constraint_tol
                    );
                    debug("Range constraints on node #%u (#inp=%u, #out=%u, w=%g, iw=%g)\n",
                        node.index,
                        node.inp(),
                        node.out(),
                        wdata[node.index],
                        iwdata[node.index]
                    );
                }
            }
        }

        // use cdata as initial guess
        nvars.assign(cdata.begin(), cdata.end());
        if(gaussian_start){
            // perturb starting point with Gaussian noise
            for(index_t i = 0; i < nvars.size(); ++i){
                nvars[i] = std::max(
                    min_bound, std::min(
                    max_bound,
                    nvars[i] + nlopt_nrand(0.0, 1.0)
                ));
            }
        }
        // transfer to reduced variables if aliasing
        if(aliasing_level > NONE){
            set_reduced_from_aliases(nvars, rvars);
        }
        if(verbose){
            std::vector<double> grad(cdata.size());
            double err0 = global_sampling(nvars, grad, NULL);
            printf("Initial error: %g\n", err0);
            for(index_t i = 0; i < grad.size(); ++i){
                printf("grad[%zu] = %g\n", i, grad[i]);
            }
            if(aliasing_level > NONE){
                std::vector<double> rgrad(rvars.size());
                double rerr0 = global_reduced_sampling(rvars, rgrad, NULL);
                printf("Initial reduced error: %g\n", rerr0);
                for(index_t i = 0; i < rgrad.size(); ++i){
                    printf("rgrad[%zu] = %g\n", i, rgrad[i]);
                }
            }
        }

        int rc = 0;

        // perform optimization
        try {
            curr_iter = 1; // start considering iterations
            nlopt::result res;
            if(aliasing_level == NONE)
                res = opt.optimize(nvars, objval);
            else {
                res = opt.optimize(rvars, objval);
                // store full variable content
                from_reduced_to_aliases(rvars, nvars);
            }

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
    void set_cdata(index_t index, float value){
        cdata[index] = value;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_wdata(index_t index, float value){
        wdata[index] = value;
        iwdata[index] = 1.0/value;
    }
    EMSCRIPTEN_KEEPALIVE
    void allocate_node(index_t index, bool simple, size_t num_inputs, size_t num_outputs){
        nodes[index].index = index;
        nodes[index].simple = simple;
        nodes[index].inp_edges.resize(num_inputs);
        nodes[index].out_edges.resize(num_outputs);
        // invalidate aliasing
        aliased = false;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_node_input(index_t node_index, index_t index, index_t edge_index){
        nodes[node_index].inp_edges[index] = edge_index;
        // invalidate aliasing
        aliased = false;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_node_output(index_t node_index, index_t index, index_t edge_index){
        nodes[node_index].out_edges[index] = edge_index;
        // invalidate aliasing
        aliased = false;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_weights(double wc, double ws){
        w_c = wc;
        w_s = ws;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_global_shaping(bool gs){
        global_shaping = gs;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_aliasing_level(index_t level){
        aliasing_level = static_cast<AliasingLevel>(level);
        aliased = false; // aliasing must be recomputed
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
    size_t get_num_constraints(){
        size_t num_constraints = 0;
        for(const Node &node : nodes){
            if(node.has_interface_constraint())
                ++num_constraints;
            else if(global_shaping && node.has_range_constraint())
                num_constraints += 2; // upper and lower
        }
        return num_constraints;
    }
    EMSCRIPTEN_KEEPALIVE
    double get_constraint_error(){
        return global_constraint_error(nvars);
    }
    EMSCRIPTEN_KEEPALIVE
    double get_constraint_max_error(){
        return global_constraint_max_error(nvars);
    }
    EMSCRIPTEN_KEEPALIVE
    double get_constraint_mean_error(){
        size_t nc = get_num_constraints();
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
        max_err = std::max(max_err, error_of(global_sampling, NULL));
        for(Node &node : nodes){
            if(node.has_interface_constraint()){
                max_err = std::max(max_err, error_of(
                    global_interface_constraint,
                    static_cast<void *>(&node)
                ));
            } else if(global_shaping && node.has_range_constraint()){
                max_err = std::max(max_err, error_of(
                    global_urange_constraint,
                    static_cast<void *>(&node)
                ));
                max_err = std::max(max_err, error_of(
                    global_lrange_constraint,
                    static_cast<void *>(&node)
                ));
            }
        }
        
        if(print){
            printf("Gradient max relative error: %g for step %g\n", max_err, eps);
        }
        verbose = pre_verbose;
        return max_err;
    }

};