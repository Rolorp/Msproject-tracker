import { recognizeSessionFrame } from './ocr-image.js?v=0.8.0';
import { createOcrWorker } from './ocr-worker.js?v=0.8.0';
import { freshFinishReading, recordLiveProgress } from './session.js?v=0.8.0';
import { setupCaptureZones } from './screen-zones.js?v=0.8.0';

const INTERVAL = 3500;
const STALE_AFTER = 15000;
const INVENTORY_RETRY = 10000;
const FORMAT = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
const TIME = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function setupScreenCapture(getSession, applyValues) {
  const $ = id => document.getElementById(id);
  const panel = $('screen-capture');
  if (!navigator.mediaDevices?.getDisplayMedia) return { sync() {}, refresh() {} };

  const share = $('screen-share');
  const stop = $('screen-stop');
  const read = $('screen-read');
  const saveFrame = $('screen-save-frame');
  const markZones = $('screen-mark-zones');
  const status = $('screen-status');
  let connection = null;
  let permissionRequest = null;
  let previousSession = null;
  let review = null;
  let live = {};
  let diagnosis = null;
  let latestReading = null;
  let notice = 'Selecciona la ventana de MapleStory. Abre el inventario al tomar los valores iniciales y finales.';
  const captureZones = setupCaptureZones(() => connection?.frame, () => {
    takeReading(connection, getSession()?.status !== 'running', true);
  });

  function stamp(value) {
    if (!value) return '';
    const stale = !connection || Date.now() - value.capturedAt > STALE_AFTER;
    return `Última lectura ${TIME.format(value.capturedAt)}${stale ? ' · desactualizada' : ''}`;
  }

  function renderDiagnostics(tracking) {
    const age = reading => Math.max(0, Math.floor((Date.now() - reading.capturedAt) / 1000));
    const detectedExp = diagnosis?.expSource;
    const expText = detectedExp
      ? `Barra inferior${diagnosis.expMarked ? ' · zona marcada' : ''} · EXP leída hace ${age(diagnosis)} s`
      : 'Número de EXP pendiente · comprueba la barra o pulsa Marcar zonas';
    const mesosText = diagnosis?.inventory === 'read'
      ? `Saldo leído hace ${age(diagnosis)} s`
      : diagnosis?.inventory === 'pending' ? 'Saldo pendiente · tiempo de lectura agotado'
      : diagnosis?.inventory === 'unreadable'
        ? 'Inventario detectado · saldo ilegible'
        : 'Pendiente · abre el inventario';
    const windowText = permissionRequest ? 'Esperando permiso' : !connection ? 'Sin compartir'
      : connection.frameState === 'received' ? `Imagen recibida · ${connection.video.videoWidth} × ${connection.video.videoHeight}`
      : connection.frameState === 'blank' ? 'Imagen oscura · comprueba la ventana del juego'
      : connection.frameState === 'waiting' ? 'Sin imagen nueva' : 'Esperando imagen';
    const current = !!connection && !!diagnosis && age(diagnosis) * 1000 <= STALE_AFTER;
    const previous = reading => reading ? ` · última lectura hace ${age(reading)} s` : '';
    for (const [id, text, ready] of [
      ['capture-window-state', windowText, connection?.frameState === 'received'],
      ['capture-exp-state', (connection ? expText : 'Pendiente de captura') + (tracking && !detectedExp ? previous(live.exp) : ''), current && !!detectedExp],
      ['capture-mesos-state', (connection ? mesosText : 'Pendiente de captura') + (tracking && diagnosis?.inventory !== 'read' ? previous(live.mesos) : ''), current && diagnosis?.inventory === 'read']
    ]) {
      const field = $(id);
      if (field.textContent !== text) field.textContent = text;
      field.dataset.ready = String(!!ready);
    }
  }

  function refresh() {
    const session = getSession();
    const tracking = ['running', 'paused'].includes(session?.status);
    const readable = !!connection?.ready;
    share.hidden = !!connection;
    share.disabled = !!permissionRequest;
    stop.hidden = !connection && !permissionRequest;
    read.hidden = !readable || session?.status === 'paused';
    read.disabled = !!connection?.reading;
    read.textContent = tracking ? 'Leer ahora' : 'Leer valores';
    saveFrame.hidden = !connection?.frame;
    markZones.hidden = !connection?.frame;
    $('screen-review').hidden = tracking || !review;
    $('screen-live').hidden = !tracking || (!connection && !live.exp && !live.mesos);

    if (status.textContent !== notice) status.textContent = notice;
    renderDiagnostics(tracking);

    if (!tracking && review) {
      const { values, capturedAt } = review;
      const progress = values.exp === undefined ? 'EXP pendiente' : `EXP ${FORMAT.format(values.exp)}`;
      $('screen-review').textContent = [
        values.name,
        values.job,
        values.specialization,
        values.map,
        values.level === undefined ? 'Nivel pendiente' : `Nv. ${values.level}`,
        progress,
        values.mesos === undefined ? 'Saldo pendiente' : `${FORMAT.format(values.mesos)} mesos`,
        stamp({ capturedAt })
      ].filter(Boolean).join(' · ');
    }
    if (tracking) {
      const exp = live.exp;
      const mesos = live.mesos;
      $('screen-exp').textContent = exp ? [
        exp.level ? `Nv. ${exp.level}` : 'Nivel sin confirmar',
        FORMAT.format(exp.value),
        exp.rate === null ? null : `${FORMAT.format(exp.rate)} EXP/h`
      ].filter(Boolean).join(' · ') : 'Pendiente';
      $('screen-exp-time').textContent = [
        exp && stamp(exp),
        live.pendingLevel && 'Confirmando cambio de nivel',
        exp?.level > session.initialLevel && 'Completa la EXP requerida al finalizar'
      ].filter(Boolean).join(' · ');
      $('screen-mesos').textContent = mesos ? [
        FORMAT.format(mesos.value),
        mesos.rate === null ? null : `${FORMAT.format(mesos.rate)} mesos/h según saldo`
      ].filter(Boolean).join(' · ') : 'Pendiente';
      $('screen-mesos-time').textContent = stamp(mesos) || 'Abre el inventario para leer el saldo.';
    }
  }

  function applyReview(values, capturedAt, reused = false) {
    review = { values, capturedAt };
    const conflict = applyValues(values);
    const finishing = getSession()?.status === 'finishing';
    const messages = [];
    if (finishing && values.mesos === undefined) {
      messages.push('Para completar los mesos finales, abre el inventario y pulsa Leer valores, o escríbelos en el formulario.');
    }
    if (!finishing && values.map === undefined) messages.push('Abre el minimapa para leer la ubicación si quieres registrarla.');
    const populated = ['level', 'exp', 'mesos', 'name', 'job', 'map'].some(field => values[field] !== undefined);
    notice = conflict || [reused ? 'Valores finales rellenados con la última lectura.'
      : populated ? 'Valores detectados en el formulario.' : 'No se detectaron valores en esta lectura.', ...messages].join(' ');
  }

  function disconnect(text = 'Captura detenida.') {
    permissionRequest = null;
    const current = connection;
    connection = null;
    diagnosis = null;
    latestReading = null;
    if (current) {
      clearTimeout(current.timer);
      current.stream.getTracks().forEach(track => track.stop());
      current.video.srcObject = null;
      if (current.frame) current.frame.width = current.frame.height = 1;
      current.worker?.terminate();
    }
    notice = text;
    refresh();
  }

  function schedule(current) {
    clearTimeout(current.timer);
    if (connection !== current || getSession()?.status !== 'running') return;
    current.timer = setTimeout(() => takeReading(current), INTERVAL);
  }

  async function takeReading(current, forReview = false, force = false) {
    if (!current?.ready || current !== connection) return;
    if (current.reading) {
      if (forReview) current.reviewQueued = true;
      return;
    }
    clearTimeout(current.timer);
    const session = getSession();
    const phase = session?.status;
    const currentPhase = () => connection === current && getSession()?.id === session?.id && getSession()?.status === phase;
    if (forReview ? ['running', 'paused'].includes(phase) : phase !== 'running') return;
    const { video, track } = current;
    if (track.muted || track.readyState !== 'live' || video.readyState < 2 || !video.videoWidth ||
        (!forReview && !force && video.currentTime === current.lastVideoTime)) {
      current.frameState = 'waiting';
      notice = 'Sin imagen nueva. Mantén visible el juego y comprueba la ventana compartida.';
      refresh();
      schedule(current);
      return;
    }

    current.reading = true;
    current.lastVideoTime = video.currentTime;
    if (forReview) notice = phase === 'finishing' ? 'Leyendo valores finales con el cronómetro detenido…' : 'Leyendo los valores de la ventana…';
    refresh();
    const capturedAt = Date.now();
    let timeout;
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 3840 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      canvas.captureResolution = `${video.videoWidth}x${video.videoHeight}`;
      if (current.frame) current.frame.width = current.frame.height = 1;
      current.frame = canvas;
      let light = false;
      for (let y = 0; y < frame.height && !light; y += 8) {
        for (let x = 0; x < frame.width && !light; x += 8) {
          const pixel = (y * frame.width + x) * 4;
          light = Math.max(frame.data[pixel], frame.data[pixel + 1], frame.data[pixel + 2]) > 35;
        }
      }
      current.frameState = light ? 'received' : 'blank';
      if (!light) {
        diagnosis = null;
        notice = 'Mantén el juego visible y comprueba la ventana compartida.';
        return;
      }

      if (!current.worker) {
        const worker = await createOcrWorker();
        if (connection !== current) {
          await worker.terminate();
          return;
        }
        current.worker = worker;
      }
      const searchInventory = forReview || force || capturedAt - (current.lastInventorySearch ?? 0) >= INVENTORY_RETRY;
      if (searchInventory) current.lastInventorySearch = capturedAt;
      const worker = current.worker;
      let partialReading;
      let expired = false;
      let values;
      try {
        values = await Promise.race([
          recognizeSessionFrame(worker, frame, () => expired || !currentPhase(), forReview, searchInventory,
            captureZones.forFrame(frame, canvas.captureResolution), reading => { partialReading = reading; }),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Tiempo de lectura agotado')), 20000); })
        ]);
      } catch (error) {
        expired = true;
        if (!partialReading) throw error;
        // Preserve available values when the secondary inventory search stalls.
        if (current.worker === worker) {
          current.worker = null;
          worker.terminate();
        }
        values = partialReading;
      }
      if (!currentPhase() || !values) return;
      diagnosis = { ...values, capturedAt };
      if (forReview) {
        if (values.name) current.characterName = values.name;
        applyReview(values, capturedAt);
      } else {
        const previousExp = live.exp;
        live = recordLiveProgress(live, values, session, capturedAt);
        latestReading = {
          capturedAt,
          values: { ...values, name: current.characterName, exp: live.exp !== previousExp ? values.exp : undefined }
        };
        notice = values.exp !== undefined
          ? 'Leyendo el progreso de la sesión.'
          : 'Número de EXP pendiente. Mantén visible la parte inferior del juego.';
      }
    } catch {
      if (connection === current && current.worker) {
        current.worker.terminate();
        current.worker = null;
      }
      if (currentPhase()) notice = phase === 'finishing'
        ? 'No se completó la lectura final. Abre el inventario y pulsa Leer valores, o escribe los datos finales.'
        : 'No se pudo leer la ventana. Puedes reintentar o usar una foto.';
    } finally {
      clearTimeout(timeout);
      current.reading = false;
      if (connection === current) {
        refresh();
        if (current.reviewQueued) {
          current.reviewQueued = false;
          takeReading(current, true);
        } else schedule(current);
      }
    }
  }

  share.addEventListener('click', async () => {
    if (permissionRequest || connection) return;
    const request = {};
    let opened = null;
    permissionRequest = request;
    notice = 'Selecciona MapleStory en el selector del navegador.';
    refresh();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window', frameRate: { ideal: 4, max: 8 } },
        audio: false,
        selfBrowserSurface: 'exclude'
      });
      if (request !== permissionRequest) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach(item => item.stop());
        disconnect('El navegador no entregó una imagen. Reintenta seleccionando la ventana del juego.');
        return;
      }
      const video = document.createElement('video');
      const current = { stream, track, video, ready: false, reading: false, reviewQueued: false };
      opened = current;
      connection = current;
      permissionRequest = null;
      track.addEventListener('ended', () => {
        if (connection === current) disconnect('El navegador dejó de compartir la ventana.');
      }, { once: true });
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      refresh();
      await video.play();
      if (connection !== current) return;
      current.ready = true;
      const phase = getSession()?.status;
      if (phase === 'paused') {
        notice = 'La sesión está en pausa.';
        refresh();
      } else takeReading(current, phase !== 'running');
    } catch (error) {
      if (opened ? connection !== opened : request !== permissionRequest) return;
      disconnect(error.name === 'NotAllowedError' ? 'No se compartió ninguna ventana. Puedes reintentar o usar una foto.'
        : 'No se pudo abrir la captura. Prueba otra ventana o usa una foto.');
    }
  });
  stop.addEventListener('click', () => disconnect());
  saveFrame.addEventListener('click', () => {
    connection?.frame?.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'msproject-fotograma.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  });
  read.addEventListener('click', () => takeReading(connection, getSession()?.status !== 'running', true));
  window.addEventListener('pagehide', () => disconnect());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && getSession()?.status === 'running') takeReading(connection, false, true);
  });

  panel.hidden = false;
  return {
    refresh,
    sync() {
      const session = getSession();
      const previous = previousSession;
      previousSession = session;
      if (previous?.id !== session?.id) {
        review = null;
        live = {};
        diagnosis = null;
        latestReading = null;
        if (previous) {
          disconnect(session ? 'La sesión cambió. Comparte la ventana para continuar la lectura.' : 'Captura detenida al guardar la sesión.');
          return;
        }
      }
      if (session?.status !== previous?.status) {
        if (connection) clearTimeout(connection.timer);
        review = null;
        if (session?.status === 'running') {
          if (connection) {
            notice = 'Esperando una lectura de la barra de EXP.';
            takeReading(connection);
          }
        } else if (session?.status === 'finishing') {
          const recent = freshFinishReading(latestReading, session.endedAt);
          if (recent) applyReview(recent.values, recent.capturedAt, true);
          else if (connection?.ready) {
            notice = 'Leyendo valores finales con el cronómetro detenido…';
            takeReading(connection, true);
          } else notice = 'Completa los valores finales o comparte la ventana con el inventario abierto.';
        } else if (connection && session?.status === 'paused') {
          if (previous?.status === 'finishing') latestReading = null;
          connection.reviewQueued = false;
          notice = 'La sesión está en pausa.';
        }
      }
      refresh();
    }
  };
}
