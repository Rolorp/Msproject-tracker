import { integer } from './session.js';

function optionalInteger(value, label) {
  return value === null || value === undefined || String(value).trim() === ''
    ? null : integer(value, label);
}

function text(value, label, limit, required = false) {
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error(`Completa ${label}.`);
  if (result.length > limit) throw new Error(`${label} admite hasta ${limit} caracteres.`);
  return result;
}

export function saveProfile(profiles, data, id, now, expectedRevision = null) {
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
  for (const attribute of ['str', 'dex', 'int', 'luk']) {
    attributes[attribute] = optionalInteger(data[attribute], attribute.toUpperCase());
  }
  const combat = {};
  for (const stat of ['maxHp', 'maxMp', 'weaponAttack', 'magicAttack', 'accuracy', 'avoidability']) {
    combat[stat] = optionalInteger(data[stat], 'el valor de combate');
  }
  const environment = data.environment || 'live';
  if (!['live', 'test'].includes(environment)) throw new Error('Selecciona live o test.');
  const profile = {
    id,
    revision: (previous?.revision || 0) + 1,
    name: text(data.name, 'el nombre del personaje', 60, true),
    job: text(data.job, 'la clase o rama', 100, true),
    level: integer(data.level, 'el nivel del personaje', 1),
    region: text(data.region, 'la región', 80, true),
    world: text(data.world, 'el mundo', 80),
    environment,
    patch: text(data.patch, 'el parche observado', 80),
    attributes,
    combat,
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
