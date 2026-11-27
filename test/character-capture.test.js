import test from 'node:test';
import assert from 'node:assert/strict';
import { extractValues, layoutText } from '../dist/ocr-parser.js';
import { saveProfile } from '../dist/profile.js';
import { createSession } from '../dist/session.js';

const transcript = `NAME TestMage
JOB MAGICIAN
2 3 4 5
WIZARD-FIRE/POISON
LEVEL 45
HP 611/1054
MP 1923/1978
EXP. 206845 (44%)
FAME 25
STR 4
DEX 4
INT 222 (204+18)
LUK 40 (33+7)
ABILITY POINT 0
ATTACK 46 - 61
WEAPON DEF. 154
MAGIC 198
MAGIC DEF. 198
ACCURACY 95
EVASION 22
CRIT. RATE 10%
CRIT. DAMAGE 126%
SPEED 100%
JUMP 100%
99,958 MESOS`;

const expected = {
  name: 'TestMage', job: 'Magician', specialization: 'Wizard (Fire/Poison)', level: 45,
  currentHp: 611, maxHp: 1054, currentMp: 1923, maxMp: 1978,
  exp: 206845, expPercent: 44, fame: 25,
  strTotal: 4, dexTotal: 4, intTotal: 222, int: 204, lukTotal: 40, luk: 33,
  apAvailable: 0, attackMin: 46, attackMax: 61, weaponDefense: 154,
  magicAttack: 198, magicDefense: 198, accuracy: 95, avoidability: 22,
  critRate: 10, critDamage: 126, speed: 100, jump: 100, mesos: 99958
};

test('interpreta la ficha y el inventario sin confundir rango, defensa, porcentajes o cantidades de objetos', () => {
  assert.deepEqual(extractValues(transcript).values, expected);
});

test('guarda todos los campos observados y conserva el desglose de AP', () => {
  const [profile] = saveProfile([], { ...extractValues(transcript).values, region: 'Global' }, 'profile', 1000);
  assert.equal(profile.name, 'TestMage');
  assert.equal(profile.attributes.int, 204);
  assert.equal(profile.attributeTotals.int, 222);
  assert.equal(profile.attributes.str, null);
  assert.equal(profile.attributeTotals.str, 4);
  assert.equal(profile.apAvailable, 0);
  assert.equal(profile.fame, 25);
  assert.deepEqual(profile.progress, { exp: 206845, expPercent: 44, mesos: 99958 });
  assert.equal(profile.combat.attackMin, 46);
  assert.equal(profile.combat.attackMax, 61);
  assert.equal(profile.combat.weaponAttack, null);
  assert.equal(profile.combat.weaponDefense, 154);
  assert.equal(profile.combat.magicDefense, 198);
  assert.equal(profile.combat.critDamage, 126);
});

test('el progreso de una sesión refleja los valores de inicio y conserva el perfil original', () => {
  const [profile] = saveProfile([], { ...expected, region: 'Global' }, 'profile', 1000);
  const session = createSession({ character: 'TestMage', level: 45, exp: 207000, mesos: 100000 }, 2000, 'session', profile);
  assert.deepEqual(session.characterSnapshot.progress, { exp: 207000, expPercent: null, mesos: 100000 });
  assert.deepEqual(profile.progress, { exp: 206845, expPercent: 44, mesos: 99958 });
});

test('tolera etiquetas compactas y separadas de sus valores por saltos de línea', () => {
  assert.deepEqual(extractValues('LEVEL45\nWEAPONDEF.154\nMAGICDEF.\n198\nCRIT.RATE 10.5%\nFAME -2\nABILITYPOINT 0').values, {
    level: 45, weaponDefense: 154, magicDefense: 198, critRate: 10.5, fame: -2, apAvailable: 0
  });
});

test('recompone etiquetas y valores que el OCR separó en bloques de columnas', () => {
  const word = (text, x, y) => ({ text, bbox: { x0: x, x1: x + 100, y0: y, y1: y + 20 } });
  const blocks = [
    { paragraphs: [{ lines: [{ words: [word('HP', 50, 30)] }, { words: [word('611/1054', 200, 32)] }] }] },
    { paragraphs: [{ lines: [{ words: [word('99,958', 30, 90)] }, { words: [word('MESOS', 180, 92)] }] }] }
  ];
  assert.match(layoutText(blocks), /HP 611\/1054/);
  assert.deepEqual(extractValues('', blocks).values, { currentHp: 611, maxHp: 1054, mesos: 99958 });
});
