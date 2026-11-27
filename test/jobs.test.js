import test from 'node:test';
import assert from 'node:assert/strict';
import { JOBS, parseClass, profileClass, validClass } from '../dist/jobs.js';
import { extractValues } from '../dist/ocr-parser.js';
import { saveProfile } from '../dist/profile.js';

test('ofrece solo cuatro jobs y valida las diez especializaciones correspondientes', () => {
  assert.equal(Object.keys(JOBS).length, 4);
  assert.equal(Object.values(JOBS).flat().length, 10);
  for (const [job, names] of Object.entries(JOBS)) {
    assert.ok(validClass(job));
    for (const specialization of names) {
      assert.ok(validClass(job, specialization));
      assert.deepEqual(parseClass(specialization), { job, specialization });
    }
  }
  assert.ok(!validClass('Pirate'));
  assert.ok(!validClass('Warrior', 'Bandit'));
  assert.ok(!validClass('Thief', 'Hermit'));
  assert.throws(() => saveProfile([], { job: 'Magician', specialization: 'Hunter' }, 'id', 1));
});

test('separa perfiles anteriores al editarlos sin modificar el registro original', () => {
  const previous = { job: 'MAGICIAN / WIZARD-FIRE/POISON' };
  assert.deepEqual(profileClass(previous), { job: 'Magician', specialization: 'Wizard (Fire/Poison)' });
  assert.equal(previous.job, 'MAGICIAN / WIZARD-FIRE/POISON');
  assert.deepEqual(profileClass({ job: 'Bandit' }), { job: 'Thief', specialization: 'Bandit' });
});

test('extrae los dos campos y no asigna especializaciones incompatibles', () => {
  assert.deepEqual(extractValues('JOB MAGICIAN\nSPECIALIZATION WIZARD-FIRE/POISON\nLEVEL 45').values,
    { job: 'Magician', specialization: 'Wizard (Fire/Poison)', level: 45 });
  assert.deepEqual(extractValues('JOB WARRIOR\nSPECIALIZATION BANDIT').values, {});
  assert.deepEqual(extractValues('JOB PIRATE').values, {});
  assert.deepEqual(extractValues('JOB MAGICIAN').values, { job: 'Magician' });
  assert.deepEqual(extractValues('JOB MRGICIAN\nSPECIALIZATION WIzARD-FIRE(FOISON |').values,
    { job: 'Magician', specialization: 'Wizard (Fire/Poison)' });
});
