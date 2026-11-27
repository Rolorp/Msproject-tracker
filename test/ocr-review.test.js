import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewGroup } from '../dist/ocr-review.js';
import { extractHudClass } from '../dist/ocr-evidence.js';

test('los atributos leídos no aparecen pendientes y las bases sin desglose son opcionales', () => {
  const values = { strTotal: 4, dexTotal: 4, int: 204, intTotal: 222, apAvailable: 0 };
  assert.equal(reviewGroup('strTotal', values), 'detected');
  assert.equal(reviewGroup('dexTotal', values), 'detected');
  assert.equal(reviewGroup('str', values), 'base');
  assert.equal(reviewGroup('dex', values), 'base');
  assert.equal(reviewGroup('int', values), 'detected');
  assert.equal(reviewGroup('apAvailable', values), 'detected');
  assert.equal(reviewGroup('mesos', values), 'missing');
  assert.equal(reviewGroup('mesos', values, { mesos: '0' }), 'preserved');
  assert.equal(reviewGroup('strTotal', {}, { strTotal: '4' }), 'preserved');
  assert.equal(reviewGroup('str', {}, { strTotal: '4' }), 'base');
});

const blocks = lines => [{ paragraphs: [{ lines: lines.map(words => ({ words: words.map(text => ({ text, confidence: 90 })) })) }] }];

test('lee la especialización en la barra inferior, separada de HP, MP y nombre', () => {
  assert.deepEqual(extractHudClass(blocks([['Wizard', '(Fire,Poison)', 'HP(611/1054)'], ['Mapler']])),
    { job: 'Magician', specialization: 'Wizard (Fire/Poison)' });
  assert.equal(extractHudClass(blocks([['Wizard'], ['Fire', 'Poison']])), null);
  assert.equal(extractHudClass(blocks([['Cleric'], ['Bandit']])), null);
});

test('usa la especialización sobre el nombre y excluye menciones en el chat', () => {
  const makeLine = (words, x0, y0) => ({ bbox: { x0, y0, x1: x0 + 160, y1: y0 + 20 }, words: words.map((text, index) => ({ text, confidence: index ? 38 : 90 })) });
  const reading = [{ paragraphs: [{ lines: [
    makeLine(['Bandit'], 20, 10),
    makeLine(['Wizard', '(Fire,', 'Poison)'], 200, 100),
    makeLine(['Mapler'], 200, 122)
  ] }] }];
  assert.deepEqual(extractHudClass(reading, 'Mapler'), { job: 'Magician', specialization: 'Wizard (Fire/Poison)' });
  assert.equal(extractHudClass(reading, 'Otro'), null);
});
