import { parseOcrClass } from './jobs.js?v=0.4.5';

export function rightAlignedBalance(data, width, height, margin = 8) {
  const words = (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph =>
    (paragraph.lines || []).flatMap(line => line.words || []))).filter(word => word.text?.trim());
  if (!words.length || words.some(word => !/^[\d.,]+$/.test(word.text.trim()) || !word.bbox)) return false;
  const right = Math.max(...words.map(word => word.bbox.x1));
  const top = Math.min(...words.map(word => word.bbox.y0));
  const bottom = Math.max(...words.map(word => word.bbox.y1));
  return right <= width - margin + 2 && width - margin - right <= height * .65 && bottom - top >= height * .2;
}

// Look only within an OCR line in the bottom-left HUD crop. Never concatenate
// chat lines, names, resource values, or strings from other parts of the image.
export function extractHudClass(blocks, characterName = '') {
  const lines = (blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []));
  const nameToken = text => String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nameLines = characterName ? lines.filter(line => nameToken((line.words || []).map(word => word.text).join('')) === nameToken(characterName)) : [];
  const candidates = new Map();
  for (const line of lines) {
    const evidence = (line.words || []).filter(word => word.confidence >= 20);
    if (!evidence.some(word => word.confidence >= 60)) continue;
    if (characterName) {
      const box = line.bbox;
      if (!box || !nameLines.some(name => name.bbox && name.bbox.y0 >= box.y0 && name.bbox.y0 - box.y1 < (box.y1 - box.y0) * 2 && Math.abs(name.bbox.x0 - box.x0) < (box.y1 - box.y0) * 3)) continue;
    }
    const words = evidence.map(word => word.text);
    for (let start = 0; start < words.length; start += 1) {
      for (let length = 1; length <= 4 && start + length <= words.length; length += 1) {
        const parsed = parseOcrClass(words.slice(start, start + length).join(' '));
        if (parsed.specialization) candidates.set(parsed.specialization, parsed);
      }
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}
