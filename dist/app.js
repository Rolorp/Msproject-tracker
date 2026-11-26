import { createSession, activeMilliseconds, pauseSession, resumeSession, stopSession, finishSession } from './session.js';
import { saveProfile } from './profile.js';
import { emptyState, restoreState } from './state.js';
import { setupImageImport } from './ocr.js';

const STORAGE_KEY = 'msproject-tracker.v1';
const $ = id => document.getElementById(id);
const numberFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });
let state = emptyState();
let storageAvailable = true;
let selectedResultId = null;
let initializedFinishId = null;
let editingProfileId = null;
let editingProfileRevision = null;
let savingProfile = false;

function message(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}

function readState() {
  return restoreState(localStorage.getItem(STORAGE_KEY));
}

try {
  state = readState();
  const probe = `${STORAGE_KEY}.probe`;
  localStorage.setItem(probe, 'ok');
  localStorage.removeItem(probe);
} catch {
  storageAvailable = false;
  message('No se puede acceder a los datos guardados. Comprueba el almacenamiento del navegador antes de iniciar una sesión.');
}

async function updateState(change) {
  if (!storageAvailable) return false;
  const update = () => {
    const saved = readState();
    if (saved.revision !== state.revision) {
      state = saved;
      render();
      throw new Error('La sesión cambió en otra pestaña. Revisa los datos antes de continuar.');
    }
    const next = { ...change(state), revision: state.revision + 1 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (next.history[0]?.id !== state.history[0]?.id) selectedResultId = null;
    state = next;
    message('');
    render();
    return true;
  };
  try {
    if (navigator.locks) return await navigator.locks.request(STORAGE_KEY, update);
    return update();
  } catch (error) {
    message(`No se guardó el cambio. ${error.message}`);
    return false;
  }
}

function appendProfileRow(templateId, containerId, values = {}) {
  const row = $(templateId).content.firstElementChild.cloneNode(true);
  for (const input of row.querySelectorAll('input')) input.value = values[input.name] ?? '';
  row.querySelector('.remove-row').addEventListener('click', () => row.remove());
  $(containerId).append(row);
}

function editProfile(profile = null) {
  const form = $('profile-form');
  form.reset();
  editingProfileId = profile?.id ?? null;
  editingProfileRevision = profile?.revision ?? null;
  $('profile-form-title').textContent = profile ? `Editar ${profile.name}` : 'Nuevo personaje';
  $('sp-pools').replaceChildren();
  $('profile-skills').replaceChildren();
  if (profile) {
    const fields = { ...profile, ...profile.attributes, ...profile.combat };
    for (const control of form.elements) {
      if (control.name) control.value = fields[control.name] ?? '';
    }
    for (const pool of profile.spPools) {
      appendProfileRow('sp-pool-template', 'sp-pools', { poolName: pool.name, poolAvailable: pool.available });
    }
    for (const skill of profile.skills) {
      appendProfileRow('skill-template', 'profile-skills', { skillName: skill.name, skillRank: skill.rank, skillPool: skill.pool });
    }
  }
  $('profiles-panel').open = true;
  form.elements.name.focus();
}

function applySelectedProfile() {
  const profile = state.profiles.find(item => item.id === $('session-profile').value);
  const form = $('start-form');
  form.elements.character.readOnly = !!profile;
  form.elements.level.readOnly = !!profile;
  if (profile) {
    form.elements.character.value = profile.name;
    form.elements.level.value = profile.level;
  }
}

function renderProfiles() {
  const selector = $('session-profile');
  const selected = selector.value;
  const manual = document.createElement('option');
  manual.value = '';
  manual.textContent = 'Registro manual';
  selector.replaceChildren(manual);
  const list = $('profile-list');
  list.replaceChildren();
  $('profile-count').textContent = state.profiles.length ? `(${state.profiles.length})` : '';
  $('save-profile').disabled = !storageAvailable || savingProfile;
  for (const profile of state.profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.name} · ${profile.job} · Nv. ${profile.level}`;
    selector.append(option);
    const item = document.createElement('div');
    item.className = 'profile-item';
    const summary = document.createElement('p');
    summary.textContent = `${profile.name} · ${profile.job} · Nv. ${profile.level} · ${profile.environment}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary';
    edit.textContent = 'Editar';
    edit.setAttribute('aria-label', `Editar ${profile.name}`);
    edit.addEventListener('click', () => editProfile(profile));
    item.append(summary, edit);
    list.append(item);
  }
  selector.value = selected;
  applySelectedProfile();
}

