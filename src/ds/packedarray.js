// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');

// constants
// - types of data
const U8  = 'u8';
const U16 = 'u16';
const U32 = 'u32';
const U64 = 'u64';
const I8  = 'i8';
const I16 = 'i16';
const I32 = 'i32';
const I64 = 'i64';
const F32 = 'f32';
const F64 = 'f64';
// - ambiguous types
const B32 = 'b32';
const B64 = 'b64';
// list and map
const TYPES = [
  U8, U16, U32, U64,
  I8, I16, I32, I64,
  F32, F64,
  B32, B64
];
const TYPE_BYTES = {
  [U8]:  1,
  [I8]:  1,
  [U16]: 2,
  [I16]: 2,
  [U32]: 4,
  [I32]: 4,
  [F32]: 4,
  [B32]: 4,
  [U64]: 8,
  [I64]: 8,
  [F64]: 8,
  [B64]: 8
};

function transferBytes(inBuffer, inOffset, outBuffer, outOffset, numBytes){
  if(!numBytes)
    return; // nothing to do
  assert(inBuffer instanceof ArrayBuffer
      && outBuffer instanceof ArrayBuffer, 'Invalid argument types', inBuffer, outBuffer);
  const inBytes = new Uint8Array(inBuffer, inOffset, numBytes);
  const outBytes = new Uint8Array(outBuffer, outOffset, numBytes);
  outBytes.set(inBytes);
}

class PackedArray {
  constructor(fields, allocateLength, fill = null){
    assert(Array.isArray(fields) && fields.every(el => Array.isArray(el) && el.length == 2),
      'Invalid field list: should be a list of pairs [[name1, type1], [name2, type2], ...]');
    this.fields = fields;
    this.fieldOffsets = {};
    this.fieldTypes = {};
    this.elementSize = 0;
    for(let [name, type] of fields){
      assert(typeof name === 'string' || typeof name === 'number',
        'Name must be either a string or a number');
      assert(type in TYPE_BYTES, 'Unsupported type', type);
      this.fieldTypes[name] = type;
      this.fieldOffsets[name] = this.elementSize;
      this.elementSize += TYPE_BYTES[type];
    }
    this.length = 0;
    this.capacity = 0;
    this.increaseFactor = 2;
    if(allocateLength){
      this.allocate(allocateLength);
      if(fill){
        this.length = allocateLength;
      }
    } else {
      this.capacity = 0;
      assert(!fill, 'Cannot fill without allocation');
    }
  }

  clear(){
    this.length = 0;
  }

  static fromData(data){
    const array = new PackedArray(data.fields);
    if(data.buffer){
      array.buffer = data.buffer;
      array.data = new DataView(data.buffer);
    }
    array.length = data.length || 0;
    array.capacity = data.capacity || 0;
    array.increaseFactor = data.increaseFactor || 2;
    return array;
  }

  copy(minimal){
    const pa = new PackedArray(this.fields);
    if(this.capacity){
      if(minimal) {
        pa.buffer = this.buffer.slice(0, this.usedBytes); // only the used bytes
        pa.capacity = this.length;
      } else {
        pa.buffer = this.buffer.slice(0);
        pa.capacity = this.capacity;
      }
      pa.length = this.length;
      pa.data = new DataView(this.buffer);
    }
    pa.increaseFactor = this.increaseFactor;
    return pa;
  }

  toData(minimal){
    return this.copy(minimal);
  }

  getBuffers(){
    return this.capacity ? [this.buffer] : [];
  }

  get usedBytes(){
    return this.length * this.elementSize;
  }

  get bytes(){
    return this.capacity * this.elementSize;
  }

  allocate(numElements, transferLength){
    if(numElements <= this.capacity){
      return this.buffer; // nothing to do
    } else if(this.capacity){
      const prevBuffer = this.buffer;
      if(transferLength === undefined)
        transferLength = this.length;
      this.capacity = numElements;
      this.buffer = new ArrayBuffer(this.bytes);
      this.data = new DataView(this.buffer);
      transferBytes(
        prevBuffer, 0,
        this.buffer, 0,
        transferLength * this.elementSize
      );
      return prevBuffer;
    } else {
      this.capacity = numElements;
      this.buffer = new ArrayBuffer(this.bytes);
      this.data = new DataView(this.buffer);
      return this.buffer;
    }
  }

  byteOffset(index, field){
    assert(field in this.fieldOffsets, 'Invalid field', field);
    return index * this.elementSize + this.fieldOffsets[field];
  }

  push(obj){
    if(this.length == this.capacity){
      // we need to allocate a larger array
      assert(this.increaseFactor > 1, 'Invalid increase factor');
      this.allocate(Math.ceil((this.capacity || 1) * this.increaseFactor));
    }
    this.length += 1;
    if(obj)
      this.set(this.length - 1, obj);
  }

  fill(value, from = 0){
    const fieldNames = this.fields.map(([name,]) => name);
    switch(typeof value){

      // filling with same number everywhere (e.g. 0, Infinity or NaN)
      case 'number':
        for(let i = from; i < this.length; ++i){
          for(const fname of fieldNames)
            this.set(i, fname, value);
        }
        break;

      // per index values
      case 'function':
        for(let i = from; i < this.length; ++i){
          const values = value(i);
          for(let f = 0; f < fieldNames.length; ++f)
            this.set(i, fieldNames[f], values[f]);
        }
        break;

      // other cases
      default:
        if(Array.isArray(value)){
          // filling with the same fields for each entry
          assert(value.length === fieldNames.length, 'Invalid values');
          for(let i = from; i < this.length; ++i){
            for(let f = 0; f < fieldNames.length; ++f)
              this.set(i, fieldNames[f], value[f]);
          }
        } else {
          assert.error('Unsupported fill argument type', value);
        }
        break;
    }
  }

