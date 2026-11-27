import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeCharacterImage } from '../dist/ocr-image.js';
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
