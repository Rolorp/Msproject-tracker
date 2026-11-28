import { detectPanelRegions, resourceParts, mesosLabelRegions, inventoryLabelRegions, inventoryFooterRegions, hudGaugeRegions } from './ocr-panels.js?v=0.7.6';
import { extractValues, layoutText, OCR_FIELDS, parseHudExp, parseJoinedHudExp } from './ocr-parser.js?v=0.7.6';
import { extractHudClass, rightAlignedBalance, confirmedBalance, hasHudExperienceReference, hudExperienceFits, mergeReadings } from './ocr-evidence.js?v=0.7.6';
import { balanceDigits, resizePixels, panelPixels, trimBalanceBorders } from './ocr-pixels.js?v=0.7.6';
import { parseOcrClass } from './jobs.js?v=0.7.6';

function imagePixels(image) {
  const canvas = document.createElement('canvas');
  // Large phone photos can exhaust the browser's canvas budget before OCR.
  const scale = Math.min(1, 3840 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 1;
  return pixels;
}

function pixelCanvas(pixels) {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  const image = context.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  context.putImageData(image, 0, 0);
  return canvas;
}

export function prepareImage(source) {
  const scale = Math.min(2, 4096 / Math.max(source.width, source.height));
  const pixels = resizePixels(source, { x0: 0, y0: 0, x1: source.width, y1: source.height }, Math.round(source.width * scale), Math.round(source.height * scale));
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.4 + 128));
    pixels.data[index] = contrasted; pixels.data[index + 1] = contrasted; pixels.data[index + 2] = contrasted;
  }
  return pixelCanvas(pixels);
}

function panelImage(source, region, options = {}) {
  return pixelCanvas(panelPixels(source, region, options));
}

function originalBox(source, analysis, region) {
  return { ...region, x0: region.x0 * source.width / analysis.width, x1: region.x1 * source.width / analysis.width,
    y0: region.y0 * source.height / analysis.height, y1: region.y1 * source.height / analysis.height };
}

async function readIsolatedBalance(worker, image, box, cancelled) {
  const height = box.y1 - box.y0;
  const row = panelPixels(image, { ...box, x0: Math.max(box.x0, box.x1 - height * 9) });
  for (const threshold of [155, 145, 165]) {
    const pixels = balanceDigits(row, threshold);
    if (!pixels) continue;
    const crop = pixelCanvas(pixels);
    const readings = [];
    for (const mode of ['13', '7']) {
      if (cancelled()) return '';
      await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '0123456789., ' });
      const { data } = await worker.recognize(crop, {}, { text: true, blocks: true });
      const raw = data.text.trim();
      const value = /^\d[\d., ]*$/.test(raw) ? extractValues(`MESOS ${raw}`).values.mesos : undefined;
      // Raw-line mode can report the entire crop as the word bounds. Use
      // standard line mode for position and raw-line mode to verify the digits.
      readings.push({ raw, value, confidence: data.confidence, aligned: mode === '13' || rightAlignedBalance(data, crop.width, crop.height, 12) });
    }
    const value = confirmedBalance(readings);
    // The exact thousands grouping in one pass guards against a short or
    // fused reading; the other pass may represent the comma with a space.
    if (value && readings.some(reading => reading.confidence >= 88 && /^\d{1,3}(?:,\d{3})*$/.test(reading.raw))) return value;
  }
  return '';
}

