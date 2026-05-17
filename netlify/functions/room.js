import { connectLambda, getStore } from '@netlify/blobs';
import { calculateScores, DEFAULT_CATEGORIES } from '../../src/scoring.js';

function roomStore() {
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

async function getRoom(roomCode) {
  if (!roomCode) return null;
  const store = roomStore();
  const room = await store.get(roomCode.toUpperCase(), { type: 'json' });
  if (!room) return null;
  if (Date.now() - Number(room.updatedAt || 0) > ROOM_TTL_MS) {
    await store.delete(roomCode.toUpperCase());
    return null;
  }
  return room;
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
    submissions: {},
    scores: null
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
      const room = await getRoom(roomCode);
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
    const room = await getRoom(roomCode);
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
      if (round?.status === 'playing') return json(400, { error: 'Ya hay una ronda en juego.' });
      room.status = 'playing';
      room.rounds.push(buildRound(room, body.letter));
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    if (action === 'submit') {
      const round = currentRound(room);
      if (!round || round.status !== 'playing') return json(400, { error: 'No hay una ronda activa.' });
      const answers = {};
      for (const category of room.categories) answers[category] = String(body.answers?.[category] || '').slice(0, 80);
      round.submissions[body.playerId] = { ...answers, submittedAt: Date.now() };
      await saveRoom(room);
      return json(200, { room: publicRoom(room) });
    }

    if (action === 'stop') {
      const round = currentRound(room);
      if (!round || round.status !== 'playing') return json(400, { error: 'No hay una ronda activa.' });
      if (body.answers) {
        const answers = {};
        for (const category of room.categories) answers[category] = String(body.answers?.[category] || '').slice(0, 80);
        round.submissions[body.playerId] = { ...answers, submittedAt: Date.now() };
      }
      round.status = 'stopped';
      round.stoppedAt = Date.now();
      round.stoppedBy = body.playerId;
      round.scores = calculateScores(room.players, round.submissions, room.categories);
      for (const player of room.players) player.score = (player.score || 0) + (round.scores.playerTotals[player.id] || 0);
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