  set(index, field, value, fieldType){
    if(index < 0)
      index += this.length;
    assert(index < this.length, 'Out-of-bounds PackedArray::set');
    if(value === undefined){
      assert(typeof field == 'object', 'Must pass some object as field if not providing a value');
      const obj = field;
      for(const name in obj){
        if(name in this.fieldTypes){
          this.set(index, name, obj[name]);
        }
      }
    } else {
      assert(field in this.fieldTypes, 'Field does not exist');
      const byteOffset = this.byteOffset(index, field);
      switch(fieldType || this.fieldTypes[field]){
        case U8:  this.data.setUint8(byteOffset, value); break;
        case I8:  this.data.setInt8(byteOffset, value); break;
        case U16: this.data.setUint16(byteOffset, value); break;
        case I16: this.data.setInt16(byteOffset, value); break;
        case U32: this.data.setUint32(byteOffset, value); break;
        case I32: this.data.setInt32(byteOffset, value); break;
        case F32: this.data.setFloat32(byteOffset, value); break;
        case U64: this.data.setBigUint64(byteOffset, value); break;
        case I64: this.data.setBigInt64(byteOffset, value); break;
        case F64: this.data.setFloat64(byteOffset, value); break;
        case B32:
        case B64:
          assert.error('Binary types needs to be resolved by passing a specific type as argument');
          break;
        default:
          assert.error('Invalid type', this.fieldTypes[field], 'for field', field);
      }
    } // endif else
  }

  insertAt(index, obj){
    if(index == this.length)
      this.push(obj);
    else
      this.splice(index, 0, obj);
  }

  removeAt(index){
    this.splice(index, 1);
  }

  splice(index, delCount, ...insertItems){
    if(index < 0)
      index += this.length;
    assert(delCount >= 0 && delCount === Math.ceil(delCount),
      'Cannot delete a non-positive integer elements');
    assert(index >= 0 && index <= this.length, 'Invalid index');
    assert(index + delCount <= this.length, 'Deleting out of bounds');
    const afterLength = this.length - delCount + insertItems.length;

    // 0) make sure we have enough space
    let prevBuffer;
    if(afterLength <= this.capacity){
      prevBuffer = this.buffer;
    } else {
      // ensure the new capacity is sufficient, while using increase factor
      const newCapacity = Math.max(afterLength,
        Math.ceil((this.capacity || 1) * this.increaseFactor)
      );
      prevBuffer = this.allocate(newCapacity, index);
    }

    // 1) move old end block (if any, and if necessary)
    // - any <=> blockLength > 0
    // - necessary <=> block offsets have changed, or the data buffer has been reallocated
    const blockPrevOffset = index + delCount;
    const blockLength = this.length - blockPrevOffset;
    const blockNewOffset = index + insertItems.length;
    if(blockLength > 0 && (blockPrevOffset != blockNewOffset || prevBuffer != this.buffer)){
      transferBytes(
        prevBuffer, blockPrevOffset * this.elementSize,
        this.buffer, blockNewOffset * this.elementSize,
        blockLength * this.elementSize
      );
    }

    // 2) write new elements
    for(let i = 0; i < insertItems.length; ++i){
      this.set(index + i, insertItems[i]);
    }

    // 3) update length
    this.length = afterLength;
  }

  /**
   * Return a field of the array
   * 
   * @param {number} index 
   * @param {string} [field] 
   * @param {string} [fieldType]
   * @return {any} field value
   */
  get(index, field, fieldType){
    if(index < 0)
      index += this.length;
    assert(index < this.length, 'Out-of-bounds PackedArray::get');
    if(field === undefined){
      const obj = {};
      for(let [name, ] of this.fields){
        obj[name] = this.get(index, name);
      }
      return obj;
    }
    // default single entry
    assert(field in this.fieldTypes, 'Field does not exist');
    const byteOffset = this.byteOffset(index, field);
    switch(fieldType || this.fieldTypes[field]){
      case U8:  return this.data.getUint8(byteOffset);
      case I8:  return this.data.getInt8(byteOffset);
      case U16: return this.data.getUint16(byteOffset);
      case I16: return this.data.getInt16(byteOffset);
      case U32: return this.data.getUint32(byteOffset);
      case I32: return this.data.getInt32(byteOffset);
      case F32: return this.data.getFloat32(byteOffset);
      case U64: return this.data.getBigUint64(byteOffset);
      case I64: return this.data.getBigInt64(byteOffset);
      case F64: return this.data.getFloat64(byteOffset);
      case B32:
      case B64:
        assert.error('Binary types needs to be resolved by passing a specific type as argument');
        break;
      default:
        assert.error('Invalid type', this.fieldTypes[field], 'for field', field);
    }
  }

  /**
   * Return this packed array as a byte array
   * 
   * @param {boolean} full whether to return an array of the full capacity (not just length)
   * @return {Uint8Array} the byte array
   */
  asByteArray(full){
    return new Uint8Array(this.buffer, 0, (full ? this.capacity : this.length) * this.elementSize);
  }

  asArray(map) {
    if(!map)
      map = (_, idx) => this.get(idx);
    return Array.from({ length: this.length }, map);
  }
}

module.exports = Object.assign(PackedArray, {
  U8, U16, U32, U64,
  I8, I16, I32, I64,
  F32, F64, B32, B64,
  TYPES, TYPE_BYTES
});