async function readBalance(worker, image, box, cancelled, requireAlignment = true, trimBorders = false) {
  const interior = trimBorders ? trimBalanceBorders(image, box) : box;
  const height = interior.y1 - interior.y0;
  const tight = { ...interior, x0: Math.max(interior.x0, interior.x1 - height * 9) };
  const padded = { ...tight, x1: Math.min(image.width, tight.x1 + height * .025),
    y0: Math.max(0, tight.y0 - height * .05), y1: Math.min(image.height, tight.y1 + height * .05) };
  const crops = requireAlignment ? [{ box: tight }, { box: padded, binary: true }, { box: interior }, { box: tight, binary: true }] : [{ box }, { box, binary: true }];
  const smallField = trimBorders && height < 16;
  if (smallField) {
    const value = await readIsolatedBalance(worker, image, interior, cancelled);
    if (value) return value;
  }
  const minimumMatches = trimBorders ? 2 : 1;
  const confirmed = new Map();
  for (const { box: bounds, binary } of crops) {
    const readings = [];
    const crop = panelImage(image, bounds, { binary });
    for (const mode of ['7', '6']) {
      if (cancelled()) return '';
      await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '0123456789., ' });
      const { data } = await worker.recognize(crop, {}, { text: true, blocks: true });
      const raw = data.text.trim();
      const parsed = extractValues(`MESOS ${raw}`).values.mesos;
      readings.push({ value: /^\d[\d., ]*$/.test(raw) ? parsed : undefined, aligned: !requireAlignment || rightAlignedBalance(data, crop.width, crop.height), grouped: /[.,]/.test(raw), confidence: data.confidence });
    }
    const value = confirmedBalance(readings);
    if (!value) continue;
    if (!requireAlignment) return value;
    const previous = confirmed.get(value);
    const formatted = readings.every(reading => reading.grouped) || Number(value) < 1000;
    if (previous && confirmed.size === 1 && !smallField) return value;
    // Agreement alone is weak when individual digits are only a few pixels tall.
    const legible = !smallField || readings.every(reading => reading.confidence >= 90);
    confirmed.set(value, { formatted: formatted || previous?.formatted, legible: legible || previous?.legible, count: (previous?.count ?? 0) + 1 });
  }
  const complete = [...confirmed].filter(([, reading]) => reading.formatted && reading.legible && reading.count >= minimumMatches);
  if (confirmed.size === 1 && complete.length === 1) return complete[0][0];
  return trimBorders && !smallField ? readIsolatedBalance(worker, image, interior, cancelled) : '';
}

export async function recognizeSelectedRegion(worker, image, kind, box, cancelled) {
  if (cancelled()) return null;
  const source = imagePixels(image);
  const region = { x0: box.x0 * source.width, x1: box.x1 * source.width, y0: box.y0 * source.height, y1: box.y1 * source.height };
  if (region.x1 - region.x0 < 4 || region.y1 - region.y0 < 4) throw new Error('Marca una zona más grande.');
  if (kind === 'mesos' || kind === 'apAvailable') {
    const value = await readBalance(worker, source, region, cancelled, false);
    return { text: value ? `${kind === 'mesos' ? 'MESOS' : 'ABILITY POINT'} ${value}` : '', blocks: null };
  }
  if (kind !== 'specialization') throw new Error('Selecciona el dato que quieres leer.');
  const result = await readSpecialization(worker, source, region, '', cancelled, '6');
  return { text: result ? `JOB ${result.job}\nSPECIALIZATION ${result.specialization}` : '', blocks: null };
}

async function readSpecialization(worker, source, box, job, cancelled, mode = '7') {
  await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '' });
  for (const options of [{}, { redText: true }, { binary: true }, { invert: true }]) {
    if (cancelled()) return null;
    const { data } = await worker.recognize(panelImage(source, box, options));
    const result = parseOcrClass(data.text.trim());
    if (result.specialization && (!job || result.job === job)) return result;
  }
  return null;
}

function wordsOf(blocks = []) {
  return (blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph =>
    (paragraph.lines || []).flatMap(line => line.words || [])));
}

