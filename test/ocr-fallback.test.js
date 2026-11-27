import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeCharacterImage, recognizeSessionFrame } from '../dist/ocr-image.js';
import { panelImage } from './helpers/panel-image.js';
import { detectPanelRegions } from '../dist/ocr-panels.js';
import { mergeReadings } from '../dist/ocr-evidence.js';

// Pixel transfer stub: the real resize/detection code runs, while OCR faults
// are injected at its boundary to exercise recovery from unreadable crops.
class PixelCanvas {
  width = 0;
  height = 0;
  data;
  getContext() {
    return {
      fillRect: () => { this.data = new Uint8ClampedArray(this.width * this.height * 4).fill(255); },
      drawImage: image => { this.data = image.data; },
      getImageData: () => ({ data: this.data, width: this.width, height: this.height }),
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      putImageData: pixels => { this.data = pixels.data; }
    };
  }
}

test('lee la EXP de la barra aunque HP y MP queden tapados', async () => {
  const width = 1000, height = 800;
  const source = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new PixelCanvas() };
  const words = [
    { text: 'EXP', bbox: { x0: 960, x1: 1010, y0: 170, y1: 197 } },
    { text: '206,845', bbox: { x0: 1015, x1: 1120, y0: 172, y1: 197 } },
    { text: '(44.16%)', bbox: { x0: 1130, x1: 1240, y0: 172, y1: 197 } }
  ];
  const worker = {
    setParameters: async () => {},
    recognize: async () => ({ data: { text: 'EXP 206,845 (44.16%)', blocks: [{ paragraphs: [{ lines: [{ words }] }] }] } })
  };
  try {
    const result = await recognizeSessionFrame(worker, source, () => false, false, false);
    assert.equal(result.exp, 206845);
    assert.equal(result.expSource, 'hud');
    assert.equal(result.inventory, 'missing');
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('recupera todos los campos generales aunque haya ventanas detectadas y fallen los recortes', async () => {
  const image = panelImage();
  image.naturalWidth = image.width;
  image.naturalHeight = image.height;
  assert.ok(detectPanelRegions(image).length > 0);
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new PixelCanvas() };
  let generalReads = 0;
  const worker = {
    setParameters: async () => {},
    recognize: async canvas => {
      if (canvas.height <= image.height) throw new Error('Unreadable crop');
      generalReads += 1;
      return { data: { text: 'NAME Mapler\nJOB MAGICIAN\nSPECIALIZATION WIZARD-FIRE/POISON\nLEVEL 45\nHP 589/1054\nEXP 206845\nSTR 4\nDEX 4\nINT 222 (204+18)\nLUK 40 (33+7)\n99,958 MESOS', blocks: null } };
    }
  };
  try {
    const result = await recognizeCharacterImage(worker, image, () => {}, () => false);
    assert.equal(generalReads, 1);
    assert.equal(result.values.name, 'Mapler');
    assert.equal(result.values.currentHp, 589);
    assert.equal(result.values.mesos, 99958);
    assert.equal(result.values.specialization, 'Wizard (Fire/Poison)');
    assert.deepEqual(['strTotal', 'dexTotal', 'intTotal', 'lukTotal'].map(key => result.values[key]), [4, 4, 222, 40]);
    assert.equal(result.values.int, undefined);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('la lectura general completa los huecos y conserva los valores ya leídos por ventana', () => {
  const primary = { values: { currentHp: 589, intTotal: 222 }, warnings: [] };
  const general = { values: { currentHp: 5891054, name: 'Mapler', mesos: 99958, intTotal: 204 }, warnings: [] };
  assert.deepEqual(mergeReadings(primary, general).values, { currentHp: 589, intTotal: 222, name: 'Mapler', mesos: 99958 });
});

test('recupera un saldo del inventario cuando la lectura de la casilla completa falla', async () => {
  const image = panelImage();
  image.naturalWidth = image.width;
  image.naturalHeight = image.height;
  for (let y = 406; y < 416; y += 1) for (const x0 of [235, 244, 253]) {
    for (let x = x0; x < x0 + 4; x += 1) image.data.set([35, 35, 35, 255], (y * image.width + x) * 4);
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new PixelCanvas() };
  let stage, mode, isolated = false;
  const worker = {
    setParameters: async parameters => { mode = parameters.tessedit_pageseg_mode; },
    recognize: async canvas => {
      if (!stage.startsWith('MESOS')) return { data: { text: '', blocks: [] } };
      if (mode === '13') isolated = true;
      if (!isolated) return { data: { text: '', blocks: [] } };
      const bbox = mode === '13'
        ? { x0: 0, x1: canvas.width, y0: 0, y1: canvas.height }
        : { x0: 18, x1: canvas.width - 18, y0: 20, y1: canvas.height - 20 };
      const text = '735,104';
      return { data: { confidence: 95, text, blocks: [{ paragraphs: [{ lines: [{ words: [{ text, bbox }] }] }] }] } };
    }
  };
  try {
    const result = await recognizeCharacterImage(worker, image, label => { stage = label; }, () => false);
    assert.equal(isolated, true);
    assert.equal(result.values.mesos, 735104);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
