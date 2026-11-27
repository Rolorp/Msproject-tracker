export const OCR_FIELDS = [
  { key: 'level', label: 'Nivel', pattern: 'LEVEL|LVL?|NIVEL', min: 1 },
  { key: 'exp', label: 'EXP actual', pattern: 'EXP(?:ERIENCE)?', min: 0 },
  { key: 'mesos', label: 'Mesos', pattern: 'MESOS?', min: 0 },
  { key: 'str', label: 'STR base', pattern: 'BASE\\s+STR|STR(?:ENGTH)?(?:\\s+BASE)?', attribute: true, min: 0 },
  { key: 'dex', label: 'DEX base', pattern: 'BASE\\s+DEX|DEX(?:TERITY)?(?:\\s+BASE)?', attribute: true, min: 0 },
  { key: 'int', label: 'INT base', pattern: 'BASE\\s+INT|INT(?:ELLIGENCE)?(?:\\s+BASE)?', attribute: true, min: 0 },
  { key: 'luk', label: 'LUK base', pattern: 'BASE\\s+LUK|LUK(?:\\s+BASE)?|LUCK', attribute: true, min: 0 },
  { key: 'maxHp', label: 'HP máximo', pattern: '(?:MAX(?:IMUM)?\\s+)?HP', maximum: true, min: 0 },
  { key: 'maxMp', label: 'MP máximo', pattern: '(?:MAX(?:IMUM)?\\s+)?MP', maximum: true, min: 0 },
  { key: 'weaponAttack', label: 'Weapon Attack total', pattern: 'WEAPON\\s+ATTACK|W\\.?\\s*ATK', min: 0 },
  { key: 'magicAttack', label: 'Magic Attack total', pattern: 'MAGIC\\s+ATTACK|M\\.?\\s*ATK', min: 0 },
  { key: 'accuracy', label: 'Accuracy total', pattern: 'ACCURACY', min: 0 },
  { key: 'avoidability', label: 'Avoidability total', pattern: 'AVOIDABILITY', min: 0 }
];

function parseInteger(raw) {
  const token = raw.trim();
  const grouped = /^\d{1,3}([., ])\d{3}(?:\1\d{3})*$/;
  if (!/^\d+$/.test(token) && !grouped.test(token)) return null;
  const value = Number(token.replace(/[., ]/g, ''));
  return Number.isSafeInteger(value) ? value : null;
}

function readNumber(segment) {
  const match = segment.match(/^\s*([0-9][0-9., ]*)/);
  if (!match) return null;
  const tail = segment.slice(match[0].length).trimStart();
  if (/^[%a-z0-9~–-]/i.test(tail)) return null;
  const value = parseInteger(match[1]);
  return value === null ? null : { value, tail };
}

export function extractValues(text) {
  const normalized = String(text).normalize('NFKC').replace(/[\u00a0\u202f]/g, ' ');
  const alternatives = OCR_FIELDS.map(field => `(?<${field.key}>${field.pattern})`).join('|');
  const labels = new RegExp(`\\b(?:${alternatives})\\b[.:= ]*`, 'gi');
  const values = {};
  const warnings = new Set();
  const conflicts = new Set();
  for (const line of normalized.split(/\r?\n/)) {
    const matches = [...line.matchAll(labels)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const field = OCR_FIELDS.find(item => match.groups[item.key] !== undefined);
      const end = matches[index + 1]?.index ?? line.length;
      const segment = line.slice(match.index + match[0].length, end);
      const number = readNumber(segment);
      if (!number) continue;
      let value = number.value;
      if (field.maximum && !number.tail.startsWith('/') && !/MAX/i.test(match[0])) {
        warnings.add(`${field.label} requiere el máximo o una lectura actual / máximo.`);
        continue;
      }
      if (field.maximum && number.tail.startsWith('/')) {
        const maximum = readNumber(number.tail.slice(1));
        if (!maximum) continue;
        value = maximum.value;
      }
      if (field.attribute && !/BASE/i.test(match[0])) {
        const parts = number.tail.match(/^\(\s*([\d., ]+)\s*\+\s*([\d., ]+)\s*\)/);
        const base = parts ? parseInteger(parts[1]) : null;
        const bonus = parts ? parseInteger(parts[2]) : null;
        if (base === null || bonus === null || base + bonus !== value) {
          warnings.add(`${field.label} requiere comprobar el valor base en la imagen.`);
          continue;
        }
        value = base;
      }
      if (value < field.min || conflicts.has(field.key)) continue;
      if (values[field.key] !== undefined && values[field.key] !== value) {
        delete values[field.key];
        conflicts.add(field.key);
        warnings.add(`Hay varios valores distintos para ${field.label}. Compruébalo en la imagen.`);
      } else {
        values[field.key] = value;
      }
    }
  }
  return { values, warnings: [...warnings] };
}
