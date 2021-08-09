// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const PackedArray = require('../ds/packedarray.js');
const { U8, U32, I32, F32, B32 } = PackedArray;

// constants
let OPC = 0;
const K = {
  // fields
  OPCODE: 'op',
  ARG0: 'a0',
  ARG1: 'a1',
  ARG2: 'a2',
  ARG: function(num){
    return 'a' + num;
  },
  COMMENT_PTR: 'cptr',
  METADATA: 'meta',

  // list of opcodes
  NOOP:         OPC++,
  IN:           OPC++,
  INHOOK:       OPC++,
  RELEASEHOOK:  OPC++,
  OUT:          OPC++,
  OUTHOOK:      OPC++,
  STITCH:       OPC++,
  RACK:         OPC++,
  KNIT:         OPC++,
  TUCK:         OPC++,
  SPLIT:        OPC++,
  DROP:         OPC++,
  AMISS:        OPC++,
  TRANSFER:     OPC,
  XFER:         OPC++,
  MISS:         OPC++,
  PAUSE:        OPC++,
  // extensions
  X_STITCH:         OPC,
  X_STITCH_NUMBER:  OPC++,
  X_SPEED:          OPC,
  X_SPEED_NUMBER:   OPC++,
  X_PRESSER:        OPC,
  X_PRESSER_MODE:   OPC++,
  // end of opcodes
  UNSUPPORTED:  OPC++,
  // opcode+dir masks
  OPCODE_MASK:  0x7F, // 7 lsb
  DIR_MASK:     0x80, // 1 msb
  // directions
  LEFT:  -1,
  RIGHT: +1,
  NONE:   0,
  LEFT_FLAG:    0x80,
  RIGHT_FLAG:   0x00,

  // orientations
  CCW:  +1,
  CW:   -1,

  // metadata masks
  META_PREFIX: '$meta=',

  // argument types
  // - needle argument: str=(f|b)(s?)n, bin=n;(f|b)(s?)
  NTYPE: I32,
  SIDE_MASK:    0x00000001,
  SLIDER_MASK:  0x00000002,
  OFFSET_MASK:  0xFFFFFFFC,
  OFFSET_SHIFT: 2,
  // - carriers argument: bits as carrier indices
  CTYPE: U32,
  // - stitch value: tension as a fp number
  STYPE: F32,
  // - racking value: needle bed offset as a fp number (fractional in units of 0.25)
  RTYPE: F32,

  // note: max #arg = 3, for split D N N2 CS
  //       where D is made part of opcode

  // needle data
  FRONT:        'f',
  BACK:         'b',
  FRONT_SLIDER: 'fs',
  BACK_SLIDER:  'bs',

  // headers
  // - position
  POSITION_LEFT:   'Left',
  POSITION_RIGHT:  'Right',
  POSITION_CENTER: 'Center',
  POSITION_KEEP:   'Keep',

  // operation argument types
  CARRIERS:     'cs',
  STITCH_UNIT:  's',
  RACKING:      'r',
  NEEDLE:       'n',
  DIRECTION:    'd',
  // extensions types
  STITCH_NUMBER:  'sn',
  SPEED_NUMBER:   'vn',
  PRESSER_MODE:   'pm',
  // extension storage types (must take 32 bits)
  // - abstract numbers (stitch / speed) into machine memory
  UTYPE: U32,
  // - presser modes
  PRESSER_OFF:  0x00,
  PRESSER_AUTO: 0x01,
  PRESSER_ON:   0x02,
  PTYPE: U32, // presser mode

  // special stitch numbers
  NORMAL_STITCH: 5,
  HALF_GAUGE_STITCH: 6,
  INCREASE_STITCH: 7,
  CASTON_STITCH: 33,
  CASTOFF_STITCH: 24
};
K.NORMAL_SIDES = K.HOOK_SIDES = [K.FRONT, K.BACK];
K.SLIDER_SIDES = [K.FRONT_SLIDER, K.BACK_SLIDER];
K.ALL_SIDES = K.SLIDER_SIDES.concat(K.NORMAL_SIDES);
K.SIDE_BITS_OF = {
  [K.FRONT]: 0x00,
  [K.BACK]:  K.SIDE_MASK,
  [K.FRONT_SLIDER]: K.SLIDER_MASK,
  [K.BACK_SLIDER]:  K.SIDE_MASK | K.SLIDER_MASK
};
K.SIDE_FROM_BITS = [K.FRONT, K.BACK, K.FRONT_SLIDER, K.BACK_SLIDER];
K.OTHER_SIDE = {
  [K.FRONT]:  K.BACK,
  [K.BACK]:   K.FRONT,
  [K.FRONT_SLIDER]: K.BACK_SLIDER,
  [K.BACK_SLIDER]:  K.FRONT_SLIDER
};
K.DIR_FLAG_OF = {
  [K.LEFT]:   K.LEFT_FLAG,
  [K.RIGHT]:  K.RIGHT_FLAG
};
K.DIR_FROM_FLAG = {
  [K.LEFT_FLAG]:  K.LEFT,
  [K.RIGHT_FLAG]: K.RIGHT
};
K.OTHER_DIR = K.INV_DIR = {
  [K.LEFT]:   K.RIGHT,
  [K.RIGHT]:  K.LEFT
};

