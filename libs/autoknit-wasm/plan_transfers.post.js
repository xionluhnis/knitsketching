/**
 * Wrapper code over WASM for plan_transfers
 */
class InvalidArgumentError extends Error {
    constructor(message){
        super();
        this.message = message;
    }
}
const sides = ['fs', 'F', 'f', 'bs', 'B', 'b'];
function needleFrom(str){
    let side;
    let offset;
    if(typeof str === 'string'){
        for(const s of sides){
            if(str.startsWith(s)){
                side = s;
                str = str.substring(s.length);
                break;
            }
        }
        if(!side || side.length === 0)
            throw new InvalidArgumentError('Invalid needle side: ' + str);
        else if(side.length === 2)
            side = side.charAt(0).toUpperCase();
        offset = parseInt(str);
    } else {
        if(!Array.isArray(str) || str.length !== 2)
            throw new InvalidArgumentError('Needles must either be strings or arrays of [str, number]');
        side = str[0].charAt(0).toUpperCase();
        offset = str[1];
    }
    if(typeof side !== 'string')
        throw new InvalidArgumentError('Needle side is not a string: ' + side);
    if(typeof offset !== 'number')
        throw new InvalidArgumentError('Needle offset is not a number: ' + offset);
    return [side.charCodeAt(0), offset];
}
function knitoutNeedle(side, offset, asArray = false){
    const sstr = String.fromCharCode(side);
    switch(sstr){
        case 'f':
        case 'b':
            return asArray ? [sstr, offset] : sstr + offset;
        case 'F':
        case 'B':
            return asArray ? [sstr.toLowerCase() + 's', offset] : sstr.toLowerCase() + 's' + offset;
        default:
            return asArray ? [null, offset] : '?' + offset;
    }
}
const xfer = Module;
xfer.plan_transfers = function plan_transfers(from, to, params){
    if(!from.length)
        return [];
    if(from.length !== to.length)
        throw new InvalidArgumentError('From and to arguments must be arrays of the same length');
    // default arguments
    if(!params)
        params = {};
    const slack = params.slack || 2;
    const max_racking = params.max_racking || 4;

    // create input
    xfer._allocate_input(from.length);
    for(let i = 0; i < from.length; ++i){
        const [f_bed, f_off] = needleFrom(from[i]);
        xfer._set_from_needle(i, f_bed, f_off);
        const [t_bed, t_off] = needleFrom(to[i]);
        xfer._set_to_needle(i, t_bed, t_off);
        // set slack if as an array
        if(Array.isArray(slack)){
            const s = slack[i];
            if(slack.length !== from.length)
                throw new InvalidArgumentError('Slack array must be the same size as from and to arrays');
            if(typeof s !== 'number')
                throw new InvalidArgumentError('Slack must either be an integer, or an array of integers');
            xfer._set_slack(i, s);
        }
    }
    if(!Array.isArray(slack)){
        if(typeof slack !== 'number')
            throw new InvalidArgumentError('Slack must either be an integer, or an array of integers');
        xfer._create_default_slack(slack);
    }
    // set bed constraints
    xfer._set_max_racking(max_racking);
    if('min_free' in params || 'max_free' in params){
        const min_free = params.min_free;
        const max_free = params.max_free;
        if(typeof min_free !== 'number' || typeof max_free !== 'number')
            throw new InvalidArgumentError('min_free / max_free must both be provided or none, and both must be numbers');
        if(min_free > max_free)
            throw new InvalidArgumentError('min_free is larger than max_free');
        xfer._set_free_range(min_free, max_free);
    } else {
        xfer._reset_free_range();
    }

    // call wasm code
    const res = xfer._plan_cse_transfers();
    if(!res){
        return null;
    } else {
        const needles_as_array = !!params.needles_as_array;
        const xfers = [];
        // get transfer list
        const xferCount = xfer._get_output_size();
        for(let i = 0; i < xferCount; ++i){
            // get from needle
            const f_bed = xfer._get_transfer_from_bed(i);
            const f_off = xfer._get_transfer_from_offset(i);
            const t_bed = xfer._get_transfer_to_bed(i);
            const t_off = xfer._get_transfer_to_offset(i);
            xfers.push([
                knitoutNeedle(f_bed, f_off, needles_as_array),
                knitoutNeedle(t_bed, t_off, needles_as_array)
            ]);
        }
        return xfers;
    }
};