function renderProfileSnapshot(profile) {
  $('result-profile').hidden = !profile;
  const list = $('result-profile-values');
  list.replaceChildren();
  if (!profile) return;
  const known = value => value === null ? 'desconocido' : numberFormat.format(value);
  const fields = [
    ['Personaje', `${profile.name} · ${profile.job} · Nv. ${profile.level}`],
    ['Contexto', [profile.region, profile.world, profile.environment, profile.patch || 'Parche sin registrar'].filter(Boolean).join(' · ')],
    ['AP base', Object.entries(profile.attributes).map(([attribute, value]) => `${attribute.toUpperCase()} ${known(value)}`).join(' · ')],
    ['HP / MP máximos', `${known(profile.combat.maxHp)} / ${known(profile.combat.maxMp)}`],
    ['Weapon Attack / Magic Attack', `${known(profile.combat.weaponAttack)} / ${known(profile.combat.magicAttack)}`],
    ['Accuracy / Avoidability', `${known(profile.combat.accuracy)} / ${known(profile.combat.avoidability)}`],
    ['Equipo', profile.equipment || 'Sin registrar'],
    ['SP libres por avance', profile.spPools.map(pool => `${pool.name} ${known(pool.available)}`).join(' · ') || 'Sin registrar'],
    ['Habilidades', profile.skills.map(skill => `${skill.name} ${skill.rank}${skill.pool ? ` (${skill.pool})` : ''}`).join(' · ') || 'Sin registrar'],
    ['Procedencia', 'Registro manual. Validación de reglas pendiente.']
  ];
  for (const [label, value] of fields) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    list.append(term, description);
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
}

function updateClock() {
  $('timer').textContent = formatDuration(state.current ? activeMilliseconds(state.current, Date.now()) : 0);
}

function fillInitialValues(session) {
  const list = $('initial-values');
  list.replaceChildren();
  for (const [label, value] of [['Nivel inicial', session.initialLevel], ['EXP inicial', session.initialExp], ['Mesos iniciales', session.initialMesos]]) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = numberFormat.format(value);
    list.append(term, description);
  }
}

function renderRequirements() {
  const container = $('level-requirements');
  const previous = new Map([...container.querySelectorAll('input')].map(input => [input.name, input.value]));
  container.replaceChildren();
  const finalLevel = Number($('finish-form').elements.level.value);
  const session = state.current;
  if (!session || !Number.isInteger(finalLevel) || finalLevel <= session.initialLevel) return;
  // Bound accidental input without asserting a game level cap.
  if (finalLevel - session.initialLevel > 200) {
    message('Revisa el nivel final. Puedes registrar hasta 200 subidas de nivel por sesión.');
    return;
  }
  const explanation = document.createElement('p');
  explanation.className = 'form-hint';
  explanation.textContent = 'Introduce la EXP total requerida para superar cada nivel. Estos valores se guardan como datos manuales de esta sesión.';
  container.append(explanation);
  for (let level = session.initialLevel; level < finalLevel; level += 1) {
    const label = document.createElement('label');
    label.textContent = `EXP para pasar del nivel ${level} al ${level + 1}`;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.required = true;
    input.inputMode = 'numeric';
    input.name = `requirement-${level}`;
    input.value = previous.get(input.name) || '';
    label.append(input);
    container.append(label);
  }
}

