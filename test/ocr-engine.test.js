import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import { extractValues } from '../dist/ocr-parser.js';

test('lee una imagen sintética real con el motor OCR y extrae sus valores', async () => {
  const worker = await createWorker('eng', 1, {
    langPath: fileURLToPath(new URL('../node_modules/@tesseract.js-data/eng/4.0.0/', import.meta.url)),
    cacheMethod: 'none'
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const image = fileURLToPath(new URL('./fixtures/ocr-values.png', import.meta.url));
    const { data } = await worker.recognize(image);
    const { values, warnings } = extractValues(data.text);
    assert.equal(values.level, 32);
    assert.equal(values.exp, 12345);
    assert.equal(values.mesos, 1234567);
    assert.equal(values.maxHp, 1200);
    assert.equal(values.weaponAttack, 42);
    assert.equal(values.magicAttack, 75);
    // The engine may confuse the plus sign with a digit. Ambiguous base AP stays unassigned.
    if (values.str === undefined) assert.ok(warnings.some(warning => warning.includes('STR base')));
    else assert.equal(values.str, 100);
  } finally {
    await worker.terminate();
  }
});
