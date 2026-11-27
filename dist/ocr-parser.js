import { CHARACTER_FIELDS } from './character-fields.js?v=0.6.2';
import { parseOcrClass, validClass } from './jobs.js?v=0.6.2';

export const OCR_FIELDS = CHARACTER_FIELDS;

const LABELS = [
  { key: 'weaponDefense', pattern: 'WEAPON\\s*DEF(?:EN[CS]E)?' },
  { key: 'magicDefense', pattern: 'MAGIC\\s*DEF(?:EN[CS]E)?' },
  { key: 'weaponAttack', pattern: 'WEAPON\\s+ATTACK|W\\.?\\s*ATK' },
  { key: 'magicAttack', pattern: 'MAGIC\\s+ATTACK|M\\.?\\s*ATK|MAGIC' },
  { key: 'critRate', pattern: 'CRIT(?:ICAL)?\\.?\\s*RATE', kind: 'percent' },
  { key: 'critDamage', pattern: 'CRIT(?:ICAL)?\\.?\\s*(?:DAMAGE|DMG)', kind: 'percent' },
  { key: 'apAvailable', pattern: 'ABILITY\\s*POINTS?|AP\\s+(?:FREE|AVAILABLE|LIBRES)' },
  { key: 'name', pattern: 'NAME|NOMBRE', kind: 'text' },
  { key: 'job', pattern: 'JOB|CLASS|CLASE', kind: 'text' },
  { key: 'specialization', pattern: 'SPECIALI[ZS]ATION|ESPECIALIZACI[ÓO]N', kind: 'text' },
  { key: 'level', pattern: 'LEVEL|LVL?|NIVEL' },
  { key: 'exp', pattern: 'EXP(?:ERIENCE)?', kind: 'exp' },
  { key: 'mesos', pattern: 'MESOS?', kind: 'mesos' },
  { key: 'fame', pattern: 'FAME', signed: true },
  { key: 'str', pattern: 'BASE\\s+STR|STR(?:ENGTH)?(?:\\s+BASE)?', kind: 'attribute' },
  { key: 'dex', pattern: 'BASE\\s+DEX|DEX(?:TERITY)?(?:\\s+BASE)?', kind: 'attribute' },
  { key: 'int', pattern: 'BASE\\s+INT|INT(?:ELLIGENCE)?(?:\\s+BASE)?', kind: 'attribute' },
  { key: 'luk', pattern: 'BASE\\s+LUK|LUK(?:\\s+BASE)?|LUCK', kind: 'attribute' },
  { key: 'hp', pattern: '(?:MAX(?:IMUM)?\\s+)?HP', kind: 'resource' },
  { key: 'mp', pattern: '(?:MAX(?:IMUM)?\\s+)?MP', kind: 'resource' },
  { key: 'attack', pattern: 'ATTACK', kind: 'range' },
  { key: 'accuracy', pattern: 'ACCURACY' },
  { key: 'avoidability', pattern: 'EVASION|AVOIDABILITY' },
  { key: 'speed', pattern: 'SPEED', kind: 'percent' },
  { key: 'jump', pattern: 'JUMP', kind: 'percent' }
];

function parseInteger(raw) {
  const token = raw.trim();
  if (!/^-?\d+$/.test(token) && !/^-?\d{1,3}([., ])\d{3}(?:\1\d{3})*$/.test(token)) return null;
  const value = Number(token.replace(/[., ]/g, ''));
  return Number.isSafeInteger(value) ? value : null;
}

function readNumber(segment) {
  const match = segment.match(/^\s*(-?[0-9][0-9., ]*)/);
  if (!match) return null;
  const rest = segment.slice(match[0].length);
  if (/^[a-z0-9]/i.test(rest) && !match[1].endsWith(' ')) return null;
  const value = parseInteger(match[1]);
  return value === null ? null : { value, tail: rest.trimStart(), rawTail: rest };
}

