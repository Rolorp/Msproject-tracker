import { integer } from './session.js?v=0.4.4';
import { ATTRIBUTES, COMBAT_FIELDS, PROGRESS_FIELDS } from './character-fields.js?v=0.4.4';
import { validClass } from './jobs.js?v=0.4.4';

function optionalInteger(value, label) {
  return value === null || value === undefined || String(value).trim() === ''
    ? null : integer(value, label);
}

function optionalValue(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (field.type !== 'decimal') return integer(value, field.label, field.min ?? 0);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Revisa ${field.label}.`);
  }
  return number;
}

function text(value, label, limit, required = false) {
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error(`Completa ${label}.`);
  if (result.length > limit) throw new Error(`${label} admite hasta ${limit} caracteres.`);
  return result;
}

export function saveProfile(profiles, data, id, now, expectedRevision = null) {
  if (!validClass(data.job, data.specialization)) throw new Error('Selecciona un job y una especialización correspondiente.');
  const previous = profiles.find(profile => profile.id === id);
  if ((previous?.revision ?? null) !== expectedRevision) {
    throw new Error('El perfil cambió en otra pestaña. Vuelve a abrirlo con Editar antes de guardar.');
  }
  const spPools = (data.spPools || []).map(pool => ({
    name: text(pool.name, 'el avance de SP', 80, true),
    available: optionalInteger(pool.available, 'los SP libres')
  }));
  const poolNames = spPools.map(pool => pool.name.toLowerCase());
  if (new Set(poolNames).size !== poolNames.length) throw new Error('Cada avance de SP debe aparecer una sola vez.');

  const skills = (data.skills || []).map(skill => ({
    name: text(skill.name, 'el nombre de la habilidad', 100, true),
    rank: integer(skill.rank, 'el rango de la habilidad'),
    pool: text(skill.pool, 'el avance de la habilidad', 80)
  }));
  const skillKeys = skills.map(skill => JSON.stringify([skill.pool.toLowerCase(), skill.name.toLowerCase()]));
  if (new Set(skillKeys).size !== skillKeys.length) throw new Error('Hay una habilidad repetida dentro del mismo avance.');

  const attributes = {};
  const attributeTotals = {};
  for (const attribute of ATTRIBUTES) {
    attributes[attribute] = optionalInteger(data[attribute], attribute.toUpperCase());
    attributeTotals[attribute] = optionalInteger(data[`${attribute}Total`], `${attribute.toUpperCase()} mostrado`);
  }
  const combat = {};
  for (const field of COMBAT_FIELDS) combat[field.key] = optionalValue(data[field.key], field);
  if (combat.attackMin !== null && combat.attackMax !== null && combat.attackMin > combat.attackMax) {
    throw new Error('Attack mínimo debe ser menor o igual que Attack máximo.');
  }
  const progress = {};
  for (const field of PROGRESS_FIELDS) progress[field.key] = optionalValue(data[field.key], field);
  const environment = data.environment || 'live';
  if (!['live', 'test'].includes(environment)) throw new Error('Selecciona live o test.');
  const profile = {
    id,
    revision: (previous?.revision || 0) + 1,
    name: text(data.name, 'el nombre del personaje', 60, true),
    job: data.job,
    specialization: data.specialization || '',
    level: integer(data.level, 'el nivel del personaje', 1),
    region: text(data.region, 'la región', 80, true),
    world: text(data.world, 'el mundo', 80),
    environment,
    patch: text(data.patch, 'el parche observado', 80),
    attributes,
    attributeTotals,
    combat,
    progress,
    fame: optionalValue(data.fame, { label: 'Fame', min: -Number.MAX_SAFE_INTEGER }),
    apAvailable: optionalInteger(data.apAvailable, 'los AP libres'),
    equipment: text(data.equipment, 'el equipo', 4000),
    spPools,
    skills,
    evidence: 'manual',
    rulesStatus: 'pending',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  };
  return previous ? profiles.map(item => item.id === id ? profile : item) : [...profiles, profile];
}
