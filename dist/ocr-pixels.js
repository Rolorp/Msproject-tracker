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

// The center-left of the inventory field is normally blank. Use it to remove
// any horizontal border captured above or below the right-aligned amount.
export function trimBalanceBorders(source, box) {
  const width = box.x1 - box.x0;
  const start = Math.ceil(box.x0 + width * .15), end = Math.floor(box.x0 + width * .40);
  if (end <= start) return box;
  const rows = [];
  for (let y = Math.ceil(box.y0); y < Math.floor(box.y1); y += 1) {
    let brightness = 0;
    for (let x = start; x < end; x += 1) {
      const index = (y * source.width + x) * 4;
      brightness += (source.data[index] + source.data[index + 1] + source.data[index + 2]) / 3;
    }
    rows.push({ y, mean: brightness / (end - start) });
  }
  const peak = Math.max(...rows.map(row => row.mean));
  const light = rows.filter(row => row.mean >= peak - 19);
  if (!light.length || light.length < rows.length * .45) return box;
  return { ...box, y0: light[0].y, y1: light.at(-1).y + 1 };
}

export function panelPixels(source, box, { invert = false, binary = false, redText = false, whiteText = false, threshold = 150 } = {}) {
  const height = 96, margin = 8;
  const innerWidth = Math.max(1, Math.round((box.x1 - box.x0) * height / (box.y1 - box.y0)));
  const inner = resizePixels(source, box, innerWidth, height);
  const width = innerWidth + margin * 2, outputHeight = height + margin * 2;
  const data = new Uint8ClampedArray(width * outputHeight * 4).fill(255);
  let minimum = 255, maximum = 0;
  for (let i = 0; i < inner.data.length; i += 4) {
    const red = inner.data[i], green = inner.data[i + 1], blue = inner.data[i + 2];
    let gray = Math.round(red * .299 + green * .587 + blue * .114);
    if (whiteText) gray = Math.min(red, green, blue);
    if (redText) gray = Math.max(0, 255 - 4 * Math.max(0, red - green));
    inner.data[i] = gray;
    minimum = Math.min(minimum, gray); maximum = Math.max(maximum, gray);
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < innerWidth; x += 1) {
    const i = (y * innerWidth + x) * 4;
    let gray = maximum > minimum ? (inner.data[i] - minimum) * 255 / (maximum - minimum) : inner.data[i];
    if (invert) gray = 255 - gray;
    if (binary) gray = gray < threshold ? 0 : 255;
    const target = ((y + margin) * width + x + margin) * 4;
    data[target] = gray; data[target + 1] = gray; data[target + 2] = gray;
  }
  return { data, width, height: outputHeight };
}

// Normalize the margins around the actual glyphs so OCR does not see the
// inventory frame or a long blank field as part of the number.
export function balanceDigits(pixels, threshold) {
  const { data, width, height } = pixels;
  const border = 8;
  const columns = [];
  for (let x = border; x < width - border; x += 1) {
    let top = height, bottom = 0;
    for (let y = border; y < height - border; y += 1) {
      if (data[(y * width + x) * 4] >= threshold) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
    if (bottom - top >= 10 && bottom - top < 86) columns.push({ x, top, bottom });
  }
  if (!columns.length) return null;
  const first = columns[0].x, last = columns.at(-1).x;
  // A crop that starts inside a digit or has widely separated marks is unsafe.
  if (first < border + 3 || last > width - border - 3 || width - border - last > height * .65 ||
      columns.some((column, index) => index > 0 && column.x - columns[index - 1].x > 34)) return null;
  const x0 = first - 4, x1 = last + 4;
  const y0 = Math.max(1, Math.min(...columns.map(column => column.top)) - 7);
  const y1 = Math.min(height - 1, Math.max(...columns.map(column => column.bottom)) + 13);
  if (x1 - x0 < 8 || y1 - y0 < 15) return null;
  const padding = 16;
  const outputWidth = x1 - x0 + padding * 2;
  const outputHeight = y1 - y0 + padding * 2;
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4).fill(255);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    if (data[(y * width + x) * 4] >= threshold) continue;
    const index = ((y - y0 + padding) * outputWidth + x - x0 + padding) * 4;
    output.fill(0, index, index + 3);
  }
  return { data: output, width: outputWidth, height: outputHeight };
}
