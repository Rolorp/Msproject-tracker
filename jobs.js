// Catalog limited to the four branches and their second advancements.
// Reviewed 2026-11-27: https://meowdb.com/msclassic/classes
export const JOBS = {
  Warrior: ['Fighter', 'Page', 'Spearman'],
  Magician: ['Wizard (Fire/Poison)', 'Wizard (Ice/Lightning)', 'Cleric'],
  Bowman: ['Hunter', 'Crossbowman'],
  Thief: ['Assassin', 'Bandit']
};

const token = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const aliases = {
  'Wizard (Fire/Poison)': ['WIZARDFIREPOISON', 'FIREPOISONWIZARD', 'FPWIZARD'],
  'Wizard (Ice/Lightning)': ['WIZARDICELIGHTNING', 'ICELIGHTNINGWIZARD', 'ILWIZARD']
};

export function parseClass(value) {
  const words = String(value ?? '').toUpperCase().split(/[^A-Z]+/);
  const job = Object.keys(JOBS).find(name => words.includes(name.toUpperCase()));
  const normalized = token(value);
  const matches = Object.entries(JOBS).flatMap(([parent, names]) => names.filter(name =>
    (aliases[name] || [token(name)]).some(alias => normalized === alias || normalized === token(parent) + alias)
  ).map(specialization => ({ job: parent, specialization })));
  return matches.length === 1 ? matches[0] : { job: job || '', specialization: '' };
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// Only OCR suggestions allow a small, unique typo match. Saved inputs stay strict.
export function parseOcrClass(value) {
  const exact = parseClass(value);
  if (exact.job) return exact;
  const raw = token(value);
  if (raw.length < 5) return exact;
  const candidates = Object.entries(JOBS).flatMap(([job, names]) => [
    { job, specialization: '', aliases: [token(job)] },
    ...names.map(specialization => ({ job, specialization, aliases: aliases[specialization] || [token(specialization)] }))
  ]).map(candidate => ({ ...candidate, distance: Math.min(...candidate.aliases.map(alias => distance(raw, alias))) }))
    .filter(candidate => candidate.distance <= (candidate.specialization && raw.length > 10 ? 2 : 1))
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length || candidates[1]?.distance === candidates[0].distance) return exact;
  return { job: candidates[0].job, specialization: candidates[0].specialization };
}

export function profileClass(profile) {
  const legacy = parseClass(profile.job);
  const specialization = profile.specialization || legacy.specialization;
  return { job: legacy.job, specialization };
}

export function classLabel(profile) {
  const value = profileClass(profile);
  return [value.job || profile.job, value.specialization].filter(Boolean).join(' · ');
}

export function validClass(job, specialization = '') {
  return Object.hasOwn(JOBS, job) && (!specialization || JOBS[job].includes(specialization));
}
