import { extractValues, OCR_FIELDS } from './ocr-parser.js?v=0.4.1';
import { recognizeCharacterImage } from './ocr-image.js?v=0.4.1';

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
  const cameraInput = document.getElementById('ocr-camera');
  const cameraButton = document.getElementById('ocr-open-camera');
  const preview = document.getElementById('ocr-preview');
  const status = document.getElementById('ocr-status');
  const rawText = document.getElementById('ocr-text');
  const candidates = document.getElementById('ocr-candidates');
  const missing = document.getElementById('ocr-missing-fields');
  const missingPanel = document.getElementById('ocr-missing');
  const readButton = document.getElementById('ocr-read');
  const extractButton = document.getElementById('ocr-extract');
  const applyButton = document.getElementById('ocr-apply');
  let targetForm = null;
  let imageUrl = null;
  let worker = null;
  let generation = 0;
  let selectedFile = null;

  function setBusy(busy) {
    fileInput.disabled = busy;
    cameraInput.disabled = busy;
    cameraButton.disabled = busy;
    readButton.disabled = busy;
    extractButton.disabled = busy;
    applyButton.disabled = busy;
  }

  function showCandidates() {
    const result = extractValues(rawText.value);
    candidates.replaceChildren();
    missing.replaceChildren();
    let count = 0;
    for (const field of OCR_FIELDS) {
      const key = field.key === 'name' && targetForm.id === 'start-form' ? 'character' : field.key;
      const control = targetForm.elements.namedItem(key);
      if (!control || control.readOnly) continue;
      const detected = result.values[field.key] !== undefined;
      const row = document.createElement('div');
      row.className = 'ocr-candidate';
      const selectionLabel = document.createElement('label');
      selectionLabel.className = 'ocr-selection';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = key;
      checkbox.checked = detected;
      selectionLabel.append(checkbox, `Aplicar ${field.label}`);
      const valueLabel = document.createElement('label');
      valueLabel.textContent = field.label;
      const input = document.createElement('input');
      input.type = field.type === 'text' ? 'text' : 'number';
      input.step = field.type === 'decimal' ? 'any' : '1';
      input.min = control.min || field.min || 0;
      input.max = Number.MAX_SAFE_INTEGER;
      input.value = result.values[field.key] ?? '';
      input.disabled = !detected;
      input.required = detected;
      checkbox.addEventListener('change', () => {
        input.disabled = !checkbox.checked;
        input.required = checkbox.checked;
      });
      valueLabel.append(input);
      row.append(selectionLabel, valueLabel);
      if (detected) {
        candidates.append(row);
        count += 1;
      } else missing.append(row);
    }
    missingPanel.hidden = missing.children.length === 0;
    missingPanel.open = count === 0;
    const description = count
      ? `Se leyeron ${count} campos. Revisa los datos y desmarca los que quieras omitir antes de confirmar.`
      : 'No se detectaron valores para este formulario. Revisa el texto o completa los campos pendientes.';
    status.textContent = [description, ...result.warnings].join(' ');
    applyButton.disabled = candidates.children.length + missing.children.length === 0;
  }

  document.querySelectorAll('[data-ocr-form]').forEach(button => {
    button.addEventListener('click', () => {
      targetForm = document.getElementById(button.dataset.ocrForm);
      rawText.value = '';
      candidates.replaceChildren();
      missing.replaceChildren();
      missingPanel.hidden = true;
      document.getElementById('ocr-purpose').textContent = targetForm.id === 'profile-form'
        ? 'Lee una captura general con CHARACTER STAT, sus detalles e inventario visibles. Se propondrán todos los datos del personaje para revisarlos.'
        : 'Esta lectura rellena los valores de la sesión. Para guardar AP y combate, usa Capturar personaje desde una foto.';
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
    cameraInput.value = '';
    selectedFile = null;
    rawText.value = '';
    candidates.replaceChildren();
    missing.replaceChildren();
    missingPanel.hidden = true;
  });

  async function selectImage(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    // Cancelling either native picker preserves the image already under review.
    if (!file) return;
    selectedFile = file;
    const otherInput = input === fileInput ? cameraInput : fileInput;
    otherInput.value = '';
    candidates.replaceChildren();
    missing.replaceChildren();
    missingPanel.hidden = true;
    rawText.value = '';
    applyButton.disabled = true;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    preview.hidden = true;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      status.textContent = 'Elige una imagen PNG, JPG o WebP de hasta 15 MB.';
      input.value = '';
      selectedFile = null;
      return;
    }
    imageUrl = URL.createObjectURL(file);
    preview.src = imageUrl;
    try {
      await preview.decode();
      if (selectedFile !== file) return;
      preview.hidden = false;
      status.textContent = 'Imagen lista. Pulsa Leer imagen para extraer los valores.';
    } catch {
      if (selectedFile !== file) return;
      status.textContent = 'No se pudo abrir esta imagen. Prueba otra captura.';
      input.value = '';
      selectedFile = null;
    }
  }

  fileInput.addEventListener('change', selectImage);
  cameraInput.addEventListener('change', selectImage);
  cameraButton.addEventListener('click', () => cameraInput.click());

  readButton.addEventListener('click', async () => {
    const file = selectedFile;
    if (!file) {
      status.textContent = 'Selecciona una imagen primero.';
      return;
    }
    const currentGeneration = ++generation;
    let activeWorker;
    let readingStage = 'imagen';
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
            status.textContent = `Leyendo ${readingStage}… ${Math.round(event.progress * 100)} %`;
          }
        }
      });
      if (currentGeneration !== generation) return;
      worker = activeWorker;
      await preview.decode();
      if (currentGeneration !== generation) return;
      const data = await recognizeCharacterImage(activeWorker, preview, stage => {
        readingStage = stage;
        if (currentGeneration === generation) status.textContent = `Leyendo ${stage}…`;
      }, () => currentGeneration !== generation);
      if (!data || currentGeneration !== generation) return;
      rawText.value = extractValues(data.text, data.blocks).text;
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
    const selected = [...candidates.children, ...missing.children].filter(row => row.querySelector('[type="checkbox"]').checked);
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
      control.value = row.querySelector('input:not([type="checkbox"])').value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      const section = control.closest('details.profile-section');
      if (section) section.open = true;
    }
    dialog.close();
    targetForm.querySelector('button[type="submit"]').focus();
  });
}
