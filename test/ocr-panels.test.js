import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPanelRegions, resourceParts, mesosLabelRegions } from '../dist/ocr-panels.js';

import { panelImage } from './helpers/panel-image.js';

test('identifica filas por estructura de paneles y la casilla de mesos', () => {
  const regions = detectPanelRegions(panelImage());
  assert.equal(regions.length, 23);
  assert.deepEqual(regions.slice(0, 7).map(region => region.label), ['NAME', 'JOB', 'LEVEL', 'HP', 'MP', 'EXP', 'FAME']);
  assert.deepEqual(regions.slice(7, 11).map(region => region.label), ['STR', 'DEX', 'INT', 'LUK']);
  assert.equal(regions.at(-1).label, 'MESOS');
  assert.ok(regions.every(region => region.x1 > region.x0 && region.y1 > region.y0));
});

test('la detección sigue los paneles cuando se desplazan', () => {
  const original = detectPanelRegions(panelImage());
  const shifted = detectPanelRegions(panelImage({ offset: 37 }));
  assert.equal(shifted.length, original.length);
  assert.ok(shifted.every((region, index) => Math.abs(region.x0 - original[index].x0 - 37) < 2));
});

test('el inventario puede estar a la derecha de la ficha y de sus detalles', () => {
  const original = panelImage();
  const width = 1400;
  const moved = { width, height: original.height, data: new Uint8ClampedArray(width * original.height * 4).fill(255) };
  for (let y = 0; y < original.height; y += 1) for (let x = 0; x < original.width; x += 1) {
    const inventory = x >= 30 && x < 330 && y >= 390 && y < 435;
    if (!inventory) moved.data.set(original.data.subarray((y * original.width + x) * 4, (y * original.width + x + 1) * 4), (y * width + x) * 4);
  }
  for (let y = 390; y < 435; y += 1) for (let x = 30; x < 330; x += 1) {
    moved.data.set(original.data.subarray((y * original.width + x) * 4, (y * original.width + x + 1) * 4), (y * width + x + 850) * 4);
  }
  const regions = detectPanelRegions(moved);
  assert.ok(regions.some(region => region.label === 'NAME' && region.x0 < 500));
  assert.ok(regions.some(region => region.label === 'ATTACK'));
  assert.ok(regions.some(region => region.label === 'MESOS' && region.x0 > 900));
});

test('una ficha o unos detalles incompletos conservan los campos sin identificación', () => {
  const incompleteCharacter = detectPanelRegions(panelImage({ pinkCount: 6 }));
  assert.ok(incompleteCharacter.every(region => !['NAME', 'HP', 'STR', 'ABILITY POINT'].includes(region.label)));
  const incompleteCombat = detectPanelRegions(panelImage({ blueCount: 9 }));
  assert.ok(incompleteCombat.every(region => region.label !== 'ATTACK'));
});

test('una imagen sin la estructura de las ventanas utiliza la lectura general', () => {
  assert.deepEqual(detectPanelRegions({ data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 }), []);
});

test('localiza el saldo por su etiqueta cuando no se detecta moneda o marco', () => {
  const blocks = [{ paragraphs: [{ lines: [{ words: [
    { text: 'MESOS', bbox: { x0: 300, x1: 350, y0: 100, y1: 115 } },
    { text: '99,958', bbox: { x0: 200, x1: 260, y0: 100, y1: 115 } }
  ] }] }] }];
  const [region] = mesosLabelRegions(blocks, 1000, 800);
  assert.ok(region.x0 <= 200 && region.x1 >= 260 && region.x1 < 300);
  assert.ok(region.y0 <= 100 && region.y1 >= 115);
  assert.deepEqual(mesosLabelRegions([], 1000, 800), []);
});

test('separa una fracción por la barra diagonal y evita deducirla de una cadena de dígitos', () => {
  const width = 120, height = 40;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const dark = (x, y) => data.set([20, 20, 20, 255], (y * width + x) * 4);
  for (let y = 10; y < 30; y += 1) {
    for (let x = 20; x < 23; x += 1) dark(x, y);
    for (let x = 80; x < 83; x += 1) dark(x, y);
  }
  const region = { label: 'HP', x0: 0, y0: 0, x1: width, y1: height };
  assert.deepEqual(resourceParts({ data, width, height }, region), []);
  for (let y = 10; y < 30; y += 1) dark(60 + Math.round((29 - y) * .3), y);
  const parts = resourceParts({ data, width, height }, region);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].x1 < parts[1].x0);
  assert.ok(parts[0].x1 > 23 && parts[1].x0 < 80);
});
