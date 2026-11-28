const STORAGE_KEY = 'msproject-tracker.capture-zones';
const fields = ['exp', 'mesos'];

function loadZones() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function setupCaptureZones(getFrame, reread) {
  const $ = id => document.getElementById(id);
  const dialog = $('screen-zone-dialog');
  const image = $('screen-zone-image');
  const marker = $('screen-zone-box');
  const kind = $('screen-zone-kind');
  const apply = $('screen-zone-apply');
  const status = $('screen-zone-status');
  let stored = loadZones();
  let frame, top, anchor, selection;

  function forFrame(current, resolution = current.captureResolution) {
    const { width, height } = current;
    const saved = stored[resolution];
    return Object.fromEntries(fields.flatMap(field => {
      const box = saved?.[field];
      if (!box || ![box.x0, box.x1, box.y0, box.y1].every(Number.isFinite) ||
        box.x0 < 0 || box.y0 < 0 || box.x1 > width || box.y1 > height ||
        box.x1 - box.x0 < 8 || box.y1 - box.y0 < 5) return [];
      return [[field, box]];
    }));
  }

  function renderPreview() {
    if (!frame) return;
    top = kind.value === 'exp' ? Math.floor(frame.height * .8) : 0;
    image.width = frame.width;
    image.height = frame.height - top;
    image.getContext('2d').drawImage(frame, 0, top, image.width, image.height, 0, 0, image.width, image.height);
    $('screen-zone-hint').textContent = kind.value === 'exp'
      ? 'Marca dos esquinas alrededor del texto de EXP y su porcentaje en la barra inferior.'
      : 'Marca dos esquinas que encierren la casilla blanca completa del saldo. El inventario debe estar abierto.';
    anchor = selection = null;
    marker.hidden = true;
    apply.disabled = true;
    status.textContent = 'Marca la primera esquina.';
  }

  function save(box) {
    const current = getFrame();
    if (!frame || !current || frame.captureResolution !== current.captureResolution ||
        frame.width !== current.width || frame.height !== current.height) {
      status.textContent = 'La imagen cambió de tamaño. Cierra y vuelve a abrir Marcar zonas.';
      return;
    }
    const key = frame.captureResolution;
    const zones = forFrame(frame);
    if (box) zones[kind.value] = box;
    else delete zones[kind.value];
    stored = { ...stored, [key]: zones };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch { /* Keep the zone for this tab. */ }
    dialog.close();
    reread();
  }

  $('screen-mark-zones').addEventListener('click', () => {
    const current = getFrame();
    if (!current || dialog.open) return;
    frame = document.createElement('canvas');
    frame.width = current.width;
    frame.height = current.height;
    frame.captureResolution = current.captureResolution;
    frame.getContext('2d').drawImage(current, 0, 0);
    renderPreview();
    dialog.showModal();
  });
  $('screen-zone-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    frame = null;
    image.width = image.height = 1;
  });
  kind.addEventListener('change', renderPreview);
  image.addEventListener('click', event => {
    const bounds = image.getBoundingClientRect();
    const x = Math.max(0, Math.min(image.width, Math.round((event.clientX - bounds.x) * image.width / bounds.width)));
    const y = Math.max(0, Math.min(image.height, Math.round((event.clientY - bounds.y) * image.height / bounds.height)));
    if (!anchor || selection) {
      anchor = { x, y };
      selection = null;
      marker.hidden = true;
      apply.disabled = true;
      status.textContent = 'Marca la esquina opuesta.';
      return;
    }
    selection = { x0: Math.min(x, anchor.x), x1: Math.max(x, anchor.x),
      y0: top + Math.min(y, anchor.y), y1: top + Math.max(y, anchor.y) };
    marker.style.left = `${selection.x0 / image.width * 100}%`;
    marker.style.top = `${(selection.y0 - top) / image.height * 100}%`;
    marker.style.width = `${(selection.x1 - selection.x0) / image.width * 100}%`;
    marker.style.height = `${(selection.y1 - selection.y0) / image.height * 100}%`;
    marker.hidden = false;
    apply.disabled = selection.x1 - selection.x0 < 8 || selection.y1 - selection.y0 < 5;
    status.textContent = apply.disabled ? 'Marca una zona más grande.' : 'Zona marcada. Se usará en capturas de este tamaño.';
  });
  apply.addEventListener('click', () => { if (selection) save(selection); });
  $('screen-zone-reset').addEventListener('click', () => save(null));
  return { forFrame };
}
