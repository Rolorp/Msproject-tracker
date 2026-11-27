import test from 'node:test';
import assert from 'node:assert/strict';
import { saveProfile } from '../dist/profile.js';
import { restoreState } from '../dist/state.js';
import { createSession, stopSession, finishSession } from '../dist/session.js';

// Synthetic character data checks storage behavior, not Classic World rules.
const data = {
  name: 'Mapler', job: 'Thief', specialization: 'Bandit', level: '32', region: 'Global',
  strTotal: '4', dexTotal: '', intTotal: '0', lukTotal: '120',
  spPools: [{ name: 'Primer avance', available: '0' }, { name: 'Segundo avance', available: '' }],
  skills: [{ name: 'Habilidad de prueba', rank: '3', pool: 'Segundo avance' }],
  equipment: 'Arma de prueba'
};

test('conserva valores desconocidos y distingue SP libres de distintos avances', () => {
  const [profile] = saveProfile([], data, 'profile-1', 1000);
  assert.equal(profile.attributeTotals.dex, null);
  assert.equal(profile.attributeTotals.int, 0);
  assert.equal(profile.combat.weaponAttack, null);
  assert.deepEqual(profile.spPools.map(pool => pool.available), [0, null]);
  assert.equal(profile.skills[0].rank, 3);
  assert.equal(profile.evidence, 'manual');
  assert.equal(profile.rulesStatus, 'pending');
});

test('rechaza valores incompletos, negativos, fraccionarios y duplicados', () => {
  assert.throws(() => saveProfile([], { ...data, name: '' }, 'x', 1000));
  assert.throws(() => saveProfile([], { ...data, job: '' }, 'x', 1000));
  assert.throws(() => saveProfile([], { ...data, strTotal: -1 }, 'x', 1000));
  assert.throws(() => saveProfile([], { ...data, maxHp: 1.5 }, 'x', 1000));
  assert.throws(() => saveProfile([], { ...data, spPools: [{ name: 'A', available: 0 }, { name: 'a', available: 1 }] }, 'x', 1000));
  assert.throws(() => saveProfile([], { ...data, skills: [data.skills[0], data.skills[0]] }, 'x', 1000));
  assert.throws(() => saveProfile([], { ...data, skills: [{ name: 'Skill', rank: '' }] }, 'x', 1000));
});

test('editar conserva identidad y fecha de creación, y detecta escrituras desactualizadas', () => {
  const original = saveProfile([], data, 'profile-1', 1000);
  const updated = saveProfile(original, { ...data, level: 33 }, 'profile-1', 2000, 1);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, 'profile-1');
  assert.equal(updated[0].level, 33);
  assert.equal(updated[0].createdAt, 1000);
  assert.equal(updated[0].updatedAt, 2000);
  assert.equal(updated[0].revision, 2);
  assert.equal(original[0].level, 32);
  assert.throws(() => saveProfile(updated, data, 'profile-1', 3000, 1));
});

test('editar conserva las bases antiguas sin mostrarlas ni sustituir los totales', () => {
  const [original] = saveProfile([], data, 'profile-1', 1000);
  original.attributes = { str: 4, dex: 4, int: 204, luk: 33 };
  const [updated] = saveProfile([original], { ...data, intTotal: 222, lukTotal: 40 }, 'profile-1', 2000, 1);
  assert.equal(updated.attributeTotals.int, 222);
  assert.equal(updated.attributeTotals.luk, 40);
  assert.deepEqual(updated.attributes, original.attributes);
});

test('la sesión conserva una copia independiente del perfil al editarlo o mutarlo', () => {
  const profiles = saveProfile([], data, 'profile-1', 1000);
  const session = createSession({ character: 'Mapler', level: 32, exp: 100, mesos: 1000 }, 1000, 'session-1', profiles[0]);
  const updated = saveProfile(profiles, { ...data, level: 33 }, 'profile-1', 2000, 1);
  profiles[0].skills[0].rank = 99;
  profiles[0].spPools[0].available = 50;
  const result = finishSession(stopSession(session, 3_601_000), { level: 32, exp: 300, mesos: 1500 });
  assert.equal(updated[0].level, 33);
  assert.equal(result.profileId, 'profile-1');
  assert.equal(result.characterSnapshot.level, 32);
  assert.equal(result.characterSnapshot.skills[0].rank, 3);
  assert.equal(result.characterSnapshot.spPools[0].available, 0);
  assert.equal(result.expPerHour, 200);
});

test('exige que el nombre y nivel de la sesión coincidan con el perfil seleccionado', () => {
  const [profile] = saveProfile([], data, 'profile-1', 1000);
  assert.throws(() => createSession({ character: 'Otro', level: 32, exp: 0, mesos: 0 }, 1000, 'x', profile));
  assert.throws(() => createSession({ character: 'Mapler', level: 33, exp: 0, mesos: 0 }, 1000, 'x', profile));
});

test('recupera registros v0.1, incluidas sesiones abiertas, sin asignarles un perfil', () => {
  const session = createSession({ character: 'Antiguo', level: 20, exp: 100, mesos: 1000 }, 1000, 'old-session');
  delete session.profileId;
  delete session.characterSnapshot;
  const history = [{ ...session, id: 'old-completed', status: 'completed' }];
  const legacy = { version: 1, revision: 5, current: session, history };
  const restored = restoreState(JSON.stringify(legacy));
  assert.deepEqual(restored.profiles, []);
  assert.deepEqual(restored.current, session);
  assert.deepEqual(restored.history, history);
  const savedProfiles = saveProfile(restored.profiles, data, 'new-profile', 2000);
  const roundTrip = restoreState(JSON.stringify({ ...restored, profiles: savedProfiles }));
  assert.deepEqual(roundTrip.current, session);
  assert.equal(roundTrip.profiles[0].name, 'Mapler');
});

test('mantiene el registro manual y rechaza formatos de perfiles incompatibles', () => {
  const session = createSession({ character: '', level: 1, exp: 0, mesos: 0 }, 1000, 'manual');
  assert.equal(session.profileId, null);
  assert.equal(session.characterSnapshot, null);
  assert.deepEqual(restoreState(null).profiles, []);
  assert.throws(() => restoreState(JSON.stringify({ version: 1, revision: 0, history: [], profiles: {} })));
});
