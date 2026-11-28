import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, activeMilliseconds, pauseSession, resumeSession, stopSession, finishSession, recordLiveProgress } from '../dist/session.js';

const initial = { character: 'Mapler', map: 'Mapa de prueba', level: 30, exp: 200, mesos: 1000 };
const final = { level: 30, exp: 800, mesos: 2500 };
const start = () => createSession(initial, 1000, 'test-session');

test('el tiempo se recupera desde marcas de tiempo y excluye las pausas', () => {
  const session = JSON.parse(JSON.stringify(start()));
  assert.equal(activeMilliseconds(session, 61_000), 60_000);
  const paused = pauseSession(session, 61_000);
  assert.equal(activeMilliseconds(paused, 121_000), 60_000);
  const resumed = resumeSession(paused, 121_000);
  const stopped = stopSession(resumed, 181_000);
  assert.equal(stopped.activeMs, 120_000);
  assert.equal(activeMilliseconds(stopped, 999_000), 120_000);
  assert.throws(() => stopSession(stopped, 999_000));
});

test('calcula tasas activas y totales con unidades correctas', () => {
  const paused = pauseSession(start(), 1_801_000);
  const result = finishSession(stopSession(paused, 3_601_000), final);
  assert.equal(result.expGained, 600);
  assert.equal(result.netMesos, 1500);
  assert.equal(result.expPerHour, 1200);
  assert.equal(result.mesosPerHour, 3000);
  assert.equal(result.elapsedExpPerHour, 600);
  assert.equal(result.elapsedMesosPerHour, 1500);
  assert.equal(result.activeMs, 1_800_000);
});

test('la lectura en vivo conserva el último saldo y usa el tiempo activo de cada lectura', () => {
  const resumed = resumeSession(pauseSession(start(), 61_000), 121_000);
  const withBalance = recordLiveProgress({}, { level: 30, exp: 200, mesos: 1500 }, resumed, 181_000);
  assert.deepEqual(withBalance.mesos, { value: 1500, rate: 15000, capturedAt: 181_000 });
  const withoutInventory = recordLiveProgress(withBalance, { level: 30, exp: 150, expPercent: 5 }, resumed, 241_000);
  assert.equal(withoutInventory.exp.rate, -1000);
  assert.equal(withoutInventory.mesos, withBalance.mesos);
  assert.equal(recordLiveProgress(withoutInventory, { mesos: 0 }, resumed, 241_000).mesos.value, 0);
});

test('confirma un nivel nuevo antes de usarlo y deja la tasa pendiente al cruzar niveles', () => {
  const session = start();
  const first = recordLiveProgress({}, { level: 30, exp: 400 }, session, 61_000);
  const pending = recordLiveProgress(first, { level: 31, exp: 20 }, session, 71_000);
  assert.equal(pending.exp, first.exp);
  assert.equal(pending.pendingLevel, 31);
  const accepted = recordLiveProgress(pending, { level: 31, exp: 23 }, session, 81_000);
  assert.equal(accepted.exp.level, 31);
  assert.equal(accepted.exp.rate, null);
  const staleLevel = recordLiveProgress(accepted, { level: 30, exp: 400 }, session, 85_000);
  assert.equal(staleLevel.exp, accepted.exp);
});

test('una lectura de solo porcentaje conserva la EXP absoluta, su hora y su tasa', () => {
  const session = start();
  const first = recordLiveProgress({}, { level: 30, exp: 400 }, session, 61_000);
  const percentOnly = recordLiveProgress(first, { level: 30, expPercent: 35.92, mesos: 12 }, session, 71_000);
  assert.equal(percentOnly.exp, first.exp);
  assert.equal(percentOnly.mesos.value, 12);
});

test('usa todos los requisitos manuales cuando se superan varios niveles', () => {
  const stopped = stopSession(start(), 3_601_000);
  const result = finishSession(stopped, { ...final, level: 32, exp: 100, expRequirements: [1000, 1500] });
  assert.equal(result.expGained, 2400);
  assert.equal(result.expPerHour, 2400);
  assert.throws(() => finishSession(stopped, { ...final, level: 32, expRequirements: [1000] }));
  assert.throws(() => finishSession(stopped, { ...final, level: 31, expRequirements: [100] }));
});

test('ajusta transferencias y consumibles sin descontar de nuevo las compras del saldo', () => {
  const result = finishSession(stopSession(start(), 3_601_000), {
    ...final, deposits: 1000, withdrawals: 200, inventoryCost: 300
  });
  assert.equal(result.netMesos, 400);
  assert.equal(result.mesosPerHour, 400);
});

test('conserva pérdidas reales de EXP y mesos', () => {
  const result = finishSession(stopSession(start(), 3_601_000), { ...final, exp: 100, mesos: 500 });
  assert.equal(result.expGained, -100);
  assert.equal(result.netMesos, -500);
});

test('rechaza entradas incompletas, duraciones nulas y transiciones repetidas', () => {
  assert.throws(() => createSession({ ...initial, exp: '' }, 0, 'invalid'));
  assert.throws(() => createSession({ ...initial, mesos: -1 }, 0, 'invalid'));
  assert.throws(() => finishSession(stopSession(start(), 1000), final));
  assert.throws(() => finishSession(start(), final));
  assert.throws(() => resumeSession(start(), 2000));
  assert.throws(() => pauseSession(pauseSession(start(), 2000), 3000));
  assert.throws(() => finishSession(stopSession(start(), 5000), { ...final, level: 29 }));
  assert.throws(() => finishSession(stopSession(start(), 5000), { ...final, mesos: 1.2 }));
});
