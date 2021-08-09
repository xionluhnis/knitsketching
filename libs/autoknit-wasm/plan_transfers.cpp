#include <emscripten.h>

#include "../autoknit/plan_transfers.hpp"

typedef std::vector<BedNeedle> NeedleList;
typedef std::vector<Slack> SlackList;

struct TransferInput {
    NeedleList bed_from;
    NeedleList bed_to;
    SlackList  slacks;
};

typedef std::vector<Transfer> TransferOutput;

static Constraints constr;
static TransferInput input;
static TransferOutput output;
static std::string error;

extern "C" {

    // main transfer planning function
    EMSCRIPTEN_KEEPALIVE
    uint8_t plan_cse_transfers(){
        // execute planning
        if(plan_transfers(constr, input.bed_from, input.bed_to, input.slacks, &output, &error)){
            return 1; // it worked!
        } else {
            return 0;
        }
    }

    // helpers
    Slack max_slack(Slack from, Slack to, Slack def){
        if(from < 0)
            from = -from;
        if(to < 0)
            to = -to;
        if(def < 0)
            def = -def;
        if(from < to){
            return to < def ? def : to;
        } else {
            return from < def ? def : from;
        }
    }

    // input creation functions
    EMSCRIPTEN_KEEPALIVE
    void create_default_slack(int32_t min_slack){
        size_t N = input.bed_from.size();
        if(input.bed_to.size() == N
        && input.slacks.size() == N){
            for(size_t i = 0; i < N; ++i){
                size_t n = i + 1 < N ? i + 1 : 0;
                input.slacks[i] = max_slack(
                    input.bed_from[n].needle - input.bed_from[i].needle,
                    input.bed_to[n].needle - input.bed_to[i].needle,
                    min_slack
                );
            }
        }
    }
    EMSCRIPTEN_KEEPALIVE
    void allocate_input(uint32_t needle_count){
        input.bed_from.resize(needle_count);
        input.bed_to.resize(needle_count);
        input.slacks.resize(needle_count);
    }
    BedNeedle::Bed side_to_bed(uint8_t side){
        switch(side){
            case 'f': return BedNeedle::Front;
            case 'F': return BedNeedle::FrontSliders;
            case 'b': return BedNeedle::Back;
            case 'B': return BedNeedle::BackSliders;
            default:  return BedNeedle::Front;
        }
    }
    uint8_t bed_to_side(BedNeedle::Bed bed){
        switch(bed){
            case BedNeedle::Front:          return 'f';
            case BedNeedle::FrontSliders:   return 'F';
            case BedNeedle::Back:           return 'b';
            case BedNeedle::BackSliders:    return 'B';
            default:                        return 0;
        }
    }
    EMSCRIPTEN_KEEPALIVE
    void set_from_needle(uint32_t needle_index, uint8_t side, int32_t offset){
        NeedleList &bed = input.bed_from;
        bed[needle_index].bed = side_to_bed(side);
        bed[needle_index].needle = offset;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_to_needle(uint32_t needle_index, uint8_t side, int32_t offset){
        NeedleList &bed = input.bed_to;
        bed[needle_index].bed = side_to_bed(side);
        bed[needle_index].needle = offset;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_slack(uint32_t needle_index, Slack slack){
        input.slacks[needle_index] = slack;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_max_racking(uint32_t racking){
        constr.max_racking = racking;
    }
    EMSCRIPTEN_KEEPALIVE
    void set_free_range(int32_t min, int32_t max){
        constr.min_free = min;
        constr.max_free = max;
    }
    EMSCRIPTEN_KEEPALIVE
    void reset_free_range(){
        set_free_range(
            std::numeric_limits< int32_t >::min(),
            std::numeric_limits< int32_t >::max()
        );
    }

    // output reading functions
    EMSCRIPTEN_KEEPALIVE
    uint32_t get_output_size(){
        return output.size();
    }
    EMSCRIPTEN_KEEPALIVE
    int32_t get_transfer_from_offset(uint32_t xfer_index){
        return output[xfer_index].from.needle;
    }
    EMSCRIPTEN_KEEPALIVE
    int32_t get_transfer_to_offset(uint32_t xfer_index){
        return output[xfer_index].to.needle;
    }
    EMSCRIPTEN_KEEPALIVE
    uint8_t get_transfer_from_bed(uint32_t xfer_index){
        return bed_to_side(output[xfer_index].from.bed);
    }
    EMSCRIPTEN_KEEPALIVE
    uint8_t get_transfer_to_bed(uint32_t xfer_index){
        return bed_to_side(output[xfer_index].to.bed);
    }

};