// operation arguments
K.OPERATIONS = [
  [''], // noop
  ['in',      K.CARRIERS],
  ['inhook',  K.CARRIERS],
  ['releasehook', K.CARRIERS],
  ['out',     K.CARRIERS],
  ['outhook', K.CARRIERS],
  ['stitch',  K.STITCH_UNIT, K.STITCH_UNIT],
  ['rack',    K.RACKING],
  ['knit',    K.DIRECTION, K.NEEDLE, K.CARRIERS],
  ['tuck',    K.DIRECTION, K.NEEDLE, K.CARRIERS],
  ['split',   K.DIRECTION, K.NEEDLE, K.NEEDLE, K.CARRIERS],
  ['drop',    K.NEEDLE],
  ['amiss',   K.NEEDLE],
  ['xfer',    K.NEEDLE, K.NEEDLE],
  ['miss',    K.DIRECTION, K.NEEDLE, K.CARRIERS],
  ['pause'],
  ['x-stitch-number', K.STITCH_NUMBER],
  ['x-speed-number',  K.SPEED_NUMBER],
  ['x-presser-mode',  K.PRESSER_MODE]
];
K.OP_HAS_NEEDLE = K.OPERATIONS.map(entry => entry.some(arg => arg === K.NEEDLE));
K.OP_HAS_CARRIERS = K.OPERATIONS.map(entry => entry.some(arg => arg === K.CARRIERS));
K.OP_HAS_LOOP = K.OPERATIONS.map(([op]) => ['knit', 'tuck', 'split'].includes(op));
/**
 * Needle instance wrapper
 *
 * @param side one of f|b|fs|bs
 * @param offset a signed integer
 */
class Needle {
  constructor(side, offset){
    this.side = side;
    this.offset = offset;

    assert(K.ALL_SIDES.includes(side), 'Invalid side', side);
    assert(typeof offset === 'number', 'Invalid offset', offset);
  }

  matches(n){
    return n && n.side === this.side && n.offset === this.offset;
  }
  matchesSide(n){ return n && this.side === n.side; }
  matchesOffset(n){ return n && this.offset === n.offset; }

  static from(...args){
    let side;
    let offset;
    for(const arg of args){
      if(arg instanceof Needle){
        assert(offset === undefined && side === undefined, 'Needle argument with partial arguments', arg, args);
        side = arg.side;
        offset = arg.offset;

      } else if(typeof arg === 'number'){
        assert(offset === undefined, 'Multiple offset arguments', args, offset, arg);
        offset = arg;

      } else if(typeof arg === 'string'){
        assert(side === undefined, 'Multiple side arguments', args, side, arg);
        for(const s of K.ALL_SIDES){
          if(arg.indexOf(s) === 0){
            side = s;
            // check if string contains also the offset => extract it
            if(arg.length !== s.length){
              assert(offset === undefined, 'Multiple offset arguments', args, offset, arg);
              const offString = arg.substring(s.length).trim();
              const normOffString = offString.startsWith('+') ? offString.substring(1) : offString;
              offset = parseInt(normOffString);
              // check that the offset was complete (not hiding some typo)
              assert(offset + '' === normOffString, 'Invalid needle argument', arg);
            }
            // do not try further, we've found it!
            break;
          }
        }
        if(!side)
          assert.error('Needle string argument must include a side', arg);

      } else {
        assert.error('Unsupported needle argument', arg);
      }
    }
    return new Needle(side || K.FRONT, offset);
  }