function readPercent(segment) {
  const match = segment.match(/^\s*(\d+(?:[.,]\d+)?)\s*%/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

export function layoutText(blocks) {
  const words = (blocks || []).flatMap(block => (block.paragraphs || [])
    .flatMap(paragraph => (paragraph.lines || []).flatMap(line => line.words || [])))
    .filter(word => word.text?.trim() && word.bbox && word.bbox.y1 > word.bbox.y0);
  const rows = [];
  words.sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  for (const word of words) {
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    const height = word.bbox.y1 - word.bbox.y0;
    const row = rows.find(candidate => Math.abs(candidate.center - center) <= Math.min(candidate.height, height) * .5);
    if (row) {
      row.center = (row.center * row.words.length + center) / (row.words.length + 1);
      row.height = Math.min(row.height, height);
      row.words.push(word);
    } else rows.push({ center, height, words: [word] });
  }
  const labelEnd = new RegExp(`\\b(?:${LABELS.map(field => field.pattern).join('|')})[.:= ]*$`, 'i');
  return rows.sort((a, b) => a.center - b.center).map(row => {
    const ordered = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let text = '';
    for (let index = 0; index < ordered.length; index += 1) {
      const word = ordered[index], previous = ordered[index - 1];
      const gap = previous ? word.bbox.x0 - previous.bbox.x1 : 0;
      const height = previous ? Math.min(previous.bbox.y1 - previous.bbox.y0, word.bbox.y1 - word.bbox.y0) : 0;
      // Keep label/value pairs together, but separate unrelated inventory
      // quantities and values from other windows on the same screen row.
      const balanceSuffix = /^MESOS?$/i.test(word.text.trim()) && gap <= height * 4;
      const separator = previous && gap > height * 2 && !labelEnd.test(text) && !balanceSuffix ? ' | ' : ' ';
      text += (index ? separator : '') + word.text.trim();
    }
    return text;
  }).join('\n');
}

export function extractValues(text, blocks = null) {
  const spatialText = layoutText(blocks);
  const normalized = String(spatialText || text).normalize('NFKC').replace(/[\u00a0\u202f]/g, ' ');
  const alternatives = LABELS.map(field => `(?<${field.key}>${field.pattern})`).join('|');
  const labels = new RegExp(`\\b(?:${alternatives})(?=$|[^\\p{L}_])[.:= ]*`, 'giu');
  const matches = [...normalized.matchAll(labels)];
  const values = {};
  const warnings = new Set();
  const conflicts = new Set();
  function put(key, value) {
    if (value === null || value === undefined || conflicts.has(key)) return;
    if (values[key] !== undefined && values[key] !== value) {
      delete values[key];
      conflicts.add(key);
      const label = OCR_FIELDS.find(field => field.key === key)?.label || key;
      warnings.add(`Hay varios valores distintos para ${label}. Compruébalo en la imagen.`);
    } else values[key] = value;
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const field = LABELS.find(item => match.groups[item.key] !== undefined);
    const end = matches[index + 1]?.index ?? normalized.length;
    const segment = normalized.slice(match.index + match[0].length, end);
    if (field.kind === 'text') {
      const lines = segment.trim().split('\n').map(line => line.split('|')[0].trim()).filter(Boolean);
      const pattern = field.key === 'name' ? /^[\p{L}\p{N}_/'() .-]+/u : /^[\p{L}\p{N}_/'(), .-]+/u;
      const first = lines[0]?.match(pattern)?.[0]?.trim();
      if (!first || !/\p{L}/u.test(first)) continue;
      if (field.key === 'job' || field.key === 'specialization') {
        for (const line of [first, ...lines.slice(1)]) {
          const parsed = parseOcrClass(line);
          if (parsed.job) put('job', parsed.job);
          if (parsed.specialization) put('specialization', parsed.specialization);
        }
      } else put(field.key, first);
      continue;
    }
    if (field.kind === 'percent') {
      put(field.key, readPercent(segment));
      continue;
    }
    if (field.kind === 'exp') {
      const percentageOnly = readPercent(segment);
      if (percentageOnly !== null) {
        put('expPercent', percentageOnly);
        continue;
      }
    }
    if (field.kind === 'mesos') {
      // The inventory places its balance BEFORE the label. Never borrow a
      // quantity from the following inventory/chat row when that line ends.
      const prefix = normalized.slice(0, match.index).split('\n').pop();
      const suffix = prefix.match(/(-?\d[\d., ]*)[ \t]*$/);
      const before = suffix ? readNumber(suffix[1]) : null;
      const after = readNumber(segment.split(/\r?\n/)[0]);
      if (before?.value >= 0) put('mesos', before.value);
      if (after?.value >= 0 && !after.tail) put('mesos', after.value);
      continue;
    }
    let number = readNumber(segment);
    if (!number || (!field.signed && number.value < 0)) continue;
    if (field.kind === 'resource') {
      const suffix = field.key === 'hp' ? 'Hp' : 'Mp';
      if (/MAX/i.test(match[0])) put(`max${suffix}`, number.value);
      else {
        put(`current${suffix}`, number.value);
        if (number.tail.startsWith('/')) put(`max${suffix}`, readNumber(number.tail.slice(1))?.value);
      }
      continue;
    }
    if (field.kind === 'range') {
      const maximum = /^[-~–]/.test(number.tail) ? readNumber(number.tail.slice(1)) : null;
      if (maximum && number.value <= maximum.value) {
        put('attackMin', number.value);
        put('attackMax', maximum.value);
      }
      continue;
    }
    if (/^[%~–-]/.test(number.tail)) continue;
    if (field.kind === 'attribute') {
      if (!/BASE/i.test(match[0])) put(`${field.key}Total`, number.value);
      continue;
    }
    if (field.key === 'level' && number.value < 1) continue;
    put(field.key, number.value);
    if (field.kind === 'exp') {
      const percentage = number.tail.match(/\(\s*(\d+(?:[.,]\d+)?)\s*%/);
      if (percentage) put('expPercent', Number(percentage[1].replace(',', '.')));
    }
  }
  if (values.specialization && !validClass(values.job, values.specialization)) {
    delete values.specialization;
    warnings.add('Revisa el job y su especialización en la imagen.');
  }
  return { values, warnings: [...warnings], text: normalized };
}
