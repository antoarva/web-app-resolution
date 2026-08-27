/**
 * Linear-memory transport between the host (JS) and the engine (WASM).
 *
 * Only two buffers ever cross the boundary: the host writes a request into the
 * input buffer, the engine writes a response into the output buffer. Both are
 * held in module globals so the GC keeps them alive between exported calls.
 */

let inputBuffer: Uint8Array = new Uint8Array(0);
let outputBuffer: Uint8Array = new Uint8Array(0);
let outputLength: i32 = 0;

/** Reserve `size` input bytes and hand the host a pointer to write into. */
export function allocInput(size: i32): usize {
  inputBuffer = new Uint8Array(size);
  return inputBuffer.dataStart;
}

export function inputPtr(): usize {
  return inputBuffer.dataStart;
}

export function inputSize(): i32 {
  return inputBuffer.length;
}

export function outputPtr(): usize {
  return outputBuffer.dataStart;
}

export function outputLen(): i32 {
  return outputLength;
}

/** Growable little-endian writer targeting the shared output buffer. */
export class ByteWriter {
  private pos: i32 = 0;

  constructor(initialCapacity: i32 = 65536) {
    outputBuffer = new Uint8Array(initialCapacity);
    outputLength = 0;
  }

  private reserve(extra: i32): void {
    const needed = this.pos + extra;
    if (needed <= outputBuffer.length) return;
    let cap = outputBuffer.length > 0 ? outputBuffer.length : 1024;
    while (cap < needed) cap <<= 1;
    const grown = new Uint8Array(cap);
    memory.copy(grown.dataStart, outputBuffer.dataStart, <usize>this.pos);
    outputBuffer = grown;
  }

  writeI32(value: i32): void {
    this.reserve(4);
    store<i32>(outputBuffer.dataStart + <usize>this.pos, value);
    this.pos += 4;
  }

  writeF64(value: f64): void {
    this.reserve(8);
    store<f64>(outputBuffer.dataStart + <usize>this.pos, value);
    this.pos += 8;
  }

  /** Copy `len` raw bytes straight out of the input buffer (no re-encoding). */
  writeSlice(from: usize, len: i32): void {
    this.reserve(len);
    memory.copy(outputBuffer.dataStart + <usize>this.pos, from, <usize>len);
    this.pos += len;
  }

  writeString(value: string): void {
    const encoded = String.UTF8.encode(value);
    const len = <i32>encoded.byteLength;
    this.writeI32(len);
    this.reserve(len);
    memory.copy(outputBuffer.dataStart + <usize>this.pos, changetype<usize>(encoded), <usize>len);
    this.pos += len;
  }

  /** Reserve a slot now, backfill it once the real value is known. */
  placeholder(): i32 {
    const at = this.pos;
    this.writeI32(0);
    return at;
  }

  patchI32(at: i32, value: i32): void {
    store<i32>(outputBuffer.dataStart + <usize>at, value);
  }

  finish(): i32 {
    outputLength = this.pos;
    return this.pos;
  }
}

/** Sequential little-endian reader over the input buffer. */
export class ByteReader {
  private pos: i32 = 0;
  private base: usize;

  constructor() {
    this.base = inputBuffer.dataStart;
  }

  readI32(): i32 {
    const value = load<i32>(this.base + <usize>this.pos);
    this.pos += 4;
    return value;
  }

  readF64(): f64 {
    const value = load<f64>(this.base + <usize>this.pos);
    this.pos += 8;
    return value;
  }

  skip(bytes: i32): void {
    this.pos += bytes;
  }
}
