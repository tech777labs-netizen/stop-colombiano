import { DEFAULT_CATEGORIES } from './scoring.js';
import './styles.css';

const STORAGE_KEY = 'stop-colombiano-player';
const API = '/api/room';
const state = {
  player: loadPlayer(),
  room: null,
  answers: {},
  loading: false,
  error: '',
  poll: null,
  draftTimer: null,
  savingDraft: false
};

function loadPlayer() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (saved.id) return saved;
  const player = { id: crypto.randomUUID(), name: '' };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
  return player;
}

function savePlayer(next) {
  state.player = { ...state.player, ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.player));
}

async function api(payload, method = 'POST', options = {}) {
  const { silent = false, hydrate = true } = options;
  if (!silent) {
    state.loading = true;
    state.error = '';
    render();
  }
  try {
    const res = method === 'GET'
      ? await fetch(`${API}?code=${encodeURIComponent(payload.code)}`)
      : await fetch(API, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, playerId: state.player.id })
        });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Algo salió mal.');
    state.room = data.room;
    if (hydrate) hydrateAnswersFromCurrentRound();
    startPolling();
  } catch (error) {
    if (!silent) state.error = error.message;
  } finally {
    if (!silent) {
      state.loading = false;
      render();
    }
  }
}

function startPolling() {
  if (!state.room?.code || state.poll) return;
  state.poll = setInterval(async () => {
    if (!state.room?.code) return;
    try {
      const wasEditingAnswers = isEditingAnswers();
      const previousStatus = state.room.status;
      const previousRound = currentRound()?.number;
      const res = await fetch(`${API}?code=${encodeURIComponent(state.room.code)}`);
      if (!res.ok) return;
      const data = await res.json();
      state.room = data.room;
      const samePlayableRound = state.room.status === 'playing'
        && previousStatus === 'playing'
        && currentRound()?.number === previousRound;

      if (wasEditingAnswers && samePlayableRound) return;
      if (currentRound()?.number !== previousRound) state.answers = {};
      hydrateAnswersFromCurrentRound();
      render();
    } catch {}
  }, 1800);
}

function isEditingAnswers() {
  return Boolean(document.activeElement?.closest?.('.answers'));
}

function currentRound() {
  return state.room?.rounds?.[state.room.rounds.length - 1] || null;
}

function me() {
  return state.room?.players?.find((p) => p.id === state.player.id);
}

function stoppedByName() {
  const stoppedBy = currentRound()?.stoppedBy;
  return state.room?.players?.find((p) => p.id === stoppedBy)?.name || 'alguien';
}

function hydrateAnswersFromCurrentRound() {
  const round = currentRound();
  const saved = round?.drafts?.[state.player.id] || round?.submissions?.[state.player.id];
  if (saved) {
    state.answers = Object.fromEntries(state.room.categories.map((cat) => [cat, saved[cat] || '']));
  }
}

function isMySubmissionReady() {
  const round = currentRound();
  return Boolean(round?.submissions?.[state.player.id]);
}

function setAnswer(category, value) {
  state.answers[category] = value;
}

function scheduleDraftSave() {
  if (!state.room?.code || state.room.status !== 'playing') return;
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(async () => {
    state.savingDraft = true;
    await api({ action: 'draft', code: state.room.code, answers: state.answers }, 'POST', { silent: true, hydrate: false });
    state.savingDraft = false;
  }, 450);
}

function pointsFor(playerId, category) {
  return currentRound()?.scores?.byPlayer?.[playerId]?.[category]?.points ?? 0;
}

function reasonFor(playerId, category) {
  return currentRound()?.scores?.byPlayer?.[playerId]?.[category]?.reason || '';
}

function auditValue(playerId, category) {
  return Boolean(currentRound()?.audit?.[playerId]?.[category]);
}

function answerFor(playerId, category) {
  return currentRound()?.submissions?.[playerId]?.[category] || '';
}

function totalFor(playerId) {
  return currentRound()?.scores?.playerTotals?.[playerId] ?? 0;
}

