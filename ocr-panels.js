const PINK = 1;
const GREEN = 2;
const BLUE = 4;
const YELLOW = 8;

function colorMask({ data, width, height }) {
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const index = pixel * 4;
    const r = data[index], g = data[index + 1], b = data[index + 2];
    if (r > 110 && r > g * 1.35 && b > g * .9 && b < r * .9 && b > r * .4) mask[pixel] |= PINK;
    if (r > 90 && g > 100 && b < Math.min(r, g) * .7) mask[pixel] |= GREEN;
    if (b > 100 && g > 80 && b > r * 1.1 && b > g * 1.04 && r < 200) mask[pixel] |= BLUE;
    if (r > 130 && g > 110 && g > r * .65 && b < Math.min(r, g) * .6) mask[pixel] |= YELLOW;
  }
  return mask;
}

function components(mask, bit, width, height, visited, queue) {
  visited.fill(0);
  const result = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (visited[start] || !(mask[start] & bit)) continue;
    let head = 0, tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let x0 = width, x1 = 0, y0 = height, y1 = 0;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width, y = Math.floor(pixel / width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      for (const neighbor of [x > 0 ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1, y > 0 ? pixel - width : -1, y + 1 < height ? pixel + width : -1]) {
        if (neighbor >= 0 && !visited[neighbor] && (mask[neighbor] & bit)) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
    const w = x1 - x0, h = y1 - y0;
    if (w >= width * .008 && h >= 5 && w < width * .3 && h < height * .35 && tail / (w * h) > .25) {
      result.push({ x0, x1, y0, y1, width: w, height: h });
    }
  }
  return result;
}

function columnRows(mask, bit, width, height, box, top = 0, bottom = height) {
  const rows = [];
  let start = null;
  for (let y = Math.max(0, Math.floor(top)); y <= Math.min(height - 1, Math.ceil(bottom)); y += 1) {
    let count = 0;
    for (let x = box.x0; x < box.x1; x += 1) if (mask[y * width + x] & bit) count += 1;
    const colored = count / box.width > .3;
    if (colored && start === null) start = y;
    if (!colored && start !== null) {
      const rowHeight = y - start;
      if (rowHeight >= Math.max(5, box.width * .08) && rowHeight < box.width) rows.push({ y0: start, y1: y });
      start = null;
    }
  }
  return rows;
}

function rowGroups(rows, count) {
  return rows.map((_, index) => rows.slice(index, index + count)).filter(group => {
    if (group.length !== count) return false;
    const heights = group.map(row => row.y1 - row.y0);
    if (Math.max(...heights) > Math.min(...heights) * 2.2) return false;
    return group.every((row, index) => index === 0 || row.y0 - group[index - 1].y1 < Math.max(heights[index], heights[index - 1]) * .9);
  });
}

function valueRegions(column, rows, labels, kinds = {}, valueWidth = 1.85) {
  return rows.map((row, index) => ({
    label: labels[index],
    kind: kinds[labels[index]] || 'number',
    x0: column.x1 + column.width * .06,
    x1: column.x1 + column.width * valueWidth,
    y0: row.y0 - (row.y1 - row.y0) * .06,
    y1: row.y1 + (row.y1 - row.y0) * .06
  }));
}

function balanceRegion(image, mask, coins) {
  const { data, width, height } = image;
  let best = null;
  for (const coin of coins) {
    const h = coin.height;
    if (coin.width / h < .6 || coin.width / h > 1.8 || h > Math.min(width, height) * .05) continue;
    const top = Math.max(0, Math.floor(coin.y0 - h * .35));
    const bottom = Math.min(height, Math.ceil(coin.y1 + h * .35));
    let start = null, end = null, gap = 0;
    for (let x = coin.x1; x < Math.min(width, coin.x1 + h * 30); x += 1) {
      let white = 0, samples = 0;
      for (let y = top; y < bottom; y += 1) {
        if (y > top + h * .3 && y < bottom - h * .3) continue;
        samples += 1;
        const p = (y * width + x) * 4;
        if (Math.min(data[p], data[p + 1], data[p + 2]) > 210 && Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]) < 45) white += 1;
      }
      if (white / samples > .45) {
        if (start === null) start = x;
        end = x + 1;
        gap = 0;
      } else if (start !== null && ++gap > h * .8) break;
      if (start === null && x - coin.x1 > h * 3) break;
    }
    if (start === null || end - start < h * 7) continue;
    let blue = 0, sampled = 0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = end + 2; x < Math.min(width, end + h * 3); x += 1) {
        sampled += 1;
        if (mask[y * width + x] & BLUE) blue += 1;
      }
    }
    if (sampled && blue / sampled > .2 && (!best || end - start > best.x1 - best.x0)) {
      best = { label: 'MESOS', kind: 'number', x0: start, x1: end, y0: top - h * .15, y1: bottom + h * .15 };
    }
  }
  return best;
}

