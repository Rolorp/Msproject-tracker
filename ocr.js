import { extractValues, OCR_FIELDS } from './ocr-parser.js?v=0.4.6';
import { recognizeCharacterImage } from './ocr-image.js?v=0.4.6';
import { JOBS, validClass } from './jobs.js?v=0.4.6';
import { reviewGroup } from './ocr-review.js?v=0.4.6';

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
  const bases = document.getElementById('ocr-base-fields');
  const preserved = document.getElementById('ocr-preserved-fields');
  const basesPanel = document.getElementById('ocr-bases');
  const preservedPanel = document.getElementById('ocr-preserved');
  const readButton = document.getElementById('ocr-read');
  const extractButton = document.getElementById('ocr-extract');
  const applyButton = document.getElementById('ocr-apply');
  let targetForm = null;
  let imageUrl = null;
  let worker = null;
  let generation = 0;
  let selectedFile = null;

  function clearReview() {
    for (const container of [candidates, missing, bases, preserved]) container.replaceChildren();
    for (const panel of [missingPanel, basesPanel, preservedPanel]) { panel.hidden = true; panel.open = false; }
  }

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
    clearReview();
    const current = Object.fromEntries(new FormData(targetForm));
    let count = 0;
    for (const field of OCR_FIELDS) {
      const key = field.key === 'name' && targetForm.id === 'start-form' ? 'character' : field.key;
      const control = targetForm.elements.namedItem(key);
      if (!control || control.readOnly) continue;
      const group = reviewGroup(field.key, result.values, current);
      const detected = group === 'detected';
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
      const isClass = ['job', 'specialization'].includes(key);
      const input = document.createElement(isClass ? 'select' : 'input');
      if (isClass) {
        input.dataset.classField = key;
        const options = key === 'job' ? Object.keys(JOBS) : JOBS[result.values.job || targetForm.elements.job.value] || [];
        input.append(new Option(key === 'job' ? 'Selecciona un job' : 'Sin especificar / primer avance', ''), ...options.map(name => new Option(name, name)));
      } else input.type = field.type === 'text' ? 'text' : 'number';
      input.step = field.type === 'decimal' ? 'any' : '1';
      input.min = control.min || field.min || 0;
      input.max = Number.MAX_SAFE_INTEGER;
      input.value = result.values[field.key] ?? current[key] ?? '';
      input.disabled = !detected;
      input.required = detected && key !== 'specialization';
      checkbox.addEventListener('change', () => {
        input.disabled = !checkbox.checked;
        input.required = checkbox.checked && key !== 'specialization';
      });
      if (key === 'job') input.addEventListener('change', () => {
        const specialization = dialog.querySelector('[data-class-field="specialization"]');
        const previous = specialization.value;
        specialization.replaceChildren(new Option('Sin especificar / primer avance', ''), ...(JOBS[input.value] || []).map(name => new Option(name, name)));
        specialization.value = (JOBS[input.value] || []).includes(previous) ? previous : '';
      });
      valueLabel.append(input);
      row.append(selectionLabel, valueLabel);
      if (detected) {
        candidates.append(row);
        count += 1;
      } else ({ base: bases, preserved, missing })[group].append(row);
    }
    missingPanel.hidden = missing.children.length === 0;
    basesPanel.hidden = bases.children.length === 0;
    preservedPanel.hidden = preserved.children.length === 0;
    missingPanel.open = count === 0;
    const description = count
      ? `Se leyeron ${count} campos. Revisa los datos y desmarca los que quieras omitir antes de confirmar.`
      : 'No se detectaron valores para este formulario. Revisa el texto o completa los campos pendientes.';
    const needsMesos = targetForm.elements.namedItem('mesos') && result.values.mesos === undefined;
    status.textContent = [description, ...result.warnings, needsMesos ? 'Mesos pendientes: no se pudo leer el saldo. Puedes cargar una foto más cercana del inventario; los demás campos del personaje se conservan al aplicar.' : ''].join(' ');
    applyButton.disabled = candidates.children.length + missing.children.length + bases.children.length + preserved.children.length === 0;
  }

  document.querySelectorAll('[data-ocr-form]').forEach(button => {
    button.addEventListener('click', () => {
      targetForm = document.getElementById(button.dataset.ocrForm);
      rawText.value = '';
      clearReview();
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
    clearReview();
  });

  async function selectImage(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    // Cancelling either native picker preserves the image already under review.
    if (!file) return;
    selectedFile = file;
    const otherInput = input === fileInput ? cameraInput : fileInput;
    otherInput.value = '';
    clearReview();
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
    clearReview();
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
    const selected = [candidates, missing, bases, preserved].flatMap(container => [...container.children]).filter(row => row.querySelector('[type="checkbox"]').checked);
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
    if (targetForm.id === 'profile-form') {
      const classValue = key => {
        const row = selected.find(item => item.querySelector('[type="checkbox"]').name === key);
        if (row) return row.querySelector('select').value;
        const current = targetForm.elements.namedItem(key).value;
        if (key === 'specialization' && classValue('job') !== targetForm.elements.job.value) return '';
        return current;
      };
      const job = classValue('job');
      const specialization = classValue('specialization');
      if ((job || specialization) && !validClass(job, specialization)) {
        status.textContent = 'Selecciona un job y una especialización correspondiente antes de aplicar.';
        return;
      }
    }
    for (const row of selected) {
      const key = row.querySelector('[type="checkbox"]').name;
      const control = targetForm.elements.namedItem(key);
      control.value = row.querySelector('input:not([type="checkbox"]), select').value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      const section = control.closest('details.profile-section');
      if (section) section.open = true;
    }
    dialog.close();
    targetForm.querySelector('button[type="submit"]').focus();
  });
}