function renderResults() {
  const result = state.history.find(session => session.id === selectedResultId) || state.history[0];
  $('results').hidden = !result;
  if (!result) return;
  const elapsed = $('time-basis').value === 'elapsed';
  $('result-exp').textContent = numberFormat.format(result.expGained);
  $('result-exp-rate').textContent = numberFormat.format(elapsed ? result.elapsedExpPerHour : result.expPerHour);
  $('result-mesos').textContent = numberFormat.format(result.netMesos);
  $('result-mesos-rate').textContent = numberFormat.format(elapsed ? result.elapsedMesosPerHour : result.mesosPerHour);
  $('result-duration').textContent = `${dateFormat.format(result.startedAt)} · Tiempo activo ${formatDuration(result.activeMs)} · Tiempo total ${formatDuration(result.elapsedMs)}`;
  renderProfileSnapshot(result.characterSnapshot);
}

function renderHistory() {
  $('history-count').textContent = state.history.length ? `${state.history.length} sesiones guardadas en este navegador` : 'Tus sesiones aparecerán aquí.';
  $('empty-history').hidden = state.history.length > 0;
  $('history-table').hidden = state.history.length === 0;
  $('export').disabled = state.history.length === 0;
  const body = $('history-body');
  body.replaceChildren();
  for (const session of state.history) {
    const row = document.createElement('tr');
    for (const value of [dateFormat.format(session.startedAt), session.map || 'Sin mapa', formatDuration(session.activeMs), numberFormat.format(session.expPerHour), numberFormat.format(session.mesosPerHour)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const character = document.createElement('small');
    character.textContent = session.character || 'Sin personaje';
    if (session.characterSnapshot) character.textContent += ` · ${session.characterSnapshot.job}`;
    row.cells[0].append(character);
    const actionCell = document.createElement('td');
    const action = document.createElement('button');
    action.className = 'secondary';
    action.textContent = 'Ver resultado';
    action.setAttribute('aria-label', `Ver resultado de ${dateFormat.format(session.startedAt)}`);
    action.addEventListener('click', () => {
      selectedResultId = session.id;
      renderResults();
      $('results').scrollIntoView({ block: 'start' });
    });
    actionCell.append(action);
    row.append(actionCell);
    body.append(row);
  }
}

function render() {
  const session = state.current;
  const isFinishing = session?.status === 'finishing';
  $('start-form').hidden = !!session;
  $('start-form').querySelector('button[type="submit"]').disabled = !storageAvailable;
  $('running-info').hidden = !session || isFinishing;
  $('finish-form').hidden = !isFinishing;
  $('timer-controls').hidden = !session || isFinishing;
  $('pause').textContent = session?.status === 'paused' ? 'Reanudar' : 'Pausar';
  const statuses = { running: 'En curso', paused: 'En pausa', finishing: 'Finalizada' };
  $('status').textContent = statuses[session?.status] || 'Lista para empezar';
  $('running-heading').textContent = session?.status === 'paused' ? 'Sesión en pausa' : 'Sesión en curso';
  $('session-context').textContent = session
    ? [session.character || 'Tu personaje', session.map || 'Sin mapa'].join(' · ')
    : 'Introduce tus valores actuales y pulsa Iniciar.';
  if (session) fillInitialValues(session);
  if (isFinishing && initializedFinishId !== session.id) {
    const form = $('finish-form');
    form.reset();
    form.elements.level.value = session.initialLevel;
    form.elements.level.min = session.initialLevel;
    $('level-requirements').replaceChildren();
    initializedFinishId = session.id;
  }
  if (!session) initializedFinishId = null;
  renderProfiles();
  updateClock();
  renderHistory();
  renderResults();
}

$('start-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  updateState(current => {
    if (current.current) throw new Error('Ya tienes una sesión abierta.');
    const profile = current.profiles.find(item => item.id === $('session-profile').value) || null;
    return { ...current, current: createSession(data, Date.now(), crypto.randomUUID(), profile) };
  });
});

