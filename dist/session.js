export function integer(value, label, minimum = 0) {
  if (String(value).trim() === '') throw new Error(`Completa ${label}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new Error(`${label} debe ser un número entero igual o mayor que ${minimum}.`);
  }
  return number;
}

export function createSession(data, now, id) {
  return {
    id,
    character: String(data.character || '').trim(),
    map: String(data.map || '').trim(),
    initialLevel: integer(data.level, 'el nivel inicial', 1),
    initialExp: integer(data.exp, 'la EXP inicial'),
    initialMesos: integer(data.mesos, 'los mesos iniciales'),
    startedAt: now,
    resumedAt: now,
    activeMs: 0,
    status: 'running'
  };
}

export function activeMilliseconds(session, now) {
  const runningMs = session.status === 'running' ? Math.max(0, now - session.resumedAt) : 0;
  return session.activeMs + runningMs;
}

export function pauseSession(session, now) {
  if (session.status !== 'running') throw new Error('La sesión debe estar en curso.');
  return { ...session, activeMs: activeMilliseconds(session, now), resumedAt: null, status: 'paused' };
}

export function resumeSession(session, now) {
  if (session.status !== 'paused') throw new Error('La sesión debe estar pausada.');
  return { ...session, resumedAt: now, status: 'running' };
}

export function stopSession(session, now) {
  if (!['running', 'paused'].includes(session.status)) throw new Error('La sesión ya finalizó.');
  return { ...session, activeMs: activeMilliseconds(session, now), resumedAt: null, endedAt: now, status: 'finishing' };
}

export function finishSession(session, data) {
  if (session.status !== 'finishing') throw new Error('Finaliza el cronómetro primero.');
  if (session.activeMs < 1000) throw new Error('Registra al menos un segundo de tiempo activo.');
  const finalLevel = integer(data.level, 'el nivel final', session.initialLevel);
  const finalExp = integer(data.exp, 'la EXP final');
  const finalMesos = integer(data.mesos, 'los mesos finales');
  const externalDeposits = integer(data.deposits || 0, 'los depósitos externos');
  const externalWithdrawals = integer(data.withdrawals || 0, 'los retiros externos');
  const inventoryCost = integer(data.inventoryCost || 0, 'el coste de consumibles del inventario');
  const expRequirements = data.expRequirements || [];
  if (expRequirements.length !== finalLevel - session.initialLevel) {
    throw new Error('Completa la EXP requerida para cada nivel que superaste.');
  }
  const requirements = expRequirements.map(value => integer(value, 'la EXP requerida por nivel', 1));
  if (requirements.length && session.initialExp >= requirements[0]) {
    throw new Error('La EXP inicial debe ser menor que la requerida para superar ese nivel.');
  }
  const expGained = finalExp - session.initialExp + requirements.reduce((sum, value) => sum + value, 0);
  const netMesos = finalMesos - session.initialMesos - externalDeposits + externalWithdrawals - inventoryCost;
  if (!Number.isSafeInteger(expGained) || !Number.isSafeInteger(netMesos)) {
    throw new Error('Los valores exceden el rango de cálculo admitido.');
  }
  const hours = session.activeMs / 3_600_000;
  const elapsedMs = Math.max(session.activeMs, session.endedAt - session.startedAt);
  return {
    ...session, status: 'completed', finalLevel, finalExp, finalMesos,
    externalDeposits, externalWithdrawals, inventoryCost, expRequirements: requirements,
    expGained, netMesos, elapsedMs,
    expPerHour: expGained / hours,
    mesosPerHour: netMesos / hours,
    elapsedExpPerHour: expGained * 3_600_000 / elapsedMs,
    elapsedMesosPerHour: netMesos * 3_600_000 / elapsedMs
  };
}
