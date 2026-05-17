import { connectLambda, getStore } from '@netlify/blobs';
import { calculateScores, DEFAULT_CATEGORIES, normalizeAnswer } from '../../src/scoring.js';

function roomStore() {
  if (process.env.STOP_BLOBS_SITE_ID && process.env.STOP_BLOBS_TOKEN) {
    return getStore({
      name: 'stop-rooms',
      siteID: process.env.STOP_BLOBS_SITE_ID,
      token: process.env.STOP_BLOBS_TOKEN
    });
  }
  return getStore('stop-rooms');
}
const LETTERS = 'ABCDEFGHIJLMNOPQRSTUVZ'.split('');
const ROOM_TTL_MS = 1000 * 60 * 60 * 12;

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  },
  body: JSON.stringify(body)
});

function code() {
  return Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 24) || 'Jugador';
}

function sanitizeAnswers(rawAnswers = {}, categories = DEFAULT_CATEGORIES) {
  const answers = {};
  for (const category of categories) answers[category] = String(rawAnswers?.[category] || '').slice(0, 80);
  return answers;
}

function startsWithRoundLetter(answer, letter) {
  const normalized = normalizeAnswer(answer);
  const normalizedLetter = normalizeAnswer(letter).slice(0, 1);
  return Boolean(normalized && normalized.startsWith(normalizedLetter));
}

function initialAudit(players, submissions, categories, letter) {
  const audit = {};
  for (const player of players) {
    audit[player.id] = {};
    for (const category of categories) {
      const answer = submissions?.[player.id]?.[category] || '';
      // Vacías quedan inválidas automáticamente; letra incorrecta queda marcada como inválida sugerida.
      audit[player.id][category] = Boolean(normalizeAnswer(answer)) && startsWithRoundLetter(answer, letter);
    }
  }
  return audit;
}

function freezeSubmissions(room, round) {
  const frozen = {};
  for (const player of room.players) {
    frozen[player.id] = {
      ...sanitizeAnswers(round.drafts?.[player.id] || round.submissions?.[player.id] || {}, room.categories),
      submittedAt: round.drafts?.[player.id]?.submittedAt || round.submissions?.[player.id]?.submittedAt || Date.now()
    };
  }
  return frozen;
}