  toB32(){
    assert(this.side in K.SIDE_BITS_OF, 'Invalid side', this.side);
    return K.SIDE_BITS_OF[this.side] | (this.offset << K.OFFSET_SHIFT);
  }

  static fromB32(b32){
    const sb = b32 & (K.SIDE_MASK | K.SLIDER_MASK);
    const offset = b32 >> K.OFFSET_SHIFT;
    return new Needle(K.SIDE_FROM_BITS[sb], offset);
  }

  // transformations
  shiftedBy(shift){
    return shift ? new Needle(this.side, this.offset + shift) : this;
  }
  shiftedTo(offset){
    return new Needle(this.side, offset);
  }
  toHook(){   return new Needle(this.side.charAt(0), this.offset); }
  toSlider(){ return new Needle(this.side.charAt(0) + 's', this.offset); }
  otherSide(racking = 0){   return new Needle(K.OTHER_SIDE[this.side], this.offset + (this.inFront() ? -racking : +racking)); }
  otherHook(racking = 0){   return this.toHook().otherSide(racking); }
  otherSlider(racking = 0){ return this.toSlider().otherSide(racking); }
  otherSides(racking = 0){
    if(this.inFront())
      return [ new Needle(K.BACK, this.offset - racking), new Needle(K.BACK_SLIDER, this.offset - racking) ];
    else
      return [ new Needle(K.FRONT, this.offset + racking), new Needle(K.FRONT_SLIDER, this.offset + racking) ];
  }

  // queries
  inFront(){        return this.side === K.FRONT || this.side === K.FRONT_SLIDER; }
  inFrontHook(){    return this.side === K.FRONT; }
  onFrontSlider(){  return this.side === K.FRONT_SLIDER; }
  inBack(){         return this.side === K.BACK || this.side === K.BACK_SLIDER; }
  inBackHook(){     return this.side === K.BACK; }
  onBackSlider(){   return this.side === K.BACK_SLIDER; }
  inHook(){         return this.side === K.FRONT || this.side === K.BACK; }
  onSlider(){       return this.side === K.FRONT_SLIDER || this.side === K.BACK_SLIDER; }

  rackingTo(n){
    assert(this.inFront() !== n.inFront(), 'Racking only makes sense across beds');
    if(this.inFront())
      return this.offset - n.offset;
    else
      return n.offset - this.offset;
  }

  dirTo(n){
    if(n.offset < this.offset)
      return K.LEFT;
    else if(n.offset > this.offset)
      return K.RIGHT;
    else
      return K.NONE;
  }

  frontOffset(racking){
    if(this.inFront()){
      return this.offset;
    } else {
      // /!\ Positive racking = right offset of the back bed
      // <=> racking = frontOffset - backOffset
      //  &  backOffset = this.offset
      //  => frontOffset = backOffset + racking
      return this.offset + racking;
    }
  }

  backOffset(racking){
    if(this.inBack())
      return this.offset;
    else
      return this.offset - racking;
  }

  orientationToDir(ori){ return this.inFront() ? ori : -ori; }
  dirToOrientation(dir){ return this.inFront() ? dir : -dir; }

  toString(){
    return this.side + this.offset;
  }
}

/**
 * Knitout storage instance
 *
 * Fields:
 * - array:     instruction storage (PackedArray)
 * - comments:  list of comment strings
 * - version:   the knitout version
 * - headers:   a map of headers
 */