function confetti() {
  const el = document.createElement('div');
  el.className = 'confetti';
  el.textContent = '🎉 ¡STOP! 🎉';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

window.StopApp = {
  createRoom(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = String(form.get('name') || '').trim();
    savePlayer({ name });
    api({ action: 'create', name, categories: DEFAULT_CATEGORIES });
  },
  joinRoom(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = String(form.get('name') || '').trim();
    const code = String(form.get('code') || '').trim().toUpperCase();
    savePlayer({ name });
    api({ action: 'join', name, code });
  },
  refresh() {
    if (state.room?.code) api({ code: state.room.code }, 'GET');
  },
  startRound() {
    api({ action: 'start', code: state.room.code });
  },
  submitAnswers(event) {
    event.preventDefault();
    clearTimeout(state.draftTimer);
    api({ action: 'submit', code: state.room.code, answers: state.answers });
  },
  stopRound(event) {
    event?.preventDefault?.();
    clearTimeout(state.draftTimer);
    confetti();
    api({ action: 'stop', code: state.room.code, answers: state.answers });
  },
  setAudit(playerId, category, valid) {
    api({ action: 'audit', code: state.room.code, targetPlayerId: playerId, category, valid });
  },
  finalizeAudit() {
    api({ action: 'finalize', code: state.room.code });
  },
  resetGame() {
    if (confirm('¿Reiniciar marcador y rondas?')) api({ action: 'reset', code: state.room.code });
  },
  leaveRoom() {
    state.room = null;
    state.answers = {};
    clearInterval(state.poll);
    clearTimeout(state.draftTimer);
    state.poll = null;
    render();
  },
  updateAnswer(category, value) {
    setAnswer(category, value);
    scheduleDraftSave();
  },
  copyInvite() {
    const url = `${location.origin}${location.pathname}?sala=${state.room.code}`;
    navigator.clipboard?.writeText(`Juguemos Stop: ${url} Código: ${state.room.code}`);
    alert('Invitación copiada');
  }
};

function landing() {
  const queryCode = new URLSearchParams(location.search).get('sala') || '';
  return `
    <section class="hero">
      <div class="badge">MVP familiar en línea</div>
      <h1>Stop Colombiano</h1>
      <p>Arma una sala, comparte el código y juega Stop con tu familia desde varios celulares.</p>
    </section>
    <section class="grid two">
      <form class="card" onsubmit="StopApp.createRoom(event)">
        <h2>Crear sala</h2>
        <label>Tu nombre
          <input name="name" required maxlength="24" value="${escapeHtml(state.player.name || '')}" placeholder="Ej: Johan" />
        </label>
        <button type="submit">Crear sala</button>
      </form>
      <form class="card" onsubmit="StopApp.joinRoom(event)">
        <h2>Unirme</h2>
        <label>Tu nombre
          <input name="name" required maxlength="24" value="${escapeHtml(state.player.name || '')}" placeholder="Ej: Laura" />
        </label>
        <label>Código de sala
          <input name="code" required maxlength="4" value="${escapeHtml(queryCode)}" placeholder="ABCD" class="code-input" />
        </label>
        <button type="submit" class="secondary">Entrar</button>
      </form>
    </section>
  `;
}

function lobby() {
  return `
    <section class="card room-head">
      <div>
        <p class="muted">Código de sala</p>
        <h1 class="room-code">${state.room.code}</h1>
      </div>
      <div class="actions">
        <button onclick="StopApp.copyInvite()" class="secondary">Copiar invitación</button>
        <button onclick="StopApp.startRound()">Empezar ronda</button>
      </div>
    </section>
    ${playersCard()}
    <section class="card">
      <h2>Cómo jugar</h2>
      <ol>
        <li>Comparte el código con todos.</li>
        <li>Al empezar, sale una letra.</li>
        <li>Tus respuestas se guardan automáticamente mientras escribes.</li>
        <li>El primero que termine presiona <strong>STOP</strong> y se congelan las respuestas de todos.</li>
        <li>El anfitrión audita si cada respuesta es válida.</li>
        <li>Puntaje: única 100, repetida 50, vacía/inválida 0.</li>
      </ol>
    </section>
  `;
}

function playing() {
  const round = currentRound();
  return `
    <section class="card round-banner">
      <div>
        <p class="muted">Ronda ${round.number}</p>
        <h1>Letra <span>${round.letter}</span></h1>
        <p class="muted">Se guarda automático. Si alguien presiona STOP, queda lo que tengas escrito.</p>
      </div>
      <button onclick="StopApp.refresh()" class="ghost">Actualizar</button>
    </section>
    <form class="card answers" onsubmit="StopApp.submitAnswers(event)">
      <h2>Mis respuestas</h2>
      <div class="grid two">
        ${state.room.categories.map((cat) => `
          <label>${label(cat)}
            <input ${isMySubmissionReady() ? 'disabled' : ''} value="${escapeHtml(state.answers[cat] || '')}" oninput="StopApp.updateAnswer('${cat}', this.value)" placeholder="${round.letter}..." />
          </label>
        `).join('')}
      </div>
      <div class="actions sticky-actions">
        <span class="muted">${state.savingDraft ? 'Guardando...' : 'Autoguardado activo'}</span>
        <button type="submit" class="secondary" ${isMySubmissionReady() ? 'disabled' : ''}>Guardar respuestas</button>
        <button type="button" class="danger" onclick="StopApp.stopRound(event)">¡STOP!</button>
      </div>
      ${isMySubmissionReady() ? '<p class="ok">Tus respuestas están guardadas. Esperando STOP...</p>' : ''}
    </form>
    ${playersCard()}
  `;
}

function audit() {
  const round = currentRound();
  const host = me()?.host;
  return `
    <section class="card round-banner audit-banner">
      <div>
        <p class="muted">Ronda ${round.number} · Letra ${round.letter}</p>
        <h1>Auditoría de respuestas</h1>
        <p>STOP fue presionado por <strong>${escapeHtml(stoppedByName())}</strong>. Se congelaron las respuestas parciales de todos.</p>
      </div>
      ${host ? '<button onclick="StopApp.finalizeAudit()">Validar y calcular puntos</button>' : '<span class="badge">Esperando al anfitrión</span>'}
    </section>
    <section class="card">
      <h2>Revisión por categoría</h2>
      <p class="muted">El anfitrión marca ✅ válida o ❌ inválida. Vacía/inválida = 0. Única = 100. Repetida = 50.</p>
      <div class="audit-list">
        ${state.room.categories.map((cat) => `
          <div class="audit-category">
            <h3>${label(cat)}</h3>
            ${state.room.players.map((p) => auditAnswer(p, cat, host)).join('')}
          </div>
        `).join('')}
      </div>
    </section>
    ${playersCard()}
  `;
}

function auditAnswer(player, category, host) {
  const answer = answerFor(player.id, category);
  const valid = auditValue(player.id, category);
  const playerId = jsString(player.id);
  const cat = jsString(category);
  return `
    <div class="audit-answer ${valid ? 'valid' : 'invalid'}">
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <span>${escapeHtml(answer) || '— vacío —'}</span>
      </div>
      <div class="audit-actions">
        <button class="small ${valid ? '' : 'ghost'}" ${host ? `onclick="StopApp.setAudit(${playerId}, ${cat}, true)"` : 'disabled'}>✅ Válida</button>
        <button class="small ${valid ? 'ghost' : 'danger'}" ${host ? `onclick="StopApp.setAudit(${playerId}, ${cat}, false)"` : 'disabled'}>❌ Inválida</button>
      </div>
    </div>
  `;
}

function results() {
  const round = currentRound();
  const winner = [...state.room.players].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  return `
    <section class="card round-banner results-banner">
      <div>
        <p class="muted">Resultados ronda ${round.number} · Letra ${round.letter}</p>
        <h1>Ganando: ${escapeHtml(winner?.name || '—')} 🏆</h1>
      </div>
      <button onclick="StopApp.startRound()">Nueva ronda</button>
    </section>
    <section class="card table-card">
      <h2>Detalle auditado</h2>
      <div class="score-table">
        <div class="row header"><span>Jugador</span>${state.room.categories.map((c) => `<span>${label(c)}</span>`).join('')}<span>Total ronda</span><span>Acumulado</span></div>
        ${state.room.players.map((p) => `
          <div class="row">
            <strong>${escapeHtml(p.name)}</strong>
            ${state.room.categories.map((c) => `<span>${escapeHtml(answerFor(p.id, c)) || '—'} <em>${pointsFor(p.id, c)}</em><small>${reasonFor(p.id, c)}</small></span>`).join('')}
            <strong>+${totalFor(p.id)}</strong>
            <strong>${p.score || 0}</strong>
          </div>
        `).join('')}
      </div>
    </section>
    ${playersCard()}
  `;
}

function playersCard() {
  return `
    <section class="card">
      <div class="between"><h2>Jugadores</h2><button class="ghost" onclick="StopApp.refresh()">↻</button></div>
      <div class="players">
        ${state.room.players.map((p) => `<div class="player ${p.id === state.player.id ? 'me' : ''}"><span>${escapeHtml(p.name)}${p.host ? ' 👑' : ''}</span><strong>${p.score || 0}</strong></div>`).join('')}
      </div>
    </section>
  `;
}

function render() {
  const app = document.querySelector('#app');
  const content = !state.room ? landing()
    : state.room.status === 'playing' ? playing()
    : state.room.status === 'audit' ? audit()
    : state.room.status === 'results' ? results()
    : lobby();
  app.innerHTML = `
    <nav>
      <strong>🇨🇴 Stop</strong>
      <div>${state.room ? `<button class="ghost" onclick="StopApp.leaveRoom()">Salir</button>` : ''}</div>
    </nav>
    ${state.error ? `<div class="toast error">${escapeHtml(state.error)}</div>` : ''}
    ${state.loading ? '<div class="toast">Cargando...</div>' : ''}
    ${content}
    ${state.room ? `<footer><button class="link" onclick="StopApp.resetGame()">Reiniciar juego</button></footer>` : ''}
  `;
}

function label(category) {
  const labels = { nombre: 'Nombre', apellido: 'Apellido', ciudad: 'Ciudad / lugar', animal: 'Animal', comida: 'Comida', cosa: 'Cosa', color: 'Color' };
  return labels[category] || category;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
}

function jsString(value = '') {
  return JSON.stringify(String(value));
}

render();
if (new URLSearchParams(location.search).get('sala')) {
  // El formulario queda precargado para entrar rápido desde link compartido.
}