$('session-profile').addEventListener('change', applySelectedProfile);
$('new-profile').addEventListener('click', () => editProfile());
$('add-sp-pool').addEventListener('click', () => appendProfileRow('sp-pool-template', 'sp-pools'));
$('add-skill').addEventListener('click', () => appendProfileRow('skill-template', 'profile-skills'));
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (savingProfile) return;
  const data = Object.fromEntries(new FormData(event.target));
  data.spPools = [...$('sp-pools').children].map(row => ({
    name: row.querySelector('[name="poolName"]').value,
    available: row.querySelector('[name="poolAvailable"]').value
  }));
  data.skills = [...$('profile-skills').children].map(row => ({
    name: row.querySelector('[name="skillName"]').value,
    rank: row.querySelector('[name="skillRank"]').value,
    pool: row.querySelector('[name="skillPool"]').value
  }));
  const id = editingProfileId || crypto.randomUUID();
  const expectedRevision = editingProfileRevision;
  savingProfile = true;
  $('save-profile').disabled = true;
  const saved = await updateState(current => ({
    ...current,
    profiles: saveProfile(current.profiles, data, id, Date.now(), expectedRevision)
  }));
  savingProfile = false;
  $('save-profile').disabled = !storageAvailable;
  if (saved) {
    editProfile(state.profiles.find(profile => profile.id === id));
    $('session-profile').value = id;
    applySelectedProfile();
    message('Personaje guardado. Puedes seleccionarlo al iniciar una sesión.');
  }
});

$('pause').addEventListener('click', () => updateState(current => ({
  ...current,
  current: current.current.status === 'paused'
    ? resumeSession(current.current, Date.now()) : pauseSession(current.current, Date.now())
})));

$('stop').addEventListener('click', () => updateState(current => ({ ...current, current: stopSession(current.current, Date.now()) })));
$('continue').addEventListener('click', () => updateState(current => {
  const session = { ...current.current, status: 'paused' };
  delete session.endedAt;
  return { ...current, current: session };
}));
$('finish-form').elements.level.addEventListener('input', renderRequirements);
$('finish-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  data.expRequirements = [...$('level-requirements').querySelectorAll('input')].map(input => input.value);
  updateState(current => {
    const completed = finishSession(current.current, data);
    return { ...current, current: null, history: [completed, ...current.history] };
  });
});
$('time-basis').addEventListener('change', renderResults);

function csvText(value) {
  const text = String(value ?? '');
  // Text from the user stays literal when a spreadsheet opens the CSV.
  const escaped = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${escaped.replaceAll('"', '""')}"`;
}

$('export').addEventListener('click', () => {
  const headers = ['id', 'inicio', 'fin', 'personaje', 'mapa', 'nivel_inicial', 'nivel_final', 'exp_inicial', 'exp_final', 'exp_requerida_por_nivel_manual', 'mesos_iniciales', 'mesos_finales', 'depositos_externos', 'retiros_externos', 'coste_consumibles_inventario', 'segundos_activos', 'segundos_totales', 'exp_ganada', 'mesos_netos', 'exp_h_activa', 'mesos_h_activa', 'exp_h_total', 'mesos_h_total', 'perfil_id', 'perfil_al_inicio_json'];
  const rows = state.history.map(session => [
    csvText(session.id), csvText(new Date(session.startedAt).toISOString()), csvText(new Date(session.endedAt).toISOString()),
    csvText(session.character), csvText(session.map), session.initialLevel, session.finalLevel,
    session.initialExp, session.finalExp, csvText(JSON.stringify(session.expRequirements)),
    session.initialMesos, session.finalMesos, session.externalDeposits, session.externalWithdrawals, session.inventoryCost,
    session.activeMs / 1000, session.elapsedMs / 1000, session.expGained, session.netMesos,
    session.expPerHour, session.mesosPerHour, session.elapsedExpPerHour, session.elapsedMesosPerHour,
    csvText(session.profileId), csvText(JSON.stringify(session.characterSnapshot ?? null))
  ].join(','));
  const blob = new Blob(['\uFEFF', headers.join(','), '\r\n', rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `msproject-sesiones-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  try {
    state = readState();
    render();
    message('Sesión actualizada desde otra pestaña.');
  } catch {
    storageAvailable = false;
    message('No se pudo leer el cambio de otra pestaña. Recarga para revisar el almacenamiento.');
  }
});

setupImageImport();
render();
setInterval(updateClock, 250);
