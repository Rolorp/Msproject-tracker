import { parseOcrClass, validClass } from './jobs.js?v=0.7.6';

// Classic World EXP to the next level. Only the documented range is used.
// https://mapleclassic.wiki/wiki/Module:ExperienceCurve
const EXP_TO_NEXT = [
  0,
  15, 34, 57, 92, 135, 372, 560, 840, 1242, 1716,
  2360, 3216, 4200, 5460, 7050, 8840, 11040, 13716, 16680, 20216,
  24402, 28980, 34320, 40512, 47216, 54900, 63666, 73080, 83720, 95700,
  108480, 122760, 138666, 155540, 174216, 194832, 216600, 240500, 266682, 294216,
  324240, 356916, 391160, 428280, 468450, 510420, 555680, 604416, 655200
];

export function hasHudExperienceReference(level) {
  return Boolean(EXP_TO_NEXT[level]);
}

export function hudExperienceFits(level, exp, percent, fillPercent) {
  const required = EXP_TO_NEXT[level];
  if (!required) return true;
  const computed = exp * 100 / required;
  if (exp > required || fillPercent !== undefined && Math.abs(computed - fillPercent) > 8) return false;
  if (percent === undefined) return true;
  // OCR may lose the decimal places of the HUD's percentage.
  const tolerance = Number.isInteger(percent) ? 1 : .06;
  return Math.abs(computed - percent) <= tolerance;
}

export function mergeReadings(primary, fallback) {
  const values = { ...fallback.values, ...primary.values };
  const warnings = [...new Set([...(primary.warnings || []), ...(fallback.warnings || [])])];
  if (values.specialization && !validClass(values.job, values.specialization)) {
    delete values.specialization;
    warnings.push('Revisa el job y la especialización en la imagen.');
  }
  return { values, warnings };
}

export function confirmedBalance(readings) {
  // Tesseract's confidence is poorly calibrated for the game's pixel font:
  // correct, complete readings can score below 10 after resizing a phone photo.
  if (readings.length < 2 || readings.some(reading => !reading.aligned || !Number.isSafeInteger(reading.value) || reading.value < 0)) return '';
  return readings.every(reading => reading.value === readings[0].value) ? String(readings[0].value) : '';
}

export function rightAlignedBalance(data, width, height, margin = 8) {
  const words = (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph =>
    (paragraph.lines || []).flatMap(line => line.words || []))).filter(word => word.text?.trim());
  if (!words.length || words.some(word => !/^[\d.,]+$/.test(word.text.trim()) || !word.bbox)) return false;
  const left = Math.min(...words.map(word => word.bbox.x0));
  const right = Math.max(...words.map(word => word.bbox.x1));
  const top = Math.min(...words.map(word => word.bbox.y0));
  const bottom = Math.max(...words.map(word => word.bbox.y1));
  return left > margin + 2 && right <= width - margin + 2 && width - margin - right <= height * .65 && bottom - top >= height * .2;
}

// Look only within an OCR line in the bottom-left HUD crop. Never concatenate
// chat lines, names, resource values, or strings from other parts of the image.
export function extractHudClass(blocks, characterName = '', job = '', requireLocation = false) {
  const lines = (blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []));
  const resourceWords = lines.flatMap(line => line.words || []).filter(word => word.bbox && /^(?:[HM]P|EXP)[.:\[(]?\s*(?:\d|$)/i.test(word.text));
  const nameToken = text => String(text).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[IL1]/g, 'I');
  const nameLines = characterName ? lines.filter(line => nameToken((line.words || []).map(word => word.text).join('')) === nameToken(characterName)) : [];
  const candidates = new Map();
  for (const line of lines) {
    const box = line.bbox;
    const aboveName = box && nameLines.some(name => name.bbox && name.bbox.y0 > box.y0 && name.bbox.y0 - box.y1 < (box.y1 - box.y0) * 2 && Math.abs(name.bbox.x0 - box.x0) < (box.y1 - box.y0) * 3);
    const besideResources = box && resourceWords.some(word => {
      const resource = word.bbox;
      const height = box.y1 - box.y0;
      return resource.x0 > box.x0 + height && resource.x0 < box.x1 + height * 16 && Math.abs(resource.y0 - box.y0) <= height * .75;
    });
    const anchored = aboveName || besideResources;
    if ((characterName || requireLocation) && !anchored) continue;
    const evidence = anchored ? (line.words || []) : (line.words || []).filter(word => word.confidence >= 20);
    if (!anchored && !evidence.some(word => word.confidence >= 60)) continue;
    const words = evidence.map(word => word.text);
    for (let start = 0; start < words.length; start += 1) {
      for (let length = 1; length <= 4 && start + length <= words.length; length += 1) {
        const parsed = parseOcrClass(words.slice(start, start + length).join(' '));
        if (parsed.specialization && (!job || parsed.job === job)) candidates.set(parsed.specialization, parsed);
      }
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}
