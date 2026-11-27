import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceDigits, resizePixels, panelPixels, trimBalanceBorders } from '../dist/ocr-pixels.js';

test('el escalado tiene resultados definidos por píxel sin depender del Canvas del navegador', () => {
  const source = { width: 2, height: 2, data: Uint8ClampedArray.from([0,0,0,255, 100,100,100,255, 200,200,200,255, 252,252,252,255]) };
  const whole = { x0: 0, y0: 0, x1: 2, y1: 2 };
  assert.deepEqual([...resizePixels(source, whole, 1, 1).data], [138,138,138,255]);
  assert.deepEqual(resizePixels(source, whole, 2, 2).data, source.data);
  const crop = resizePixels(source, { x0: 1, y0: 1, x1: 2, y1: 2 }, 1, 1);
  assert.deepEqual([...crop.data], [252,252,252,255]);
});

test('los recortes mantienen el margen blanco y producen una variante binaria estable', () => {
  const source = { width: 2, height: 2, data: Uint8ClampedArray.from([0,0,0,255, 100,100,100,255, 200,200,200,255, 252,252,252,255]) };
  for (const options of [{}, { invert: true }, { binary: true }]) {
    const result = panelPixels(source, { x0: 0, y0: 0, x1: 2, y1: 2 }, options);
    assert.equal(result.width, 112);
    assert.equal(result.height, 112);
    assert.deepEqual([...result.data.slice(0, 4)], [255,255,255,255]);
    if (options.binary) assert.ok([...result.data].every(value => value === 0 || value === 255));
  }
});

test('retira los bordes de la casilla sin recortar horizontalmente el saldo', () => {
  const width = 30, height = 10;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  data.fill(80, 0, width * 8);
  data.fill(80, width * 9 * 4);
  const box = { x0: 0, y0: 0, x1: width, y1: height };
  assert.deepEqual(trimBalanceBorders({ data, width, height }, box), { ...box, y0: 2, y1: 9 });
});

test('encuadra los dígitos de la derecha y rechaza marcas separadas que podrían ser un prefijo', () => {
  const width = 230, height = 112;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pixels = { data, width, height };
  const stroke = (x0, x1) => {
    for (let y = 25; y < 85; y += 1) for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      data.fill(50, index, index + 3);
    }
  };
  stroke(173, 187);
  stroke(197, 210);
  const amount = balanceDigits(pixels, 155);
  assert.ok(amount.width < width);
  assert.equal(amount.data[0], 255);
  assert.ok(amount.data.includes(0));
  stroke(113, 129);
  assert.equal(balanceDigits(pixels, 155), null);
});