async function getRoom(roomCode, attempts = 1) {
  if (!roomCode) return null;
  const key = roomCode.toUpperCase();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const store = roomStore();
    const room = await store.get(key, { type: 'json' });
    if (room) {
      if (Date.now() - Number(room.updatedAt || 0) > ROOM_TTL_MS) {
        await store.delete(key);
        return null;
      }
      return room;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function saveRoom(room) {
  const store = roomStore();
  room.updatedAt = Date.now();
  await store.setJSON(room.code, room);
  return room;
}

function publicRoom(room) {
  return {
    ...room,
    serverTime: Date.now()
  };
}

function requirePlayer(room, playerId) {
  return room.players.some((p) => p.id === playerId);
}

function isHost(room, playerId) {
  return Boolean(room.players.find((p) => p.id === playerId)?.host);
}

function nextRoundNumber(room) {
  return (room.rounds?.length || 0) + 1;
}

function buildRound(room, letter) {
  return {
    number: nextRoundNumber(room),
    letter: String(letter || LETTERS[Math.floor(Math.random() * LETTERS.length)]).toUpperCase().slice(0, 1),
    status: 'playing',
    startedAt: Date.now(),
    stoppedAt: null,
    stoppedBy: null,
    drafts: {},
    submissions: {},
    audit: null,
    scores: null,
    finalized: false
  };
}

function currentRound(room) {
  return room.rounds?.[room.rounds.length - 1] || null;
}

export const handler = async (event) => {
  connectLambda(event);
  try {
    if (event.httpMethod === 'GET') {
      const roomCode = event.queryStringParameters?.code?.toUpperCase();
      const room = await getRoom(roomCode, 30);
      if (!room) return json(404, { error: 'Sala no encontrada o vencida.' });
      return json(200, { room: publicRoom(room) });
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' });

    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    if (action === 'create') {
      let roomCode = code();
      for (let i = 0; i < 5 && (await getRoom(roomCode)); i += 1) roomCode = code();
      const player = { id: body.playerId, name: cleanName(body.name), score: 0, host: true };
      const room = await saveRoom({
        code: roomCode,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'lobby',
        categories: body.categories?.length ? body.categories : DEFAULT_CATEGORIES,
        players: [player],
        rounds: []
      });
      return json(200, { room: publicRoom(room) });
    }

    const roomCode = body.code?.toUpperCase();
    const room = await getRoom(roomCode, 30);
    if (!room) return json(404, { error: 'Sala no encontrada o vencida.' });

    if (action === 'join') {
      const player = { id: body.playerId, name: cleanName(body.name), score: 0, host: room.players.length === 0 };
      const existing = room.players.find((p) => p.id === player.id);
      if (existing) existing.name = player.name;
      else room.players.push(player);
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    if (!requirePlayer(room, body.playerId)) return json(403, { error: 'Debes unirte a la sala primero.' });

    if (action === 'start') {
      const round = currentRound(room);
      if (round?.status === 'playing' || round?.status === 'audit') return json(400, { error: 'Cierra o finaliza la ronda actual primero.' });
      room.status = 'playing';
      room.rounds.push(buildRound(room, body.letter));
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    if (action === 'draft' || action === 'submit') {
      const round = currentRound(room);
      if (!round || round.status !== 'playing') return json(400, { error: 'No hay una ronda activa.' });
      const answers = sanitizeAnswers(body.answers, room.categories);
      round.drafts = round.drafts || {};
      round.drafts[body.playerId] = { ...answers, submittedAt: Date.now() };
      if (action === 'submit') round.submissions[body.playerId] = { ...answers, submittedAt: Date.now() };
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    if (action === 'stop') {
      const round = currentRound(room);
      if (!round || round.status !== 'playing') return json(400, { error: 'No hay una ronda activa.' });
      if (body.answers) {
        round.drafts = round.drafts || {};
        round.drafts[body.playerId] = { ...sanitizeAnswers(body.answers, room.categories), submittedAt: Date.now() };
      }
      round.status = 'audit';
      round.stoppedAt = Date.now();
      round.stoppedBy = body.playerId;
      round.submissions = freezeSubmissions(room, round);
      round.audit = initialAudit(room.players, round.submissions, room.categories, round.letter);
      round.scores = null;
      room.status = 'audit';
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    if (action === 'audit') {
      const round = currentRound(room);
      if (!round || round.status !== 'audit') return json(400, { error: 'No hay una ronda en auditoría.' });
      if (!isHost(room, body.playerId)) return json(403, { error: 'Solo el anfitrión puede auditar respuestas.' });
      const targetPlayerId = String(body.targetPlayerId || '');
      const category = String(body.category || '');
      if (!room.players.some((p) => p.id === targetPlayerId) || !room.categories.includes(category)) {
        return json(400, { error: 'Respuesta a auditar inválida.' });
      }
      round.audit = round.audit || initialAudit(room.players, round.submissions, room.categories, round.letter);
      round.audit[targetPlayerId] = round.audit[targetPlayerId] || {};
      round.audit[targetPlayerId][category] = Boolean(body.valid);
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    if (action === 'finalize') {
      const round = currentRound(room);
      if (!round || round.status !== 'audit') return json(400, { error: 'No hay una ronda en auditoría.' });
      if (!isHost(room, body.playerId)) return json(403, { error: 'Solo el anfitrión puede finalizar la auditoría.' });
      round.scores = calculateScores(room.players, round.submissions, room.categories, round.audit);
      if (!round.finalized) {
        for (const player of room.players) player.score = (player.score || 0) + (round.scores.playerTotals[player.id] || 0);
        round.finalized = true;
      }
      round.status = 'results';
      room.status = 'results';
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    if (action === 'reset') {
      room.status = 'lobby';
      room.rounds = [];
      for (const player of room.players) player.score = 0;
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    return json(400, { error: 'Acción inválida.' });
  } catch (error) {
    return json(500, { error: error.message || 'Error interno.' });
  }
};