class Knitout {
  constructor(){
    this.array = new PackedArray([
      [K.OPCODE, U8],       // opcode + direction bit
      [K.ARG0, B32],        // first argument
      [K.ARG1, B32],        // second argument
      [K.ARG2, B32],        // third argument
      [K.COMMENT_PTR, U32], // comment pointer
      [K.METADATA, U32]     // metadata
    ]);

    // comment list
    this.comments = [];

    // header list
    this.version  = 2;
    this.headers  = new Map([
      ['Carriers', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => '' + n)]
    ]);
  }

  get length(){
    return this.array.length;
  }

  allocate(numExpCodes){
    this.array.allocate(numExpCodes);
  }

  addEntry(opcode, dir = K.NONE){
    // add empty entry
    this.array.push();

    // opcode with direction
    if(dir === K.LEFT)
      opcode |= K.DIR_MASK; // include dir bit
    else if(dir === K.RIGHT)
      opcode &= ~K.DIR_MASK; // exclude dir bit
    else
      assert(dir === K.NONE, 'Invalid direction argument');
    this.array.set(-1, K.OPCODE, opcode);
    return this;
  }

  flush(){} // no-op here, but overriden in Stream

  getOperation(index){
    const op = this.array.get(index, K.OPCODE);
    return op & K.OPCODE_MASK;
  }

  hasOperation(index){
    return this.getOperation(index) !== K.NOOP;
  }

  getDirection(index){
    const opcode = this.array.get(index, K.OPCODE);
    const dirFlag = opcode & K.DIR_MASK;
    assert(dirFlag in K.DIR_FROM_FLAG, 'Invalid direction flag');
    return K.DIR_FROM_FLAG[dirFlag];
  }

  setDirection(index, dir){
    assert([K.LEFT, K.RIGHT].includes(dir),
      'Invalid direction', dir);
    const opcode = this.getOperation(index);
    const dirFlag = K.DIR_FLAG_OF[dir];
    assert(typeof dirFlag === 'number', 'Invalid direction flag', dirFlag);

    // update opcode
    this.array.set(index, K.OPCODE, opcode | dirFlag);
    return this;
  }

  hasComment(index){
    return this.array.get(index, K.COMMENT_PTR) > 0;
  }

  getComment(index){
    const cidx = this.array.get(index, K.COMMENT_PTR) - 1;
    return this.comments[cidx];
  }

  setComment(index, str){
    const cindex = this.array.get(index, K.COMMENT_PTR) - 1;
    if(cindex >= 0){
      assert(cindex < this.comments.length, 'Invalid comment pointer');
      // replace comment
      this.comments[cindex] = str;
    } else {
      // create new comment
      this.comments.push(str);
      this.array.set(index, K.COMMENT_PTR, this.comments.length);
    }
    return this;
  }

  addComment(str){
    this.addEntry(K.NOOP);
    return this.setComment(-1, str);
  }

  hasMetadata(index){
    return this.array.get(index, K.METADATA) > 0;
  }

  setMetadata(index, data){
    assert(typeof data === 'number', 'Invalid metadata type');
    this.array.set(index, K.METADATA, 1 + data);
    return this;
  }

  getMetadata(index){
    return this.array.get(index, K.METADATA) - 1;
  }

  getHeader(name){
    return this.headers.get(name);
  }

  setHeader(name, value){
    this.headers.set(name, value);
    return this;
  }

  setPosition(pos){
    this.setHeader('Position', pos);
    return this;
  }

  // arguments
  setArg(index, argNumber, argValue, argType){
    this.array.set(index, K.ARG(argNumber), argValue, argType);
    return this;
  }

  getArg(index, argNumber, argType){
    return this.array.get(index, K.ARG(argNumber), argType);
  }

  getArgs(index){
    const opcode = this.getOperation(index);
    assert(opcode >= 0 && opcode < K.OPERATIONS.length,
      'Unsupported operation', opcode);
    // get argument types
    const [, ...argTypes] = K.OPERATIONS[opcode];

    // go over arguments and set them individually
    const args = [];
    for(let i = 0, a = 0; i < argTypes.length; ++i, ++a){
      const type = argTypes[i];
      let arg;
      switch(type){

        case K.DIRECTION:
          arg = this.getDirection(index);
          --a; // part of opcode, so no argument increase
          break;

        case K.STITCH_UNIT:
          arg = this.getArg(index, a, K.STYPE);
          break;

        case K.CARRIERS: {
          const cs = this.getArg(index, a, K.CTYPE);
          // transform bits into array of carrier names
          arg = this.headers.get('Carriers').filter((_, idx) => {
            const bit = (cs >> idx) & 0x01;
            return bit === 0x01;
          });
        } break;

        case K.NEEDLE: {
          const nb = this.getArg(index, a, K.NTYPE);
          arg = Needle.fromB32(nb);
        } break;

        case K.RACKING:
          arg = this.getArg(index, a, K.RTYPE);
          break;

        case K.STITCH_NUMBER:
        case K.SPEED_NUMBER:
        case K.PRESSER_MODE:
          arg = this.getArg(index, a, K.UTYPE);
          break;

        default:
          assert.error('Unsupported type', type, argTypes);
          break;
      }
      args.push(arg);
    }
    return args;
  }

  getEntry(index){
    return [this.getOperation(index), ...this.getArgs(index)];
  }

  *entries(){
    for(let i = 0; i < this.length; ++i){
      yield this.getEntry(i);
    }
  }

  setArgs(index, ...args){
    const opcode = this.getOperation(index);
    assert(opcode >= 0 && opcode < K.OPERATIONS.length,
      'Unsupported operation', opcode);
    // get argument types
    const [, ...argTypes] = K.OPERATIONS[opcode];
    // /!\ cs is optional in Knitout (defaults to no carrier)
    // but we require it to be non-empty with our interface
    // = use explicit drop/amiss/xfer for no-yarn variants
    //   to prevent forgetting the yarn carrier (typically a bug!)
    const minArgCount = argTypes.length;
    assert(args.length >= minArgCount,
      'Invalid number of arguments, expected at least ' + minArgCount + ' but got ' + args.length);

    // go over arguments and set them individually
    for(let i = 0, a = 0; i < args.length; ++i, ++a){
      const type = argTypes[i];
      const arg  = args[i];
      switch(type){

        case K.DIRECTION:
          this.setDirection(-1, arg);
          --a; // part of opcode, so no argument increase
          break;

        case K.STITCH_UNIT:
          this.setArg(-1, a, arg, K.STYPE);
          break;

        case K.CARRIERS: {
          let cs = 0;
          if(typeof arg === 'number')
            cs = arg;
          else {
            assert(Array.isArray(arg), 'Carrier must be either a bitset of array of names');
            cs = arg.reduce((bits, carrierName) => {
              return bits | (1 << this.getCarrierBit(carrierName));
            }, 0);
          }
          assert(cs, 'No carrier for a carrier-using action');
          this.setArg(-1, a, cs, K.CTYPE);
        } break;

        case K.NEEDLE:
          this.setArg(-1, a, Needle.from(arg).toB32(), K.NTYPE);
          break;

        case K.RACKING:
          this.setArg(-1, a, arg, K.RTYPE);
          break;

        case K.STITCH_NUMBER:
        case K.SPEED_NUMBER:
          this.setArg(-1, a, arg, K.UTYPE);
          break;

        case K.PRESSER_MODE: {
          let pm;
          if(typeof arg === 'number')
            pm = arg;
          else if(typeof arg === 'string'){
            if(arg === 'off')
              pm = K.PRESSER_OFF;
            else if(arg === 'auto')
              pm = K.PRESSER_AUTO;
            else if(arg === 'on')
              pm = K.PRESSER_ON;
            else {
              assert.error('Invalid presser mode', arg);
              pm = K.PRESSER_OFF;
            }
          }
          this.setArg(-1, a, pm, K.UTYPE);
        } break;

        default:
          assert.error('Unsupported type', type, arg, argTypes, args);
          break;
      }
    }
    return this;
  }

  getCarriers(){
    return this.headers.get('Carriers');
  }

  setCarriers(list){
    assert(Array.isArray(list) && list.length, 'Invalid carrier list', list);
    this.headers.set('Carriers', list);
    return this;
  }

  getCarrierBit(carrierName){
    const carrierList = this.getCarriers();
    const carrierIndex = carrierList.indexOf(carrierName.toString());
    assert(carrierIndex !== -1, 'Carrier does not exist', carrierName);
    return carrierIndex;
  }

  toHeaderLines(lines = []){
    lines.push(';!knitout-' + this.version);
    for(const [name, value] of this.headers){
      const valueStr = Array.isArray(value) ? value.join(' ') : value.toString();
      lines.push(';;' + name + ': ' + valueStr);
    }
    return lines;
  }

  toBodyLines(lines = []){
    for(let i = 0; i < this.length; ++i){
      const [op, ...args] = this.getEntry(i);
      let comment = this.getComment(i) || '';
      const meta = this.getMetadata(i);
      if(meta !== -1){
        comment += (comment ? ' ' : '') + K.META_PREFIX + meta;
      }

      // line formatting
      const [opName, ...argTypes] = K.OPERATIONS[op];
      const operation = [
        opName,
        ...args.map((arg, i) => {
          switch(argTypes[i]){

            case K.CARRIERS:
              return arg.join(' ');

            case K.DIRECTION:
              return arg === K.RIGHT ? '+' : '-';

            case K.PRESSER_MODE:
              return arg === K.PRESSER_AUTO ? 'auto' : arg === K.PRESSER_ON ? 'on' : 'off';

            case K.NEEDLE:
            case K.RACKING:
            case K.STITCH_UNIT:
            case K.STITCH_NUMBER:
            case K.SPEED_NUMBER:
              /* falls through */
            default:
              return arg.toString();
          }
        })
      ].join(' ');
      if(comment.length && operation.length)
        lines.push(operation + ' ;' + comment); // full line
      else if(operation.length)
        lines.push(operation); // operation-only line
      else if(comment.length)
        lines.push(';' + comment); // comment-only line
      else
        lines.push(''); // empty line
    }
    return lines;
  }

  toString(){
    const lines = [];

    // headers
    this.toHeaderLines(lines);

    // operations
    this.toBodyLines(lines);

    // flatten as string
    return lines.join('\n');
  }

  toJointString(...ks){
    return Knitout.toJointString(this, ...ks);
  }

  static toJointString(...ks){
    assert(ks.length, 'Joint string export require at least one knitout argument');
    if(ks.length === 1){
      return ks[0].toString();
    } else if(ks.length > 1){
      const lines = [];
      ks[0].toHeaderLines(lines);
      for(let i = 0; i < ks.length; ++i){
        lines.push('; Part ' + i);
        ks[i].toBodyLines(lines);
      }
      return lines.join('\n');
    } else {
      return '';
    }
  }

  static from(arg, verbose = false, keepEmptyLines = false){
    // either from string or array of strings (lines)
    const lines = typeof arg === 'string' ? arg.split('\n') : arg;
    assert(Array.isArray(lines), 'Invalid argument type', arg);
    // create knitout file
    const k = new Knitout();
    k.allocate(lines.length);

    // read version
    let magic = false;
    let hasCarriers = false;
    let body = false;
    for(const line of lines){
      if(!line.length && !keepEmptyLines)
        continue; // skip empty lines

      // special header cases
      if(line.startsWith(';!knitout-')){
        // ;!knitout-N = magic version line
        // /!\ version should only happen once
        if(magic)
          console.warn('Multiple knitout versions', k.version, line);
        else
          magic = true;
        // store and output if verbose
        k.version = parseInt(line.substring(';!knitout-'.length));
        if(verbose)
          console.log('Knitout version', k.version);

      } else if(line.startsWith(';;')){
        // ;;name: value = header line
        // /!\ headers should appear before the body
        if(body)
          console.warn('Header within knitout body, should only be at the top');

        // header tokens
        const header = line.substring(2);
        const splitIdx = header.indexOf(': ');
        assert(splitIdx !== -1, 'Invalid header line', line);
        const name = header.substring(0, splitIdx);
        const valToken = header.substring(splitIdx + 2);
        // special carriers case
        if(name === 'Carriers'){
          hasCarriers = true;
          const carriers = valToken.split(' ').map(cs => cs.trim()).filter(cs => cs.length);
          k.setCarriers(carriers);
          if(verbose)
            console.log('Carriers', carriers);
        } else {
          k.setHeader(name, valToken);
          if(verbose)
            console.log('Header', name, valToken);
        }

      } else {
        // operation;comment $meta=n/sl/st

        body = true; // within the body section

        // search for comment separator
        const cidx = line.indexOf(';');
        let operation;
        let comment;
        let meta = -1;
        if(cidx === -1) {
          operation = line.trim();
          comment = '';

        } else {
          operation = line.substring(0, cidx).trim();
          comment = line.substring(cidx + 1).trim();
          // search for metadata
          let metaIdx = comment.indexOf(K.META_PREFIX);
          if(metaIdx >= 0){
            meta = parseInt(comment.substring(metaIdx + K.META_PREFIX.length));
            comment = comment.substring(0, metaIdx).trimRight();
          }
        }

        // opcode
        const tokens = operation.split(' ');
        const opToken = tokens[0];
        const op = K.OPERATIONS.findIndex(([opName, ]) => opName === opToken);
        assert(op !== -1, 'Unsupported operation', opToken);

        // add entry
        k.addEntry(op);
        // add optional comment
        if(comment.length)
          k.setComment(-1, comment);
        // add optional metadata
        if(meta >= 0)
          k.setMetadata(-1, meta);

        // only proceed with arguments if there are arguments to consider
        if(!K.OPERATIONS[op] || K.OPERATIONS[op].length <= 1)
          continue; // to next line

        // set arguments
        const [, ...argTypes] = K.OPERATIONS[op];
        // /!\ cs is optional (defaults to no carrier)
        const minArgCount = argTypes[argTypes.length - 1] === K.CARRIERS ? argTypes.length - 1 : argTypes.length;
        assert(tokens.length >= minArgCount + 1,
          'Invalid number of tokens', tokens, 'should be at least', minArgCount + 1);
        const args = [];
        for(let i = 1, a = 0; i < tokens.length; ++i, ++a){
          const token = tokens[i];
          let arg;
          switch(argTypes[a]){

            case K.CARRIERS:
              // spans all remaining tokens
              arg = tokens.slice(i);
              i = tokens.length; // done going over arguments
              break;

            case K.DIRECTION:
              if(token === '+')
                arg = K.RIGHT;
              else if(token === '-')
                arg = K.LEFT;
              else {
                assert.error('Invalid direction', token, line);
                arg = K.RIGHT;
              }
              break;

            case K.NEEDLE:
              arg = Needle.from(token);
              break;

            case K.RACKING:
            case K.STITCH_UNIT:
              arg = parseFloat(token);
              break;

            case K.STITCH_NUMBER:
            case K.SPEED_NUMBER:
              arg = parseInt(token);
              break;

            case K.PRESSER_MODE:
              if(token === 'off')
                arg = K.PRESSER_OFF;
              else if(token === 'auto')
                arg = K.PRESSER_AUTO;
              else if(token === 'on')
                arg = K.PRESSER_ON;
              else {
                assert.error('Invalid presser mode', token, line);
                arg = K.PRESSER_OFF;
              }
              break;

            default:
              assert.error('Unsupported type', argTypes[a]);
              break;
          }
          args.push(arg);
        }
        if(args.length)
          k.setArgs(-1, ...args);
      }
    }

    if(!magic)
      console.warn('Knitout file without version number');
    if(!hasCarriers)
      console.warn('Knitout file missing required carriers header');

    return k;
  }

  getBuffers(){
    return this.array.getBuffers();
  }

  toData(minimal){
    return {
      array: minimal ? this.array.toData(true) : this.array,
      comments: this.comments,
      version: this.version,
      headers: this.headers
    };
  }
  loadData(data){
    // note: key in this may include operations added to the prototype below
    // => better to use Object.keys() to avoid those
    for(let key of Object.keys(this)){
      assert(key in data, 'Invalid data, missing field', data, key);
      const value = data[key];
      if(key === 'array')
        this.array = PackedArray.fromData(value);
      else
        this[key] = value;
    }
    return this;
  }

  static fromData(data){
    return new Knitout().loadData(data);
  }

  static extensionName(name){
    return name.replace(/(-\w{1})/g, w => w[1].toUpperCase());
  }

}

