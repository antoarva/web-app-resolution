/**
 * IDF tokenizer.
 *
 * EnergyPlus input files are a flat list of comma-delimited objects terminated
 * by a semicolon, with `!` starting a comment that runs to end of line:
 *
 *   Zone,
 *     Perimeter_ZN_1,   !- Name
 *     0.0,              !- Direction of Relative North
 *     ...;
 *
 * The whole scan happens over the raw input bytes so no intermediate strings
 * are allocated. Field text is copied verbatim into the output buffer, which
 * the host decodes with a single TextDecoder pass.
 *
 * Output layout (little-endian):
 *   i32 objectCount
 *   per object: i32 fieldCount, then per field: i32 byteLen, byteLen raw bytes
 * Field 0 of every object is its class name.
 */

import { ByteWriter, inputPtr, inputSize } from "../bytes";

// @inline
function isSpace(c: u8): bool {
  return c == 0x20 || c == 0x09 || c == 0x0d || c == 0x0a;
}

export function parseIdf(): i32 {
  const base = inputPtr();
  const size = inputSize();
  const writer = new ByteWriter(size + 4096);

  const objectCountSlot = writer.placeholder();
  let objectCount = 0;

  // Per-object state, opened lazily when the first field byte is seen.
  let objectOpen = false;
  let fieldCountSlot = 0;
  let fieldCount = 0;

  // Current field extent: [start, end) with trailing whitespace excluded.
  let fieldStart = -1;
  let fieldEnd = -1;

  let i = 0;
  while (i < size) {
    const c = load<u8>(base + <usize>i);

    // Comments run to the end of the line and never contribute to a field.
    if (c == 0x21) {
      while (i < size) {
        const n = load<u8>(base + <usize>i);
        if (n == 0x0a) break;
        i++;
      }
      continue;
    }

    if (c == 0x2c || c == 0x3b) {
      if (!objectOpen) {
        // A field terminator implies an object even if the class name was blank.
        fieldCountSlot = writer.placeholder();
        fieldCount = 0;
        objectOpen = true;
      }
      const len = fieldStart >= 0 ? fieldEnd - fieldStart : 0;
      writer.writeI32(len);
      if (len > 0) writer.writeSlice(base + <usize>fieldStart, len);
      fieldCount++;
      fieldStart = -1;
      fieldEnd = -1;

      if (c == 0x3b) {
        writer.patchI32(fieldCountSlot, fieldCount);
        objectCount++;
        objectOpen = false;
      }
      i++;
      continue;
    }

    if (isSpace(c)) {
      i++;
      continue;
    }

    // Any other byte belongs to the field currently being accumulated.
    if (!objectOpen) {
      fieldCountSlot = writer.placeholder();
      fieldCount = 0;
      objectOpen = true;
    }
    if (fieldStart < 0) fieldStart = i;
    i++;
    fieldEnd = i;
  }

  // Tolerate a final object that was never closed with a semicolon.
  if (objectOpen) {
    const len = fieldStart >= 0 ? fieldEnd - fieldStart : 0;
    if (len > 0 || fieldCount > 0) {
      writer.writeI32(len);
      if (len > 0) writer.writeSlice(base + <usize>fieldStart, len);
      fieldCount++;
      writer.patchI32(fieldCountSlot, fieldCount);
      objectCount++;
    }
  }

  writer.patchI32(objectCountSlot, objectCount);
  writer.finish();
  return objectCount;
}
