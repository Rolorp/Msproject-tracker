import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import { extractValues } from '../dist/ocr-parser.js';

async function recognizeFixture(filename) {
  const worker = await createWorker('eng', 1, {
    langPath: fileURLToPath(new URL('../node_modules/@tesseract.js-data/eng/4.0.0/', import.meta.url)),
    cacheMethod: 'none'
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
    const image = fileURLToPath(new URL(`./fixtures/${filename}`, import.meta.url));
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return extractValues(data.text, data.blocks);
  } finally {
    await worker.terminate();
  }
}

test('lee una imagen sintética real con el motor OCR y extrae sus valores', async () => {
    const { values, warnings } = await recognizeFixture('ocr-values.png');
    assert.equal(values.level, 32);
    assert.equal(values.exp, 12345);
    assert.equal(values.mesos, 1234567);
    assert.equal(values.maxHp, 1200);
    assert.equal(values.weaponAttack, 42);
    assert.equal(values.magicAttack, 75);
    // The engine may confuse the plus sign with a digit. Ambiguous base AP stays unassigned.
    if (values.str === undefined) assert.ok(warnings.some(warning => warning.includes('STR base')));
    else assert.equal(values.str, 100);
});

test('lee una captura sintética general de paneles y recupera 29 campos', async () => {
  const { values } = await recognizeFixture('ocr-panels.png');
  assert.deepEqual(values, {
    name: 'TestMage', job: 'Magician', specialization: 'Wizard (Fire/Poison)', level: 45,
    currentHp: 611, maxHp: 1054, currentMp: 1923, maxMp: 1978,
    exp: 206845, expPercent: 44, fame: 25,
    strTotal: 4, str: 4, dexTotal: 4, dex: 4, intTotal: 222, int: 204, lukTotal: 40, luk: 33,
    apAvailable: 0, attackMin: 46, attackMax: 61, weaponDefense: 154,
    magicAttack: 198, magicDefense: 198, accuracy: 95, avoidability: 22,
    critRate: 10, critDamage: 126, speed: 100, jump: 100, mesos: 99958
  });
});