export function detectPanelRegions(image) {
  const { width, height } = image;
  const mask = colorMask(image);
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const greens = components(mask, GREEN, width, height, visited, queue);
  const blues = components(mask, BLUE, width, height, visited, queue);
  const coins = components(mask, YELLOW, width, height, visited, queue);
  let character = null;
  for (const column of greens) {
    if (column.width < width * .02) continue;
    const groups = rowGroups(columnRows(mask, GREEN, width, height, column), 4);
    for (const greenRows of groups) {
      const rowHeight = (greenRows[3].y1 - greenRows[0].y0) / 4;
      const pinkRows = columnRows(mask, PINK, width, height, column, greenRows[0].y0 - rowHeight * 10, greenRows[0].y0);
      if (pinkRows.length !== 7 || rowGroups(pinkRows, 7).length === 0) continue;
      if (!character || column.width > character.column.width) character = { column, greenRows, pinkRows, rowHeight };
    }
  }
  const regions = [];
  if (character) {
    const { column, greenRows, pinkRows, rowHeight } = character;
    regions.push(...valueRegions(column, pinkRows, ['NAME', 'JOB', 'LEVEL', 'HP', 'MP', 'EXP', 'FAME'], { NAME: 'text', JOB: 'job' }));
    regions.push(...valueRegions(column, greenRows, ['STR', 'DEX', 'INT', 'LUK']));
    regions.push({ label: 'ABILITY POINT', kind: 'single-number', x0: column.x1 + column.width * .6, x1: column.x1 + column.width * 1.25, y0: greenRows[3].y1 + rowHeight * .75, y1: greenRows[3].y1 + rowHeight * 1.8 });
  }
  let combat = null;
  for (const column of blues) {
    if (column.width < width * .02) continue;
    if (character && (column.x0 < character.column.x1 + character.column.width * .4 || column.x0 > character.column.x1 + character.column.width * 6)) continue;
    const top = character ? character.pinkRows[0].y0 - character.rowHeight : 0;
    const bottom = character ? character.greenRows[3].y1 + character.rowHeight : height;
    const groups = rowGroups(columnRows(mask, BLUE, width, height, column, top, bottom), 10);
    for (const rows of groups) if (!combat || column.width > combat.column.width) combat = { column, rows };
  }
  if (combat) regions.push(...valueRegions(combat.column, combat.rows, ['ATTACK', 'WEAPON DEF', 'MAGIC', 'MAGIC DEF', 'ACCURACY', 'EVASION', 'CRIT RATE', 'CRIT DAMAGE', 'SPEED', 'JUMP'], {}, 1.6));
  const balance = balanceRegion(image, mask, coins);
  if (balance) regions.push(balance);
  return regions.map(region => ({ ...region, x0: Math.max(0, Math.floor(region.x0)), x1: Math.min(width, Math.ceil(region.x1)), y0: Math.max(0, Math.floor(region.y0)), y1: Math.min(height, Math.ceil(region.y1)) }))
    .filter(region => region.x1 - region.x0 >= 4 && region.y1 - region.y0 >= 4);
}