function levelBadges(hud, expBox, search) {
  const h = expBox.y1 - expBox.y0;
  const from = Math.max(0, Math.floor(search?.y0 ?? expBox.y0 - h * .65));
  const to = Math.min(hud.height, Math.ceil(search?.y1 ?? expBox.y1 + h * 1.4));
  const badges = [];
  // Offset the search by the location of EXP instead of the screen origin.
  const left = Math.max(0, Math.floor(search?.x0 ?? expBox.x0 - hud.width * .57));
  const right = Math.max(left, Math.min(hud.width, Math.ceil(search?.x1 ?? expBox.x0 - hud.width * .23)));
  for (let x = left; x < right; x += 1) {
    let count = 0, top = to, bottom = from;
    for (let y = from; y < to; y += 1) {
      const offset = (y * hud.width + x) * 4;
      const red = hud.data[offset], green = hud.data[offset + 1], blue = hud.data[offset + 2];
      if (red < 155 || green < 65 || red < green * 1.22 || blue > green * .83) continue;
      count += 1;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
    if (count < h * .23) continue;
    const last = badges.at(-1);
    if (last && x - last.x1 <= h * .025) {
      last.x1 = x + 1;
      last.y0 = Math.min(last.y0, top);
      last.y1 = Math.max(last.y1, bottom);
    } else {
      badges.push({ x0: x, x1: x + 1, y0: top, y1: bottom });
    }
  }
  const digits = badges.filter(box => {
    const height = box.y1 - box.y0, width = box.x1 - box.x0;
    return height >= h * .38 && width >= height * .45 && width <= height * 1.3;
  });
  if (digits.length > 3 || digits.some((box, i) => i && box.x0 - digits[i - 1].x1 > h * .4)) return [];
  return digits;
}

async function readBadgeLevel(worker, source, expBox, cancelled, search) {
  const badges = levelBadges(source, expBox, search);
  if (!badges.length) return undefined;
  const height = expBox.y1 - expBox.y0;
  const bounds = {
    x0: Math.max(0, badges[0].x0 - height * .08),
    x1: Math.min(source.width, badges.at(-1).x1 + height * .08),
    y0: Math.max(0, Math.min(...badges.map(badge => badge.y0)) - height * .025),
    y1: Math.min(source.height, Math.max(...badges.map(badge => badge.y1)) + height * .04)
  };
  for (const [mode, binary] of [['7', false], ['13', true]]) {
    if (cancelled()) return undefined;
    await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '0123456789' });
    const { data } = await worker.recognize(panelImage(source, bounds, { invert: true, whiteText: true, binary, threshold: 132 }));
    const raw = data.text.replace(/\s+/g, '');
    if (/^[1-9]\d{0,2}$/.test(raw) && raw.length === badges.length && data.confidence >= 40) return Number(raw);
  }
  return undefined;
}

