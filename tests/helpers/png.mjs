import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
export function decodePng(png) {
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  let width, height, channels;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset),
      type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, '8-bit screenshot PNG');
      assert.ok(data[9] === 2 || data[9] === 6, 'RGB or RGBA screenshot PNG');
      channels = data[9] === 6 ? 4 : 3;
      assert.equal(data[12], 0, 'Non-interlaced screenshot PNG');
    }
    if (type === 'IDAT') chunks.push(data);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      da = Math.abs(p - a),
      db = Math.abs(p - b),
      dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[source++];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= channels ? pixels[index - channels] : 0;
      const up = y ? pixels[index - stride] : 0;
      const diagonal = y && x >= channels ? pixels[index - stride - channels] : 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, diagonal)][
        filter
      ];
      assert.notEqual(prediction, undefined, 'Supported PNG scanline filter');
      pixels[index] = (raw[source++] + prediction) & 255;
    }
  }
  let minimumAlpha = 255;
  if (channels === 4)
    for (let index = 3; index < pixels.length; index += 4)
      minimumAlpha = Math.min(minimumAlpha, pixels[index]);
  return {
    width,
    height,
    channels,
    minimumAlpha,
    pixel: (x, y) =>
      Array.from(
        pixels.subarray(
          (Math.floor(y) * width + Math.floor(x)) * channels,
          (Math.floor(y) * width + Math.floor(x)) * channels + 3,
        ),
      ),
  };
}
