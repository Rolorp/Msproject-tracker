import { detectPanelRegions, resourceParts, mesosLabelRegions } from './ocr-panels.js?v=0.5.0';
import { extractValues } from './ocr-parser.js?v=0.5.0';
import { extractHudClass, rightAlignedBalance, confirmedBalance } from './ocr-evidence.js?v=0.5.0';
import { resizePixels, panelPixels } from './ocr-pixels.js?v=0.5.0';
import { parseOcrClass } from './jobs.js?v=0.5.0';

const balanceLabel = text => /^MES[O0][S5]?$/.test(text.toUpperCase().replace(/[^A-Z0-9]/g, ''));

function imagePixels(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
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

function originalBox(image, analysis, region) {
  return { ...region, x0: region.x0 * image.naturalWidth / analysis.width, x1: region.x1 * image.naturalWidth / analysis.width,
    y0: region.y0 * image.naturalHeight / analysis.height, y1: region.y1 * image.naturalHeight / analysis.height };
}

async function readBalance(worker, image, box, requireAlignment = true) {
  for (const binary of [false, true]) {
    const readings = [];
    for (const mode of ['7', '6']) {
      await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '0123456789., ' });
      const crop = panelImage(image, box, { binary });
      const { data } = await worker.recognize(crop, {}, { text: true, blocks: true });
      const raw = data.text.trim();
      const parsed = extractValues(`MESOS ${raw}`).values.mesos;
      readings.push({ value: /^\d[\d., ]*$/.test(raw) ? parsed : undefined, aligned: !requireAlignment || rightAlignedBalance(data, crop.width, crop.height) });
    }
    const value = confirmedBalance(readings);
    if (value) return value;
  }
  return '';
}

export async function recognizeSelectedRegion(worker, image, kind, box, cancelled) {
  if (cancelled()) return null;
  const source = imagePixels(image);
  const region = { x0: box.x0 * source.width, x1: box.x1 * source.width, y0: box.y0 * source.height, y1: box.y1 * source.height };
  if (region.x1 - region.x0 < 4 || region.y1 - region.y0 < 4) throw new Error('Marca una zona más grande.');
  if (kind === 'mesos' || kind === 'apAvailable') {
    const value = await readBalance(worker, source, region, false);
    return { text: value ? `${kind === 'mesos' ? 'MESOS' : 'ABILITY POINT'} ${value}` : '', blocks: null };
  }
  if (kind !== 'specialization') throw new Error('Selecciona el dato que quieres leer.');
  for (const binary of [false, true]) for (const mode of ['7', '6']) {
    if (cancelled()) return null;
    await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(panelImage(source, region, { binary }));
    const result = parseOcrClass(data.text.trim());
    if (result.specialization) return { text: `JOB ${result.job}\nSPECIALIZATION ${result.specialization}`, blocks: null };
  }
  return { text: '', blocks: null };
}

export async function recognizeCharacterImage(worker, image, progress, cancelled) {
  const source = imagePixels(image);
  const scale = Math.min(1, 1440 / source.width, 1920 / source.height);
  const analysis = resizePixels(source, { x0: 0, y0: 0, x1: source.width, y1: source.height }, Math.round(source.width * scale), Math.round(source.height * scale));
  progress('Detectando ventanas');
  const pixels = analysis;
  const regions = detectPanelRegions(pixels);
  const lines = [];
  for (let index = 0; index < regions.length; index += 1) {
    if (cancelled()) return null;
    const region = regions[index];
    const numeric = region.kind === 'number' || region.kind === 'single-number';
    progress(`${region.label} (${index + 1}/${regions.length})`);
    await worker.setParameters({
      tessedit_pageseg_mode: region.kind === 'job' ? '6' : '7',
      tessedit_char_whitelist: numeric ? '0123456789.,/+-~%() ' : ''
    });
    let text;
    if (region.label === 'MESOS') {
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
      const label = region.labelBox && await worker.recognize(panelImage(source, originalBox(image, analysis, region.labelBox), { invert: true }));
      text = await readBalance(worker, source, originalBox(image, analysis, region));
      // A white-on-blue label may be unreadable. The framed balance still
      // requires two complete readings aligned to its right edge.
      if (label && !balanceLabel(label.data.text) && !text) progress('Saldo sin confirmar');
    } else if (region.kind === 'job') {
      // The smaller colored specialization line is often omitted by block OCR.
      await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
      const middle = region.y0 + (region.y1 - region.y0) * .55;
      const main = await worker.recognize(panelImage(source, originalBox(image, analysis, region)));
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
      const specialization = await worker.recognize(panelImage(source, originalBox(image, analysis, { ...region, y0: middle })));
      text = `${main.data.text.trim().split('\n')[0]}\nSPECIALIZATION ${specialization.data.text.trim()}`;
      if (!extractValues(`JOB ${text}`).values.specialization) {
        for (const fraction of [.45, .5, .6]) {
          const box = originalBox(image, analysis, { ...region, y0: region.y0 + (region.y1 - region.y0) * fraction });
          const retry = await worker.recognize(panelImage(source, box, { binary: true }));
          const candidate = `${main.data.text.trim().split('\n')[0]}\nSPECIALIZATION ${retry.data.text.trim()}`;
          if (extractValues(`JOB ${candidate}`).values.specialization) { text = candidate; break; }
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
      const box = numeric ? region : originalBox(image, analysis, region);
      const { data } = await worker.recognize(panelImage(regionSource, box));
      text = numeric ? data.text.trim().replace(/^[^\d.+-]+/, '') : data.text.trim();
    }
    lines.push(`${region.label} ${text}`);
  }
  if (image.naturalWidth && !cancelled()) {
    progress('Especialización en la barra inferior');
    const hudWidth = Math.round(source.width * .6), hudHeight = Math.round(source.height * .4);
    const hud = pixelCanvas(resizePixels(source, { x0: 0, y0: source.height - hudHeight, x1: hudWidth, y1: source.height }, hudWidth, hudHeight));
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const reading = await worker.recognize(hud, {}, { text: true, blocks: true });
    const hudClass = extractHudClass(reading.data.blocks, extractValues(lines.join('\n')).values.name);
    if (hudClass) lines.push(`JOB ${hudClass.job}\nSPECIALIZATION ${hudClass.specialization}`);
  }
  if (extractValues(lines.join('\n')).values.mesos === undefined && !cancelled()) {
    progress('Buscando saldo del inventario');
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const prepared = prepareImage(source);
    const general = await worker.recognize(prepared, {}, { text: true, blocks: true });
    const parsed = extractValues(general.data.text, general.data.blocks);
    if (!regions.length) lines.push(parsed.text);
    const generalMesos = parsed.values.mesos;
    if (generalMesos !== undefined) lines.push(`MESOS ${generalMesos}`);
    else {
      for (const region of mesosLabelRegions(general.data.blocks, prepared.width, prepared.height)) {
        if (cancelled()) return null;
        const preparedPixels = prepared.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, prepared.width, prepared.height);
        const value = await readBalance(worker, preparedPixels, region);
        if (value) lines.push(`MESOS ${value}`);
      }
    }
  }
  return { text: lines.join('\n'), blocks: null };
}
