// Resize in JavaScript so the OCR sees the same sampling on Safari and Chrome.
// Canvas is used only to decode the source and to transfer the final pixels.
export function resizePixels(source, box, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  const scaleX = (box.x1 - box.x0) / width, scaleY = (box.y1 - box.y0) / height;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.max(0, Math.min(source.height - 1, box.y0 + (y + .5) * scaleY - .5));
    const y0 = Math.floor(sy), y1 = Math.min(source.height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.max(0, Math.min(source.width - 1, box.x0 + (x + .5) * scaleX - .5));
      const x0 = Math.floor(sx), x1 = Math.min(source.width - 1, x0 + 1), fx = sx - x0;
      const a = (y0 * source.width + x0) * 4, b = (y0 * source.width + x1) * 4;
      const c = (y1 * source.width + x0) * 4, d = (y1 * source.width + x1) * 4;
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[target + channel] = (source.data[a + channel] * (1 - fx) + source.data[b + channel] * fx) * (1 - fy)
          + (source.data[c + channel] * (1 - fx) + source.data[d + channel] * fx) * fy;
      }
      data[target + 3] = 255;
    }
  }
  return { data, width, height };
}

export function panelPixels(source, box, { invert = false, binary = false } = {}) {
  const height = 96, margin = 8;
  const innerWidth = Math.max(1, Math.round((box.x1 - box.x0) * height / (box.y1 - box.y0)));
  const inner = resizePixels(source, box, innerWidth, height);
  const width = innerWidth + margin * 2, outputHeight = height + margin * 2;
  const data = new Uint8ClampedArray(width * outputHeight * 4).fill(255);
  let minimum = 255, maximum = 0;
  for (let i = 0; i < inner.data.length; i += 4) {
    const gray = Math.round(inner.data[i] * .299 + inner.data[i + 1] * .587 + inner.data[i + 2] * .114);
    inner.data[i] = gray;
    minimum = Math.min(minimum, gray); maximum = Math.max(maximum, gray);
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < innerWidth; x += 1) {
    const i = (y * innerWidth + x) * 4;
    let gray = maximum > minimum ? (inner.data[i] - minimum) * 255 / (maximum - minimum) : inner.data[i];
    if (invert) gray = 255 - gray;
    if (binary) gray = gray < 150 ? 0 : 255;
    const target = ((y + margin) * width + x + margin) * 4;
    data[target] = gray; data[target + 1] = gray; data[target + 2] = gray;
  }
  return { data, width, height: outputHeight };
}
