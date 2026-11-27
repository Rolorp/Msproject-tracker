import { detectPanelRegions, resourceParts, mesosLabelRegions, inventoryLabelRegions, inventoryFooterRegions } from './ocr-panels.js?v=0.7.1';
import { extractValues, layoutText, OCR_FIELDS } from './ocr-parser.js?v=0.7.1';
import { extractHudClass, rightAlignedBalance, confirmedBalance, mergeReadings } from './ocr-evidence.js?v=0.7.1';
import { balanceDigits, resizePixels, panelPixels, trimBalanceBorders } from './ocr-pixels.js?v=0.7.1';
import { parseOcrClass } from './jobs.js?v=0.7.1';

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

function levelBadges(hud, expBox) {
  const h = expBox.y1 - expBox.y0;
  const from = Math.max(0, Math.floor(expBox.y0 - h * .65));
  const to = Math.min(hud.height, Math.ceil(expBox.y1 + h * 1.4));
  const badges = [];
  for (let x = Math.floor(hud.width * .02); x < hud.width * .22; x += 1) {
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

async function readHudProgress(worker, source, cancelled, highContrast = false) {
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
  const anchorText = [expWord.text, ...amounts.map(word => word.text)].join(' ').replace(/\[/g, '(');
  const matchingRow = amounts.length && rows.find(text => text.replace(/\[/g, '(').includes(anchorText));
  const values = extractValues(matchingRow || anchorText).values;
  const percentFound = values.expPercent >= 0 && values.expPercent <= 100;
  if (!withResource && !badges.length && !percentFound) return {};
  if (!percentFound) delete values.expPercent;
  const hudLevel = rows.find(text => /^\s*LV[.:]?\s*\d/i.test(text) && /\bEXP\b/i.test(text));
  if (hudLevel) values.level = extractValues(hudLevel).values.level;

  if (!cancelled()) {
    const short = amounts.some(word => word.bbox.y1 - word.bbox.y0 < height * .67);
    const bounds = {
      x0: Math.max(0, expBox.x0 - height * .1),
      x1: Math.min(hud.width, amounts.length
        ? Math.max(...amounts.map(word => word.bbox.x1)) + height * .18
        : expBox.x1 + height * 9),
      y0: Math.max(0, expBox.y0 + height * (short ? .14 : -.08)),
      y1: Math.min(hud.height, expBox.y0 + height * (short ? .75 : 1.05))
    };
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'EXP0123456789.,()%[] ' });
    const { data: exact } = await worker.recognize(panelImage(hud, bounds, { invert: true }));
    const reading = extractValues(exact.text.replace(/\[/g, '(')).values;
    if (reading.exp !== undefined && (reading.expPercent !== undefined || values.exp === undefined)) values.exp = reading.exp;
    if (reading.expPercent >= 0 && reading.expPercent <= 100) values.expPercent = reading.expPercent;
  }
  if (values.level !== undefined || cancelled()) return values;

  if (!badges.length) return values;
  const bounds = {
    x0: Math.max(0, badges[0].x0 - height * .08),
    x1: Math.min(hud.width, badges.at(-1).x1 + height * .08),
    y0: Math.max(0, Math.min(...badges.map(badge => badge.y0)) - height * .025),
    y1: Math.min(hud.height, Math.max(...badges.map(badge => badge.y1)) + height * .04)
  };
  for (const [mode, binary] of [['7', false], ['13', true]]) {
    if (cancelled()) return values;
    await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '0123456789' });
    const { data: reading } = await worker.recognize(panelImage(hud, bounds, { invert: true, whiteText: true, binary, threshold: 132 }));
    const raw = reading.text.replace(/\s+/g, '');
    if (/^[1-9]\d{0,2}$/.test(raw) && raw.length === badges.length && reading.confidence >= 40) {
      values.level = Number(raw);
      break;
    }
  }
  return values;
}

export async function recognizeSessionFrame(worker, source, cancelled, review = false, searchInventory = true) {
  let hud = {};
  try {
    hud = await readHudProgress(worker, source, cancelled);
    if (!cancelled() && hud.exp === undefined && hud.expPercent === undefined) {
      hud = await readHudProgress(worker, source, cancelled, true);
    }
  } catch {
    // A failed HUD crop should not discard a readable inventory.
  }
  if (cancelled()) return null;
  const needStats = review || hud.level === undefined || (hud.exp === undefined && hud.expPercent === undefined);
  const scale = Math.min(2, 1440 / source.width, 1920 / source.height);
  const analysis = resizePixels(source, { x0: 0, y0: 0, x1: source.width, y1: source.height }, Math.round(source.width * scale), Math.round(source.height * scale));
  const regions = detectPanelRegions(analysis, !needStats);
  const lines = [];
  let inventory = 'missing';
  for (const region of regions) {
    if (cancelled()) return null;
    const label = region.label;
    if (!['LEVEL', 'EXP', 'MESOS'].includes(label) && !(review && label === 'NAME')) continue;
    const box = originalBox(source, analysis, region);
    try {
      if (label === 'MESOS') {
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
  if (inventory !== 'read' && searchInventory && !cancelled()) {
    try {
      for (const region of inventoryFooterRegions(analysis)) {
        if (cancelled()) return null;
        await worker.setParameters({ tessedit_pageseg_mode: '13', tessedit_char_whitelist: 'MESO05' });
        const { data } = await worker.recognize(panelImage(source, originalBox(source, analysis, region.labelBox), { invert: true }));
        if (!/^MES[O0][S5]$/i.test(data.text.trim().replace(/\s/g, ''))) continue;
        inventory = 'unreadable';
        const value = await readBalance(worker, source, originalBox(source, analysis, region), cancelled, true, true);
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
  const validStats = stats.level !== undefined && (stats.exp !== undefined || stats.expPercent !== undefined);
  const useStats = validStats && (review || hud.exp === undefined && (stats.exp !== undefined || hud.expPercent === undefined));
  const progress = useStats ? stats : hud;
  const expSource = progress.exp !== undefined || progress.expPercent !== undefined ? (useStats ? 'stats' : 'hud') : null;
  return { name: stats.name, level: progress.level ?? stats.level, exp: progress.exp, expPercent: progress.expPercent, mesos: stats.mesos, expSource, inventory };
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
