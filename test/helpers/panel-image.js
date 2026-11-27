export function panelImage({ pinkCount = 7, blueCount = 10, offset = 0 } = {}) {
  const width = 1000, height = 800;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  function rectangle(x, y, w, h, color) {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x + offset; col < x + offset + w; col += 1) data.set([...color, 255], (row * width + col) * 4);
    }
  }
  let y = 80;
  for (let index = 0; index < pinkCount; index += 1) {
    const h = index === 1 ? 36 : 20;
    rectangle(280, y, 70, h, [195, 70, 110]);
    y += h + 4;
  }
  for (let index = 0; index < 4; index += 1) rectangle(280, 280 + index * 24, 70, 20, [180, 190, 50]);
  for (let index = 0; index < blueCount; index += 1) rectangle(550, 140 + index * 24, 90, 20, [90, 145, 190]);
  rectangle(30, 390, 300, 45, [130, 165, 195]);
  rectangle(48, 402, 14, 14, [230, 190, 20]);
  rectangle(73, 398, 194, 26, [40, 40, 40]);
  rectangle(75, 400, 190, 22, [250, 250, 245]);
  rectangle(390, 390, 46, 26, [40, 40, 40]);
  rectangle(392, 392, 42, 22, [250, 250, 245]);
  return { data, width, height };
}

