import { extractValues, OCR_FIELDS } from './ocr-parser.js';

function initializeWorker(tesseract, options) {
  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = error => {
      failed = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error('La preparación del OCR tardó demasiado.')), 60000);
    tesseract.createWorker('eng', 1, { ...options, errorHandler: fail }).then(created => {
      clearTimeout(timeout);
      if (failed) created.terminate();
      else resolve(created);
    }, fail);
  });
}

export function setupImageImport() {
  const dialog = document.getElementById('ocr-dialog');
  const fileInput = document.getElementById('ocr-file');
  const preview = document.getElementById('ocr-preview');
  const status = document.getElementById('ocr-status');
  const rawText = document.getElementById('ocr-text');
  const candidates = document.getElementById('ocr-candidates');
  const readButton = document.getElementById('ocr-read');
  const extractButton = document.getElementById('ocr-extract');
  const applyButton = document.getElementById('ocr-apply');
  let targetForm = null;
  let imageUrl = null;
  let worker = null;
  let generation = 0;

  function setBusy(busy) {
    fileInput.disabled = busy;
    readButton.disabled = busy;
    extractButton.disabled = busy;
    applyButton.disabled = busy;
  }

  function showCandidates() {
    const result = extractValues(rawText.value);
    candidates.replaceChildren();
    let count = 0;
    for (const field of OCR_FIELDS) {
      const control = targetForm.elements.namedItem(field.key);
      if (!control || control.readOnly || result.values[field.key] === undefined) continue;
      const row = document.createElement('div');
      row.className = 'ocr-candidate';
      const selectionLabel = document.createElement('label');
      selectionLabel.className = 'ocr-selection';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = field.key;
      selectionLabel.append(checkbox, `Aplicar ${field.label}`);
      const valueLabel = document.createElement('label');
      valueLabel.textContent = field.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.min = control.min || field.min;
      input.max = Number.MAX_SAFE_INTEGER;
      input.value = result.values[field.key];
      input.disabled = true;
      checkbox.addEventListener('change', () => {
        input.disabled = !checkbox.checked;
        input.required = checkbox.checked;
      });
      valueLabel.append(input);
      row.append(selectionLabel, valueLabel);
      candidates.append(row);
      count += 1;
    }
    const description = count
      ? 'Marca los campos que quieres aplicar y corrige sus valores antes de confirmar.'
      : 'No se detectaron valores para este formulario. Puedes corregir el texto leído y volver a extraerlos.';
    status.textContent = [description, ...result.warnings].join(' ');
    applyButton.disabled = count === 0;
  }

  document.querySelectorAll('[data-ocr-form]').forEach(button => {
    button.addEventListener('click', () => {
      targetForm = document.getElementById(button.dataset.ocrForm);
      rawText.value = '';
      candidates.replaceChildren();
      status.textContent = 'Selecciona una imagen con las etiquetas y sus valores visibles.';
      setBusy(false);
      applyButton.disabled = true;
      dialog.showModal();
    });
  });

  document.getElementById('ocr-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    generation += 1;
    worker?.terminate();
    worker = null;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    preview.removeAttribute('src');
    preview.hidden = true;
    fileInput.value = '';
    rawText.value = '';
    candidates.replaceChildren();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    candidates.replaceChildren();
    rawText.value = '';
    applyButton.disabled = true;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    preview.hidden = true;
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      status.textContent = 'Elige una imagen PNG, JPG o WebP de hasta 15 MB.';
      fileInput.value = '';
      return;
    }
    imageUrl = URL.createObjectURL(file);
    preview.src = imageUrl;
    try {
      await preview.decode();
      if (fileInput.files[0] !== file) return;
      preview.hidden = false;
      status.textContent = 'Imagen lista. Pulsa Leer imagen para extraer los valores.';
    } catch {
      if (fileInput.files[0] !== file) return;
      status.textContent = 'No se pudo abrir esta imagen. Prueba otra captura.';
      fileInput.value = '';
    }
  });

  readButton.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) {
      status.textContent = 'Selecciona una imagen primero.';
      return;
    }
    const currentGeneration = ++generation;
    let activeWorker;
    setBusy(true);
    candidates.replaceChildren();
    rawText.value = '';
    status.textContent = 'Preparando la lectura. La primera vez puede tardar unos segundos.';
    try {
      const { default: tesseract } = await import('./vendor/tesseract/tesseract.esm.min.js');
      if (currentGeneration !== generation) return;
      activeWorker = await initializeWorker(tesseract, {
        workerPath: new URL('./vendor/tesseract/worker.min.js', import.meta.url).href,
        corePath: new URL('./vendor/core/', import.meta.url).href,
        langPath: new URL('./vendor/lang/', import.meta.url).href,
        workerBlobURL: false,
        logger: event => {
          if (currentGeneration === generation && event.status === 'recognizing text') {
            status.textContent = `Leyendo imagen… ${Math.round(event.progress * 100)} %`;
          }
        }
      });
      if (currentGeneration !== generation) return;
      worker = activeWorker;
      await activeWorker.setParameters({ tessedit_pageseg_mode: '11' });
      const { data } = await activeWorker.recognize(file);
      if (currentGeneration !== generation) return;
      rawText.value = data.text;
      setBusy(false);
      showCandidates();
    } catch {
      if (currentGeneration === generation) {
        setBusy(false);
        applyButton.disabled = true;
        status.textContent = 'No se pudo leer la imagen. Intenta otra captura o introduce los datos en el formulario.';
      }
    } finally {
      await activeWorker?.terminate();
      if (worker === activeWorker) worker = null;
    }
  });

  extractButton.addEventListener('click', showCandidates);
  document.getElementById('ocr-review').addEventListener('submit', event => {
    event.preventDefault();
    if (targetForm.hidden) {
      status.textContent = 'El formulario cambió mientras leías la imagen. Ciérrala y vuelve a abrirlo.';
      return;
    }
    const selected = [...candidates.children].filter(row => row.querySelector('[type="checkbox"]').checked);
    if (!selected.length) {
      status.textContent = 'Marca al menos un campo para aplicarlo.';
      return;
    }
    for (const row of selected) {
      const key = row.querySelector('[type="checkbox"]').name;
      const control = targetForm.elements.namedItem(key);
      if (control.readOnly) {
        status.textContent = 'El campo pertenece al perfil guardado. Edítalo desde Perfiles de personaje.';
        return;
      }
    }
    for (const row of selected) {
      const key = row.querySelector('[type="checkbox"]').name;
      const control = targetForm.elements.namedItem(key);
      control.value = row.querySelector('[type="number"]').value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
    }
    dialog.close();
    targetForm.querySelector('button[type="submit"]').focus();
  });
}