// individual functions
operations: {
  for(let opcode = 1; opcode < K.OPERATIONS.length; ++opcode){
    const [name,] = K.OPERATIONS[opcode];
    Knitout.prototype[name] = function(...args){
      this.addEntry(opcode);
      this.setArgs(-1, ...args);
      if(!K.OP_HAS_LOOP[opcode])
        this.flush(); // no loop => can commit change of state
      return this;
    };
    if(name.startsWith('x-'))
      Knitout.prototype[Knitout.extensionName(name)] = Knitout.prototype[name];
  }
}

/**
 * Streaming variant that allows callbacks upon commit
 */
class KnitoutStream extends Knitout {
  constructor(){
    super();

    // committed state
    this.committed = true;

    // list of event callbacks
    this.callbacks = new Set();
  }

  listen(cb){
    this.callbacks.add(cb);
  }

  clear(){
    this.callbacks.clear();
  }

  commit(){
    const entry = this.getEntry(-1);
    for(const cb of this.callbacks)
      cb(this, entry);
    this.committed = true;
  }

  addEntry(opcode, dir = Knitout.NONE){
    if(!this.committed){
      this.commit();
    }
    super.addEntry(opcode, dir);
    this.committed = false;
  }

  flush(){
    if(!this.committed)
      this.commit();
  }
}

module.exports = Object.assign(Knitout, K, {
  Needle, Stream: KnitoutStream,
  constants: K
});
