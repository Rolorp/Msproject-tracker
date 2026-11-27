import test from 'node:test';
import assert from 'node:assert/strict';
import { extractValues } from '../dist/ocr-parser.js';

test('lee números enteros y separadores de miles con varias etiquetas por línea', () => {
  const { values } = extractValues('LEVEL 32 EXP 12,345 (23.45%)\nMESOS 1.234.567\nAccuracy 1 234');
  assert.deepEqual(values, { level: 32, exp: 12345, expPercent: 23.45, mesos: 1234567, accuracy: 1234 });
});

test('la EXP toma el valor actual y los máximos de HP y MP proceden de las fracciones', () => {
  const { values } = extractValues('EXP 1,200 / 5,000 (24%)\nHP 900 / 1,200\nMP 10 / 150\nMAX HP 1200');
  assert.deepEqual(values, { exp: 1200, expPercent: 24, currentHp: 900, maxHp: 1200, currentMp: 10, maxMp: 150 });
  assert.deepEqual(extractValues('HP 900\nMP 10').values, { currentHp: 900, currentMp: 10 });
});

test('extrae atributos base únicamente de etiquetas explícitas o sumas consistentes', () => {
  const { values, warnings } = extractValues('STR 120 (100+20)\nDEX 44 (40 + 4)\nBASE INT 10\nLUK 60');
  assert.deepEqual(values, { str: 100, strTotal: 120, dex: 40, dexTotal: 44, int: 10, lukTotal: 60 });
  assert.equal(warnings.length, 0);
  assert.deepEqual(extractValues('STR 120 (90+20)').values, { strTotal: 120 });
});

test('guarda el porcentaje separado de EXP y rechaza valores ambiguos', () => {
  const text = 'EXP 24.5%\nMESOS 12O00\nWeapon Attack 10~20\nMagic Attack 12.34\nLEVEL 0\nAccuracy 999999999999999999';
  assert.deepEqual(extractValues(text).values, { expPercent: 24.5 });
});

test('retira valores contradictorios y permite repeticiones idénticas', () => {
  const result = extractValues('LEVEL 32\nLEVEL 33\nLEVEL 32\nMESOS 500\nMESOS 500');
  assert.deepEqual(result.values, { mesos: 500 });
  assert.equal(result.warnings.length, 1);
});

test('asocia mesos al saldo de su propia línea y no a cantidades de otras filas', () => {
  assert.deepEqual(extractValues('99,958 MESOS\n2\nLEVEL 45').values, { mesos: 99958, level: 45 });
  assert.deepEqual(extractValues('MESOS\n2').values, {});
  assert.deepEqual(extractValues('MESOS 2').values, { mesos: 2 });
  assert.deepEqual(extractValues('99,958 MESOS 2').values, {});
  assert.deepEqual(extractValues('MESOS 99)').values, {});
});

test('identifica etiquetas compactas y ataques explícitos sin interpretar palabras parecidas', () => {
  assert.deepEqual(extractValues('Lv.32\nW.ATK 42\nM.ATK 75\nAvoidability 23\nLEVELING 100\nATTACK 10~20').values, {
    level: 32, weaponAttack: 42, magicAttack: 75, avoidability: 23, attackMin: 10, attackMax: 20
  });
});
