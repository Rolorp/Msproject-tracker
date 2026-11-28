import { extractValues, OCR_FIELDS } from './ocr-parser.js?v=0.8.0';
import { recognizeCharacterImage, recognizeSelectedRegion } from './ocr-image.js?v=0.8.0';
import { JOBS, validClass } from './jobs.js?v=0.8.0';
import { reviewGroup } from './ocr-review.js?v=0.8.0';
import { createOcrWorker } from './ocr-worker.js?v=0.8.0';

export function setupImageImport(applySessionValues) {
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
  const preserved = document.getElementById('ocr-preserved-fields');
  const preservedPanel = document.getElementById('ocr-preserved');
  const readButton = document.getElementById('ocr-read');
  const extractButton = document.getElementById('ocr-extract');
  const applyButton = document.getElementById('ocr-apply');
  const imageInfo = document.getElementById('ocr-image-info');
  const regionButton = document.getElementById('ocr-open-region');
  const regionTools = document.getElementById('ocr-region-tools');
  const regionImage = document.getElementById('ocr-region-image');
  const regionBox = document.getElementById('ocr-region-box');
  const regionKind = document.getElementById('ocr-region-kind');
  const regionStatus = document.getElementById('ocr-region-status');
  const regionRead = document.getElementById('ocr-read-region');
  let targetForm = null;
  let imageUrl = null;
  let worker = null;
  let generation = 0;
  let selectedFile = null;
  let lastResult = null;
  let regionAnchor = null;
  let selectedBox = null;

  function resetRegion() {
    regionAnchor = null;
    selectedBox = null;
    regionBox.hidden = true;
    regionRead.disabled = true;
    regionStatus.textContent = 'Toca la primera esquina.';
  }

  regionButton.addEventListener('click', () => {
    regionTools.hidden = !regionTools.hidden;
    if (!regionTools.hidden) regionImage.src = imageUrl;
  });
  document.getElementById('ocr-reset-region').addEventListener('click', resetRegion);
  regionKind.addEventListener('change', resetRegion);
  regionImage.addEventListener('click', event => {
    if (fileInput.disabled) return;
    const bounds = regionImage.getBoundingClientRect();
    const point = { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
    if (!regionAnchor || selectedBox) {
      resetRegion();
      regionAnchor = point;
      regionBox.style.cssText = `left:${point.x * 100}%;top:${point.y * 100}%;width:4px;height:4px`;
      regionBox.hidden = false;
      regionStatus.textContent = 'Ahora toca la esquina opuesta.';
      return;
    }
    selectedBox = { x0: Math.min(regionAnchor.x, point.x), x1: Math.max(regionAnchor.x, point.x), y0: Math.min(regionAnchor.y, point.y), y1: Math.max(regionAnchor.y, point.y) };
    regionBox.style.cssText = `left:${selectedBox.x0 * 100}%;top:${selectedBox.y0 * 100}%;width:${(selectedBox.x1 - selectedBox.x0) * 100}%;height:${(selectedBox.y1 - selectedBox.y0) * 100}%`;
    regionRead.disabled = selectedBox.x1 - selectedBox.x0 < .002 || selectedBox.y1 - selectedBox.y0 < .002;
    regionStatus.textContent = regionRead.disabled ? 'La zona es demasiado pequeña. Vuelve a marcarla.' : 'Zona lista. Pulsa Leer zona marcada.';
  });

  function clearReview() {
    for (const container of [candidates, missing, preserved]) container.replaceChildren();
    for (const panel of [missingPanel, preservedPanel]) { panel.hidden = true; panel.open = false; }
  }

  function setBusy(busy) {
    fileInput.disabled = busy;
    cameraInput.disabled = busy;
    cameraButton.disabled = busy;
    readButton.disabled = busy;
    extractButton.disabled = busy;
    applyButton.disabled = busy;
    regionButton.disabled = busy || !selectedFile;
    regionRead.disabled = busy || !selectedBox;
    regionKind.disabled = busy;
    document.getElementById('ocr-reset-region').disabled = busy;
  }

  function restoreChoices(choices, replacement = {}) {
    for (const row of [...candidates.children, ...missing.children, ...preserved.children]) {
      const checkbox = row.querySelector('[type="checkbox"]');
      const sourceKey = checkbox.name === 'character' ? 'name' : checkbox.name;
      if (choices.has(checkbox.name) && replacement[sourceKey] === undefined) {
        checkbox.checked = choices.get(checkbox.name);
        checkbox.dispatchEvent(new Event('change'));
      }
    }
  }

  function showCandidates(result = extractValues(rawText.value)) {
    lastResult = result;
    clearReview();
    const session = targetForm.id !== 'profile-form';
    const conflict = session && !targetForm.hidden ? applySessionValues(result.values) : '';
    const current = Object.fromEntries(new FormData(targetForm));
    let count = 0;
    for (const field of OCR_FIELDS) {
      const key = field.key === 'name' && targetForm.id === 'start-form' ? 'character' : field.key;
      const control = targetForm.elements.namedItem(key);
      if (!control || control.readOnly || control.disabled) continue;
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
      selectionLabel.append(checkbox, field.key === 'mesos' && !detected
        ? (group === 'missing' ? 'Completar mesos' : 'Editar saldo de mesos')
        : `Aplicar ${field.label}`);
      const valueLabel = document.createElement('label');
      valueLabel.textContent = field.label;
      const isClass = ['job', 'specialization'].includes(key);
      const input = document.createElement(isClass ? 'select' : 'input');
      if (isClass) {
        input.dataset.classField = key;
        const options = key === 'job' ? Object.keys(JOBS) : JOBS[result.values.job || targetForm.elements.job.value] || [];
        input.append(new Option(key === 'job' ? 'Selecciona un job' : 'Sin especificar / primer avance', ''), ...options.map(name => new Option(name, name)));
      } else {
        input.type = field.type === 'text' ? 'text' : 'number';
        if (key === 'mesos') input.inputMode = 'numeric';
      }
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
      } else ({ preserved, missing })[group].append(row);
    }
    missingPanel.hidden = missing.children.length === 0;
    preservedPanel.hidden = preserved.children.length === 0;
    missingPanel.open = count === 0;
    const description = count
      ? session ? `Se leyeron ${count} campos. Puedes cerrar esta ventana o aplicar correcciones.`
        : `Se leyeron ${count} campos. Revisa los datos y desmarca los que quieras omitir antes de confirmar.`
      : 'No se detectaron valores para este formulario. Revisa el texto o completa los campos pendientes.';
    const needsMesos = targetForm.elements.namedItem('mesos') && result.values.mesos === undefined;
    status.textContent = [conflict || description, ...result.warnings, needsMesos ? 'Mesos pendientes: usa Leer una zona concreta para marcar el saldo del inventario y reintentar sin perder los demás datos.' : ''].join(' ');
    applyButton.disabled = candidates.children.length + missing.children.length + preserved.children.length === 0;
  }

  document.querySelectorAll('[data-ocr-form]').forEach(button => {
    button.addEventListener('click', () => {
      targetForm = document.getElementById(button.dataset.ocrForm);
      applyButton.textContent = targetForm.id === 'profile-form' ? 'Aplicar valores' : 'Aplicar correcciones';
      rawText.value = '';
      lastResult = null;
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
    lastResult = null;
    resetRegion();
    regionTools.hidden = true;
    regionImage.removeAttribute('src');
    imageInfo.hidden = true;
    rawText.value = '';
    clearReview();
  });

  async function selectImage(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    // Cancelling either native picker preserves the image already under review.
    if (!file) return;
    selectedFile = file;
    regionButton.disabled = true;
    lastResult = null;
    resetRegion();
    regionTools.hidden = true;
    imageInfo.hidden = true;
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
      imageInfo.textContent = `Lector v0.8.0 · Foto ${preview.naturalWidth} × ${preview.naturalHeight}`;
      imageInfo.hidden = false;
      regionButton.disabled = false;
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

  async function readImage(region = null) {
    const file = selectedFile;
    if (!file) {
      status.textContent = 'Selecciona una imagen primero.';
      return;
    }
    const currentGeneration = ++generation;
    let activeWorker;
    let readingStage = 'imagen';
    const previous = lastResult;
    const choices = new Map();
    if (region && previous) for (const row of [...candidates.children, ...missing.children, ...preserved.children]) {
      const checkbox = row.querySelector('[type="checkbox"]');
      const input = row.querySelector('input:not([type="checkbox"]), select');
      choices.set(checkbox.name, checkbox.checked);
      if (checkbox.checked && input.value !== '') previous.values[checkbox.name === 'character' ? 'name' : checkbox.name] = input.tagName === 'SELECT' || input.type === 'text' ? input.value : Number(input.value);
    }
    setBusy(true);
    clearReview();
    if (!region) rawText.value = '';
    status.textContent = 'Preparando la lectura. La primera vez puede tardar unos segundos.';
    try {
      activeWorker = await createOcrWorker(event => {
        if (currentGeneration === generation && event.status === 'recognizing text') {
          status.textContent = `Leyendo ${readingStage}… ${Math.round(event.progress * 100)} %`;
        }
      });
      if (currentGeneration !== generation) return;
      worker = activeWorker;
      await preview.decode();
      if (currentGeneration !== generation) return;
      const progress = stage => {
        readingStage = stage;
        if (currentGeneration === generation) status.textContent = `Leyendo ${stage}…`;
      };
      const data = region
        ? await recognizeSelectedRegion(activeWorker, preview, region.kind, region.box, () => currentGeneration !== generation)
        : await recognizeCharacterImage(activeWorker, preview, progress, () => currentGeneration !== generation);
      if (!data || currentGeneration !== generation) return;
      const result = data.values ? { values: data.values, warnings: data.warnings || [], text: data.text } : extractValues(data.text, data.blocks);
      rawText.value = region ? `${rawText.value}\n# Zona seleccionada\n${result.text}` : result.text;
      setBusy(false);
      showCandidates(region && previous ? { ...result, values: { ...previous.values, ...result.values } } : result);
      if (region) {
        restoreChoices(choices, result.values);
        regionStatus.textContent = Object.keys(result.values).length ? 'Zona leída. Revisa el valor en los campos detectados.' : 'No se pudo leer esta zona. Marca el texto más ajustado o completa el dato manualmente.';
      }
    } catch {
      if (currentGeneration === generation) {
        setBusy(false);
        if (region && previous) { showCandidates(previous); restoreChoices(choices); }
        else applyButton.disabled = true;
        status.textContent = 'No se pudo leer la imagen. Intenta otra zona o introduce el dato en el formulario.';
      }
    } finally {
      await activeWorker?.terminate();
      if (worker === activeWorker) worker = null;
    }
  }
  readButton.addEventListener('click', () => readImage());
  regionRead.addEventListener('click', () => selectedBox && readImage({ kind: regionKind.value, box: selectedBox }));

  extractButton.addEventListener('click', () => showCandidates());
  document.getElementById('ocr-review').addEventListener('submit', event => {
    event.preventDefault();
    if (targetForm.hidden) {
      status.textContent = 'El formulario cambió mientras leías la imagen. Ciérrala y vuelve a abrirlo.';
      return;
    }
    const selected = [candidates, missing, preserved].flatMap(container => [...container.children]).filter(row => row.querySelector('[type="checkbox"]').checked);
    if (!selected.length) {
      status.textContent = 'Marca al menos un campo para aplicarlo.';
      return;
    }
    for (const row of selected) {
      const key = row.querySelector('[type="checkbox"]').name;
      const control = targetForm.elements.namedItem(key);
      if (control.readOnly || control.disabled) {
        status.textContent = 'El campo pertenece al perfil guardado. Edítalo desde Perfiles de personaje.';
        return;
      }
    }
    if (targetForm.elements.job) {
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