async function readHudCrop(worker, source, box, cancelled,
  { isolated = false, requireLabel = false, requirePair = false, digitsOnly = false, reference = {} } = {}) {
  if (box.x1 - box.x0 < 4 || box.y1 - box.y0 < 4) return {};
  const readings = new Map();
  const percentages = new Map();
  let percentageOnly = false;
  for (const [mode, options] of [
    ['7', { invert: true }],
    ['13', { invert: true, whiteText: true, binary: true, threshold: 170 }],
    ['7', { invert: true, whiteText: true }],
    ['7', { invert: true, whiteText: true, height: 54 }]
  ]) {
    if (cancelled()) return {};
    await worker.setParameters({
      tessedit_pageseg_mode: mode,
      tessedit_char_whitelist: digitsOnly ? '0123456789., ' : 'EXP0123456789.,()%[] '
    });
    const { data } = await worker.recognize(panelImage(source, box, options));
    const normal = parseHudExp(data.text);
    const joined = !digitsOnly && normal.exp === undefined && hasHudExperienceReference(reference.level)
      ? parseJoinedHudExp(data.text) : null;
    const { labeled, exp, expPercent } = { ...normal, ...joined };
    if (expPercent !== undefined && (!requireLabel || labeled)) {
      percentages.set(expPercent, (percentages.get(expPercent) ?? 0) + 1);
    }
    if (exp === undefined && (expPercent !== undefined || /[\[(]\s*\d|\d\s*%/.test(data.text))) percentageOnly = true;
    if (exp === undefined || requireLabel && !labeled || digitsOnly && (labeled || expPercent !== undefined)) continue;
    if (!hudExperienceFits(reference.level, exp, reference.expPercent ?? expPercent, reference.fillPercent)) continue;
    if (labeled && expPercent !== undefined) return { exp, expPercent: reference.expPercent ?? expPercent };
    const separated = expPercent !== undefined || /\d\s*[\[(]/.test(data.text);
    if (requirePair && !separated) continue;
    const previous = readings.get(exp) ?? { count: 0, anchored: false, separated: false };
    readings.set(exp, {
      count: previous.count + 1,
      anchored: previous.anchored || labeled || isolated || separated || digitsOnly,
      separated: previous.separated || separated
    });
  }
  const [first, second] = [...percentages].sort((a, b) => b[1] - a[1]);
  const expPercent = reference.expPercent ?? (first && (!second || first[1] > second[1]) ? first[0] : undefined);
  const matches = [...readings].filter(([, reading]) => reading.count >= 2 && reading.anchored &&
    (!percentageOnly || reading.separated))
    .filter(([exp]) => hudExperienceFits(reference.level, exp, expPercent, reference.fillPercent));
  return { exp: matches.length === 1 ? matches[0][0] : undefined, expPercent };
}

function hudAmountBox(source, box) {
  // The HUD draws the brackets around the percentage in green. Their position
  // moves with the length of the EXP amount, so use both to locate the split.
  const { data, width } = source;
  const span = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const brackets = [];
  for (let x = Math.ceil(box.x0 + span * .23); x < box.x1; x += 1) {
    let green = 0;
    for (let y = Math.ceil(box.y0); y < box.y1; y += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 1] > 108 && data[i + 1] > data[i] * 1.16 && data[i + 1] > data[i + 2] * 1.28) green += 1;
    }
    if (green < height * .36) continue;
    const previous = brackets.at(-1);
    if (previous && x - previous.right <= Math.max(1, height * .16)) previous.right = x;
    else brackets.push({ left: x, right: x });
  }
  if (brackets.length !== 2) return null;
  const [opening, closing] = brackets;
  const distance = closing.left - opening.right;
  if (distance < height * 1.3 || distance > height * 4.5) return null;
  return { ...box, x1: opening.left };
}

async function readHudRegion(worker, source, box, cancelled, reference, requireLabel = false) {
  const amountBox = hudAmountBox(source, box);
  const full = await readHudCrop(worker, source, box, cancelled, { requireLabel, requirePair: !!amountBox, reference });
  if (full.exp !== undefined || !amountBox) return full;
  // A separate crop keeps the glyphs of the percentage out of the retry.
  return readHudCrop(worker, source, amountBox, cancelled, {
    isolated: !requireLabel, requireLabel,
    reference: { ...reference, expPercent: full.expPercent ?? reference.expPercent }
  });
}

async function readCenteredHud(worker, source, cancelled, markedBox) {
  const regions = hudGaugeRegions(source);
  const level = regions ? await readBadgeLevel(worker, source, regions.exp, cancelled, regions.level)
    : markedBox ? await readBottomLevel(worker, source, markedBox, cancelled) : undefined;
  const reference = { level, fillPercent: regions?.fillPercent };
  const automatic = regions ? await readHudRegion(worker, source, regions.exp, cancelled, reference) : {};
  if (markedBox) {
    const marked = await readHudCrop(worker, source, markedBox, cancelled, {
      isolated: true, reference: { ...reference, expPercent: automatic.expPercent }
    });
    if (marked.exp !== undefined) {
      return { ...reference, ...marked, marked: true };
    }
  }
  return { ...reference, ...automatic };
}

function readBottomLevel(worker, source, expBox, cancelled) {
  return readBadgeLevel(worker, source, expBox, cancelled, {
    x0: source.width * .015, x1: source.width * .37, y0: source.height * .95, y1: source.height
  });
}

async function readBottomExp(worker, source, cancelled, reference) {
  // A centered widescreen HUD can still be visible when a resource bar
  // is empty. Require the EXP label when only the standard position is known.
  if (source.width / source.height < 1.55 || cancelled()) return reference;
  let { level, expPercent } = reference;
  for (const box of [
    { x0: source.width * .522, x1: source.width * .619, y0: source.height * .955, y1: source.height * .977 },
    { x0: source.width * .52, x1: source.width * .65, y0: source.height * .948, y1: source.height * .978 },
    { x0: source.width * .505, x1: source.width * .61, y0: source.height * .963, y1: source.height * .992 }
  ]) {
    if (level === undefined) level = await readBottomLevel(worker, source, box, cancelled);
    const progress = await readHudRegion(worker, source, box, cancelled, { ...reference, level, expPercent }, true);
    if (progress.exp !== undefined) return { ...reference, ...progress, level };
    expPercent ??= progress.expPercent;
  }
  return { ...reference, level, expPercent };
}

async function readHudProgress(worker, source, cancelled, reference, highContrast = false) {
  const hudBox = { x0: 0, x1: Math.round(source.width * .88), y0: Math.round(source.height * (highContrast ? .86 : .89)), y1: source.height };
  const scale = highContrast ? Math.min(3, 3000 / hudBox.x1) : Math.min(2.5, 2500 / hudBox.x1);
  const hud = resizePixels(source, hudBox, Math.round(hudBox.x1 * scale), Math.round((hudBox.y1 - hudBox.y0) * scale));
  const input = highContrast ? { ...hud, data: new Uint8ClampedArray(hud.data) } : hud;
  if (highContrast) for (let i = 0; i < input.data.length; i += 4) {
    const luminance = input.data[i] * .299 + input.data[i + 1] * .587 + input.data[i + 2] * .114;
    const inverted = 255 - ((luminance - 128) * 1.6 + 128);
    input.data[i] = input.data[i + 1] = input.data[i + 2] = inverted;
  }
  await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
  const { data } = await worker.recognize(pixelCanvas(input), {}, { text: true, blocks: true });
  if (cancelled()) return {};
  const rows = layoutText(data.blocks).split('\n');
  const words = wordsOf(data.blocks).filter(word => word.bbox && word.text);
  const anchors = words.filter(word => /^EXP(?:[.:]|\d|$)/i.test(word.text) &&
    word.bbox.x0 > hud.width * .33 && word.bbox.y0 > hud.height * .28);
  const expWord = anchors.sort((a, b) => b.bbox.y1 - a.bbox.y1)[0];
  if (!expWord) return {};
  const expBox = expWord.bbox;
  const height = expBox.y1 - expBox.y0;
  if (height < 4) return {};
  const amounts = words.filter(word => /^[[(]?\d/.test(word.text) && word.bbox.x0 >= expBox.x1 - 2 &&
    word.bbox.x1 < expBox.x0 + height * 16 && Math.abs(word.bbox.y0 - expBox.y0) <= height * .6)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const badges = levelBadges(hud, expBox);
  const withResource = words.some(word => /^[HM]P(?:\W|\d|$)/i.test(word.text) && word.bbox.x1 < expBox.x0 &&
    Math.abs(word.bbox.y0 - expBox.y0) < height * 1.05);
  const anchorText = [expWord.text, ...amounts.map(word => word.text)].join(' ');
  const initial = parseHudExp(anchorText);
  if (!withResource && !badges.length && initial.expPercent === undefined) return {};
  const hudLevel = rows.find(text => /^\s*LV[.:]?\s*\d/i.test(text) && /\bEXP\b/i.test(text));
  const level = reference.level ?? (hudLevel && extractValues(hudLevel).values.level)
    ?? await readBadgeLevel(worker, hud, expBox, cancelled);
  const expPercent = reference.expPercent ?? initial.expPercent;
  const values = { level, expPercent };
  if (initial.exp !== undefined && hudExperienceFits(level, initial.exp, expPercent, reference.fillPercent)) values.exp = initial.exp;

  if (!cancelled()) {
    const short = amounts.some(word => word.bbox.y1 - word.bbox.y0 < height * .67);
    const bounds = {
      x0: Math.max(0, expBox.x0 - height * .18),
      x1: Math.min(hud.width, amounts.length
        ? Math.max(...amounts.map(word => word.bbox.x1)) + height * .18
        : expBox.x1 + height * 9),
      y0: Math.max(0, expBox.y0 - height * .15),
      y1: Math.min(hud.height, expBox.y1 + height * .16)
    };
    const tight = {
      ...bounds, x0: Math.max(0, expBox.x0 - height * .1),
      y0: Math.max(0, expBox.y0 + height * (short ? .14 : -.08)),
      y1: Math.min(hud.height, expBox.y0 + height * (short ? .75 : 1.05))
    };
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'EXP0123456789.,()%[] ' });
    const { data: exact } = await worker.recognize(panelImage(hud, tight, { invert: true }));
    const refined = parseHudExp(exact.text);
    if (refined.labeled && refined.exp !== undefined && refined.expPercent !== undefined &&
        hudExperienceFits(level, refined.exp, reference.expPercent ?? refined.expPercent, reference.fillPercent)) {
      values.exp = refined.exp;
      values.expPercent = reference.expPercent ?? refined.expPercent;
    }
    const percentWord = amounts.find(word => /^[\[(]|^\d{1,3}(?:[.,]\d{1,2})?%/.test(word.text));
    const amountBox = hudAmountBox(hud, bounds) ?? (percentWord && { ...bounds, x1: percentWord.bbox.x0 });
    if (amountBox && values.exp === undefined && /^EXP[.:]?$/i.test(expWord.text)) {
      const reading = await readHudCrop(worker, hud, { ...amountBox, x0: expBox.x1 }, cancelled, {
        digitsOnly: true, reference: { ...reference, level, expPercent }
      });
      values.exp = reading.exp;
    }
    if (values.exp === undefined) {
      // Without a reliable boundary, require evidence that the OCR saw the
      // amount and percentage separately before trusting digits from this row.
      const reading = await readHudCrop(worker, hud, bounds, cancelled, {
        requireLabel: true, requirePair: true, reference: { ...reference, level }
      });
      values.exp = reading.exp;
      values.expPercent = reading.expPercent ?? values.expPercent;
    }
  }
  return values;
}

function isMarkedWalletVisible(source, box) {
  const width = box.x1 - box.x0, height = box.y1 - box.y0;
  let pale = 0, blue = 0, sampled = 0;
  for (let y = box.y0 + Math.floor(height * .2); y < box.y1 - height * .2; y += 2) {
    for (let step = 1; step <= 4; step += 1) {
      const inside = (y * source.width + Math.floor(box.x0 + width * step * .1)) * 4;
      const right = (y * source.width + Math.min(source.width - 1, Math.floor(box.x1 + height * step * .35))) * 4;
      if (Math.min(source.data[inside], source.data[inside + 1], source.data[inside + 2]) >= 168) pale += 1;
      if (source.data[right + 2] >= source.data[right] + 14 && source.data[right + 2] >= source.data[right + 1] + 5) blue += 1;
      sampled += 1;
    }
  }
  return sampled > 0 && pale / sampled >= .65 && blue / sampled >= .25;
}

export async function recognizeSessionFrame(worker, source, cancelled, review = false, searchInventory = true, zones = {}, onHud) {
  let hud = {};
  try {
    hud = await readCenteredHud(worker, source, cancelled, zones.exp);
    if (!cancelled() && hud.exp === undefined) {
      hud = await readBottomExp(worker, source, cancelled, hud);
    }
    if (!cancelled() && (hud.level === undefined || hud.exp === undefined)) {
      const fallback = await readHudProgress(worker, source, cancelled, hud);
      const level = hud.level ?? fallback.level;
      const expPercent = hud.expPercent ?? fallback.expPercent;
      const keepAmount = hud.exp !== undefined && hudExperienceFits(level, hud.exp, expPercent, hud.fillPercent);
      hud = { ...hud, level, expPercent, exp: keepAmount ? hud.exp : fallback.exp };
    }
    if (!cancelled() && hud.exp === undefined) {
      const fallback = await readHudProgress(worker, source, cancelled, hud, true);
      hud = { ...hud, ...fallback };
    }
  } catch {
    // A failed HUD crop should not discard a readable inventory.
  }
  if (cancelled()) return null;
  const progress = { exp: hud.exp, expSource: hud.exp !== undefined ? 'hud' : null, expMarked: hud.marked };
  if (progress.expSource) onHud?.({ ...progress, level: hud.level, inventory: 'pending' });
  const needStats = review || hud.level === undefined;
  const scale = Math.min(2, 1920 / source.width, 1920 / source.height);
  const analysis = resizePixels(source, { x0: 0, y0: 0, x1: source.width, y1: source.height }, Math.round(source.width * scale), Math.round(source.height * scale));
  const regions = detectPanelRegions(analysis, !needStats, { smallCoins: true });
  const lines = [];
  let inventory = 'missing';
  if (zones.mesos && isMarkedWalletVisible(source, zones.mesos) && !cancelled()) {
    inventory = 'unreadable';
    try {
      const value = await readBalance(worker, source, zones.mesos, cancelled);
      if (value) {
        inventory = 'read';
        lines.push(`MESOS ${value}`);
      }
    } catch {
      // Automatic detection can still recover a balance from a moved window.
    }
  }
  for (const region of regions) {
    if (cancelled()) return null;
    const label = region.label;
    if (!['LEVEL', 'MESOS'].includes(label) && !(review && label === 'NAME')) continue;
    const box = originalBox(source, analysis, region);
    try {
      if (label === 'MESOS') {
        if (inventory === 'read') continue;
        inventory = 'unreadable';
        const value = await readBalance(worker, source, box, cancelled, true, true);
        if (value) {
          inventory = 'read';
          lines.push(`MESOS ${value}`);
        }
        continue;
      }
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: label === 'NAME' ? '' : '0123456789.,%() ' });
      const { data } = await worker.recognize(panelImage(source, box));
      lines.push(`${label} ${data.text.trim()}`);
    } catch {
      // Keep the other recognized fields when a single region fails.
    }
  }
  if (inventory !== 'read' && searchInventory && source.width > analysis.width * 1.2 && !cancelled()) {
    try {
      const [region] = detectPanelRegions(source, true, { smallCoins: true });
      if (region) {
        inventory = 'unreadable';
        const value = await readBalance(worker, source, region, cancelled, true, true);
        if (value) {
          inventory = 'read';
          lines.push(`MESOS ${value}`);
        }
      }
    } catch {
      // A label or footer search remains available when the icon is unclear.
    }
  }
  if (inventory !== 'read' && searchInventory && !cancelled()) {
    try {
      const footerImage = source.width >= analysis.width ? source : analysis;
      for (const region of inventoryFooterRegions(footerImage)) {
        if (cancelled()) return null;
        await worker.setParameters({ tessedit_pageseg_mode: '13', tessedit_char_whitelist: 'MESO05' });
        const { data } = await worker.recognize(panelImage(source, originalBox(source, footerImage, region.labelBox), { invert: true }));
        if (!/^MES[O0][S5]$/i.test(data.text.trim().replace(/\s/g, ''))) continue;
        inventory = 'unreadable';
        const value = await readBalance(worker, source, originalBox(source, footerImage, region), cancelled, true, true);
        if (!value) continue;
        inventory = 'read';
        lines.push(`MESOS ${value}`);
        break;
      }
    } catch {
      // Try the spatially matched heading and label below.
    }
  }
  if (inventory !== 'read' && searchInventory && !cancelled()) {
    try {
      const prepared = prepareImage(source);
      await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
      const { data } = await worker.recognize(prepared, {}, { text: true, blocks: true });
      const dimensions = { width: prepared.width, height: prepared.height };
      const labels = inventoryLabelRegions(data.blocks, dimensions.width, dimensions.height);
      prepared.width = prepared.height = 1;
      for (const region of labels) {
        if (cancelled()) return null;
        inventory = 'unreadable';
        const value = await readBalance(worker, source, originalBox(source, dimensions, region), cancelled);
        if (!value) continue;
        inventory = 'read';
        lines.push(`MESOS ${value}`);
        break;
      }
    } catch {
      // The HUD remains usable even when the secondary inventory read fails.
    }
  }
  if (cancelled()) return null;
  const stats = extractValues(lines.join('\n')).values;
  return { ...progress, name: stats.name, level: hud.level ?? stats.level, mesos: stats.mesos, inventory };
}

export async function recognizeCharacterImage(worker, image, progress, cancelled) {
  const source = imagePixels(image);
  const scale = Math.min(2, 1440 / source.width, 1920 / source.height);
  const analysis = resizePixels(source, { x0: 0, y0: 0, x1: source.width, y1: source.height }, Math.round(source.width * scale), Math.round(source.height * scale));
  progress('Detectando ventanas');
  const pixels = analysis;
  const regions = detectPanelRegions(pixels);
  const lines = [];
  for (let index = 0; index < regions.length; index += 1) {
    if (cancelled()) return null;
    const region = regions[index];
    try {
      const numeric = region.kind === 'number' || region.kind === 'single-number';
      progress(`${region.label} (${index + 1}/${regions.length})`);
      await worker.setParameters({
        tessedit_pageseg_mode: region.kind === 'job' ? '6' : '7',
        tessedit_char_whitelist: numeric ? '0123456789.,/+-~%() ' : ''
      });
      let text;
      if (region.label === 'MESOS') {
        text = await readBalance(worker, source, originalBox(source, analysis, region), cancelled, true, true);
      } else if (region.kind === 'job') {
        // The smaller colored specialization line is often omitted by block OCR.
        await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
        const main = await worker.recognize(panelImage(source, originalBox(source, analysis, region)));
        text = main.data.text.trim();
        const known = extractValues(`JOB ${text}`).values;
        if (!known.specialization) {
          for (const fraction of [.55, .45]) {
            const box = originalBox(source, analysis, { ...region, y0: region.y0 + (region.y1 - region.y0) * fraction });
            const specialization = await readSpecialization(worker, source, box, known.job, cancelled);
            if (specialization) {
              text = `${known.job || specialization.job}\nSPECIALIZATION ${specialization.specialization}`;
              break;
            }
          }
        }
      } else if (region.label === 'HP' || region.label === 'MP') {
        const parts = resourceParts(pixels, region);
        const values = [];
        for (const part of parts) {
          const { data } = await worker.recognize(panelImage(analysis, part));
          values.push(data.text.trim());
        }
        text = values.length === 2 && values.every(value => /^\d[\d., ]*$/.test(value)) ? values.join('/') : '';
        if (!text) {
          const { data } = await worker.recognize(panelImage(analysis, region));
          const ratio = data.text.trim().replace(/^[^\d]+/, '');
          if (/^\d[\d., ]*\/\d[\d., ]*$/.test(ratio)) text = ratio;
        }
      } else {
        const regionSource = numeric ? analysis : source;
        const box = numeric ? region : originalBox(source, analysis, region);
        const { data } = await worker.recognize(panelImage(regionSource, box));
        text = numeric ? data.text.trim().replace(/^[^\d.+-]+/, '') : data.text.trim();
      }
      lines.push(`${region.label} ${text}`);
    } catch {
      if (cancelled()) return null;
      // A bad crop must not discard the fields read from the other windows.
    }
  }
  let result = extractValues(lines.join('\n'));
  if (!result.values.specialization && image.naturalWidth && !cancelled()) {
    try {
      progress('Especialización en la barra inferior');
      const hudWidth = Math.round(source.width * .6), hudHeight = Math.round(source.height * .4);
      const hud = pixelCanvas(resizePixels(source, { x0: 0, y0: source.height - hudHeight, x1: hudWidth, y1: source.height }, hudWidth, hudHeight));
      await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
      const reading = await worker.recognize(hud, {}, { text: true, blocks: true });
      const hudClass = extractHudClass(reading.data.blocks, result.values.name, result.values.job);
      if (hudClass) {
        const text = `JOB ${hudClass.job}\nSPECIALIZATION ${hudClass.specialization}`;
        lines.push(text);
        result = mergeReadings(result, extractValues(text));
      }
    } catch {
      if (cancelled()) return null;
    }
  }
  const missingFields = OCR_FIELDS.filter(field => field.key !== 'weaponAttack').some(field => result.values[field.key] === undefined);
  if (missingFields && !cancelled()) {
    try {
      progress('Buscando etiquetas en toda la imagen');
      await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
      const prepared = prepareImage(source);
      const general = await worker.recognize(prepared, {}, { text: true, blocks: true });
      const parsed = extractValues(general.data.text, general.data.blocks);
      if (!result.values.specialization && !parsed.values.specialization) {
        const bottom = prepared.height * .6;
        const hudBlocks = (general.data.blocks || []).filter(block => block.bbox?.y0 >= bottom && block.bbox.x0 <= prepared.width * .6);
        const hudClass = extractHudClass(hudBlocks, result.values.name ?? parsed.values.name, result.values.job ?? parsed.values.job, true);
        if (hudClass) Object.assign(parsed.values, hudClass);
      }
      lines.push(`# Lectura general\n${parsed.text}`);
      result = mergeReadings(result, parsed);
      const generalMesos = parsed.values.mesos;
      if (generalMesos !== undefined) lines.push(`MESOS ${generalMesos}`);
      if (generalMesos === undefined && result.values.mesos === undefined) {
        for (const region of mesosLabelRegions(general.data.blocks, prepared.width, prepared.height)) {
          if (cancelled()) return null;
          const preparedPixels = prepared.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, prepared.width, prepared.height);
          const value = await readBalance(worker, preparedPixels, region, cancelled);
          if (value) {
            const text = `MESOS ${value}`;
            lines.push(text);
            result = mergeReadings(result, extractValues(text));
          }
        }
      }
    } catch {
      if (cancelled()) return null;
    }
  }
  return { ...result, text: lines.join('\n'), blocks: null };
}
