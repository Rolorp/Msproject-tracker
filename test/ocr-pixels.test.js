import test from 'node:test';
import assert from 'node:assert/strict';
import { resizePixels, panelPixels } from '../dist/ocr-pixels.js';

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
