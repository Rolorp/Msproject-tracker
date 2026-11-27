import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewGroup } from '../dist/ocr-review.js';
import { extractHudClass, rightAlignedBalance, confirmedBalance } from '../dist/ocr-evidence.js';

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

test('exige que el importe completo se encuentre al extremo derecho del saldo', () => {
  const reading = (text, x0, x1) => ({ blocks: [{ paragraphs: [{ lines: [{ words: [{ text, bbox: { x0, x1, y0: 30, y1: 82 } }] }] }] }] });
  assert.ok(rightAlignedBalance(reading('99,958', 700, 1010), 1048, 112));
  assert.ok(!rightAlignedBalance(reading('2', 20, 50), 1048, 112));
  assert.ok(!rightAlignedBalance(reading('99)', 700, 1010), 1048, 112));
  assert.ok(!rightAlignedBalance({ blocks: [] }, 1048, 112));
});

test('acepta lecturas completas coincidentes aunque el pixel font tenga confianza baja', () => {
  const first = { value: 99958, aligned: true, confidence: 8 };
  assert.equal(confirmedBalance([first, { ...first }]), '99958');
  assert.equal(confirmedBalance([first, { ...first, value: 2 }]), '');
  assert.equal(confirmedBalance([{ value: 2, aligned: false }, { value: 2, aligned: false }]), '');
  assert.equal(confirmedBalance([first, { aligned: true }]), '');
  assert.equal(confirmedBalance([first]), '');
  assert.equal(confirmedBalance([{ value: 0, aligned: true }, { value: 0, aligned: true }]), '0');
});

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
