import { detectPanelRegions, resourceParts, mesosLabelRegions } from './ocr-panels.js?v=0.6.2';
import { extractValues, OCR_FIELDS } from './ocr-parser.js?v=0.6.2';
import { extractHudClass, rightAlignedBalance, confirmedBalance, mergeReadings } from './ocr-evidence.js?v=0.6.2';
import { balanceDigits, resizePixels, panelPixels, trimBalanceBorders } from './ocr-pixels.js?v=0.6.2';
import { parseOcrClass } from './jobs.js?v=0.6.2';

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
