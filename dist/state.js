export function emptyState() {
  return { version: 1, revision: 0, current: null, history: [], profiles: [] };
}

export function restoreState(raw) {
  if (!raw) return emptyState();
  const saved = JSON.parse(raw);
  if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || !Array.isArray(saved.history)) {
    throw new Error('El formato de los datos guardados no es compatible.');
  }
  // Versions before profiles used the same storage key and session format.
  const profiles = saved.profiles ?? [];
  if (!Array.isArray(profiles)) throw new Error('No se pudieron leer los perfiles guardados.');
  return { ...saved, profiles };
}
