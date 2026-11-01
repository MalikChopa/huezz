// Small GIF89a reader used by the tests (and by a throw-away frame extractor): walks the blocks,
// decodes the LZW data with its own implementation (independent of scripts/gif.mjs) and composes full frames.

/** LZW decoder for the GIF flavour. Returns the index stream. */
export function lzwDecode(bytes, minCodeSize, expected) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const lengths = new Int32Array(4096);
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let prev = -1;
  const out = new Uint8Array(expected);
  let o = 0;
  let acc = 0;
  let nbits = 0;
  let p = 0;
  const first = (code) => {
    while (code >= clear + 2) code = prefix[code];
    return code;
  };
  const write = (code) => {
    const len = code < clear ? 1 : lengths[code];
    let i = o + len - 1;
    let c = code;
    while (c >= clear + 2) {
      out[i--] = suffix[c];
      c = prefix[c];
    }
    out[i] = c;
    o += len;
  };
  for (;;) {
    while (nbits < codeSize) {
      if (p >= bytes.length) return out.subarray(0, o);
      acc |= bytes[p++] << nbits;
      nbits += 8;
    }
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    nbits -= codeSize;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (prev === -1) {
      write(code);
      prev = code;
      continue;
    }
    if (code < next) {
      write(code);
      if (next < 4096) {
        prefix[next] = prev;
        suffix[next] = first(code);
        lengths[next] = (prev < clear ? 1 : lengths[prev]) + 1;
        next++;
      }
    } else if (code === next && next < 4096) {
      prefix[next] = prev;
      suffix[next] = first(prev);
      lengths[next] = (prev < clear ? 1 : lengths[prev]) + 1;
      next++;
      write(code);
    } else throw new Error(`lzwDecode: bad code ${code} (next ${next})`);
    if (next === 1 << codeSize && codeSize < 12) codeSize++;
    prev = code;
  }
  return out.subarray(0, o);
}

/** Parse a GIF and return its structure and the composed RGBA frames. */
export function decodeGif(buf) {
  const header = buf.toString('latin1', 0, 6);
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  let pos = 13;
  let globalTable = null;
  if (packed & 0x80) {
    const n = 1 << ((packed & 7) + 1);
    globalTable = buf.subarray(pos, pos + n * 3);
    pos += n * 3;
  }
  const info = { header, width, height, loops: null, frames: [], trailer: false, comments: 0, otherExtensions: [] };
  const canvas = new Uint8Array(width * height * 4); // transparent black
  let gce = null;
  while (pos < buf.length) {
    const tag = buf[pos++];
    if (tag === 0x3b) {
      info.trailer = true;
      break;
    }
    if (tag === 0x21) {
      const label = buf[pos++];
      const blocks = [];
      for (;;) {
        const len = buf[pos++];
        if (len === 0) break;
        blocks.push(buf.subarray(pos, pos + len));
        pos += len;
      }
      if (label === 0xf9) {
        gce = { disposal: (blocks[0][0] >> 2) & 7, transparent: (blocks[0][0] & 1) === 1, delay: blocks[0].readUInt16LE(1), transIdx: blocks[0][3] };
      } else if (label === 0xff && blocks[0].toString('latin1') === 'NETSCAPE2.0') info.loops = blocks[1].readUInt16LE(1);
      else if (label === 0xfe) info.comments++;
      else info.otherExtensions.push(label);
      continue;
    }
    if (tag !== 0x2c) throw new Error(`decodeGif: unknown block 0x${tag.toString(16)} at ${pos - 1}`);
    const left = buf.readUInt16LE(pos);
    const top = buf.readUInt16LE(pos + 2);
    const w = buf.readUInt16LE(pos + 4);
    const h = buf.readUInt16LE(pos + 6);
    const ipacked = buf[pos + 8];
    pos += 9;
    let table = globalTable;
    if (ipacked & 0x80) {
      const n = 1 << ((ipacked & 7) + 1);
      table = buf.subarray(pos, pos + n * 3);
      pos += n * 3;
    }
    const minCode = buf[pos++];
    const data = [];
    for (;;) {
      const len = buf[pos++];
      if (len === 0) break;
      data.push(buf.subarray(pos, pos + len));
      pos += len;
    }
    const indices = lzwDecode(Buffer.concat(data), minCode, w * h);
    if (indices.length !== w * h) throw new Error(`decodeGif: ${indices.length} indices for ${w}x${h}`);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = indices[y * w + x];
        if (gce?.transparent && k === gce.transIdx) continue;
        const d = ((top + y) * width + left + x) * 4;
        canvas[d] = table[k * 3];
        canvas[d + 1] = table[k * 3 + 1];
        canvas[d + 2] = table[k * 3 + 2];
        canvas[d + 3] = 255;
      }
    }
    info.frames.push({ left, top, w, h, delay: gce?.delay ?? 0, disposal: gce?.disposal ?? 0, transparent: gce?.transparent ?? false, localTable: (ipacked & 0x80) !== 0, rgba: canvas.slice() });
    gce = null;
  }
  return info;
}
