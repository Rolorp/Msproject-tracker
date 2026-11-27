import { detectPanelRegions, resourceParts, mesosLabelRegions } from './ocr-panels.js?v=0.4.4';
import { extractValues } from './ocr-parser.js?v=0.4.4';
import { extractHudClass } from './ocr-evidence.js?v=0.4.4';

const balanceLabel = text => /^MES[O0][S5]?$/.test(text.toUpperCase().replace(/[^A-Z0-9]/g, ''));

export function prepareImage(image) {
  const scale = Math.min(2, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.4 + 128));
    pixels.data[index] = contrasted;
    pixels.data[index + 1] = contrasted;
    pixels.data[index + 2] = contrasted;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function analysisCanvas(image) {
  const scale = Math.min(1, 1440 / image.naturalWidth, 1920 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function panelImage(source, region, invert = false) {
  const height = region.y1 - region.y0;
  const scale = 96 / height;
  const margin = 8;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((region.x1 - region.x0) * scale) + margin * 2;
  canvas.height = 96 + margin * 2;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, region.x0, region.y0, region.x1 - region.x0, height, margin, margin, canvas.width - margin * 2, 96);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let minimum = 255, maximum = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.round(pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114);
    pixels.data[i] = gray;
    minimum = Math.min(minimum, gray);
    maximum = Math.max(maximum, gray);
  }
  for (let i = 0; i < pixels.data.length; i += 4) {
    let gray = maximum > minimum ? (pixels.data[i] - minimum) * 255 / (maximum - minimum) : pixels.data[i];
    const x = i / 4 % canvas.width, y = Math.floor(i / 4 / canvas.width);
    if (invert && x >= margin && x < canvas.width - margin && y >= margin && y < canvas.height - margin) gray = 255 - gray;
    pixels.data[i] = gray;
    pixels.data[i + 1] = gray;
    pixels.data[i + 2] = gray;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function originalBox(image, analysis, region) {
  return { ...region, x0: region.x0 * image.naturalWidth / analysis.width, x1: region.x1 * image.naturalWidth / analysis.width,
    y0: region.y0 * image.naturalHeight / analysis.height, y1: region.y1 * image.naturalHeight / analysis.height };
}

async function readBalance(worker, image, box) {
  // Try the original resolution and two segmentations; never accept trailing junk.
  const readings = [];
  for (const mode of ['7', '6']) {
    await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '0123456789., ' });
    const { data } = await worker.recognize(panelImage(image, box));
    const raw = data.text.trim();
    const parsed = extractValues(`MESOS ${raw}`).values.mesos;
    if (/^\d[\d., ]*$/.test(raw) && parsed !== undefined && data.confidence >= 50) readings.push(parsed);
  }
  return readings.length === 2 && readings[0] === readings[1] ? String(readings[0]) : '';
}

export async function recognizeCharacterImage(worker, image, progress, cancelled) {
  const analysis = analysisCanvas(image);
  const context = analysis.getContext('2d', { willReadFrequently: true });
  progress('Detectando ventanas');
  const pixels = context.getImageData(0, 0, analysis.width, analysis.height);
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
      const label = region.labelBox && await worker.recognize(panelImage(image, originalBox(image, analysis, region.labelBox), true));
      text = label && balanceLabel(label.data.text) ? await readBalance(worker, image, originalBox(image, analysis, region)) : '';
    } else if (region.kind === 'job') {
      // The smaller colored specialization line is often omitted by block OCR.
      await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
      const middle = region.y0 + (region.y1 - region.y0) * .55;
      const main = await worker.recognize(panelImage(image, originalBox(image, analysis, region)));
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
      const specialization = await worker.recognize(panelImage(image, originalBox(image, analysis, { ...region, y0: middle })));
      text = `${main.data.text.trim().split('\n')[0]}\nSPECIALIZATION ${specialization.data.text.trim()}`;
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
      const source = numeric ? analysis : image;
      const box = numeric ? region : originalBox(image, analysis, region);
      const { data } = await worker.recognize(panelImage(source, box));
      text = numeric ? data.text.trim().replace(/^[^\d.+-]+/, '') : data.text.trim();
    }
    lines.push(`${region.label} ${text}`);
  }
  if (image.naturalWidth && !cancelled()) {
    progress('Especialización en la barra inferior');
    const hud = document.createElement('canvas');
    hud.width = Math.round(image.naturalWidth * .6);
    hud.height = Math.round(image.naturalHeight * .4);
    hud.getContext('2d').drawImage(image, 0, image.naturalHeight - hud.height, hud.width, hud.height, 0, 0, hud.width, hud.height);
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const reading = await worker.recognize(hud, {}, { text: true, blocks: true });
    const hudClass = extractHudClass(reading.data.blocks, extractValues(lines.join('\n')).values.name);
    if (hudClass) lines.push(`JOB ${hudClass.job}\nSPECIALIZATION ${hudClass.specialization}`);
  }
  if (extractValues(lines.join('\n')).values.mesos === undefined && !cancelled()) {
    progress('Buscando saldo del inventario');
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const prepared = prepareImage(image);
    const general = await worker.recognize(prepared, {}, { text: true, blocks: true });
    const parsed = extractValues(general.data.text, general.data.blocks);
    if (!regions.length) lines.push(parsed.text);
    const generalMesos = parsed.values.mesos;
    if (generalMesos !== undefined) lines.push(`MESOS ${generalMesos}`);
    else {
      for (const region of mesosLabelRegions(general.data.blocks, prepared.width, prepared.height)) {
        if (cancelled()) return null;
        const value = await readBalance(worker, prepared, region);
        if (value) lines.push(`MESOS ${value}`);
      }
    }
  }
  return { text: lines.join('\n'), blocks: null };
}
