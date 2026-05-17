export const DEFAULT_CATEGORIES = [
  'nombre',
  'apellido',
  'ciudad',
  'animal',
  'comida',
  'cosa',
  'color'
];

export function normalizeAnswer(value = '') {
  return String(value)
    .trim()
    .toLocaleLowerCase('es-CO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isAuditedValid(audit, playerId, category, normalized) {
  if (!normalized) return false;
  const value = audit?.[playerId]?.[category];
  return value === undefined ? true : Boolean(value);
}

export function calculateScores(players, submissions, categories = DEFAULT_CATEGORIES, audit = null) {
  const byCategory = {};
  const byPlayer = {};
  const playerTotals = {};

  for (const player of players) {
    byPlayer[player.id] = {};
    playerTotals[player.id] = 0;
  }

  for (const category of categories) {
    const counts = new Map();
    for (const player of players) {
      const answer = submissions?.[player.id]?.[category] ?? '';
      const normalized = normalizeAnswer(answer);
      if (!isAuditedValid(audit, player.id, category, normalized)) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    byCategory[category] = {};
    for (const player of players) {
      const raw = submissions?.[player.id]?.[category] ?? '';
      const normalized = normalizeAnswer(raw);
      const valid = isAuditedValid(audit, player.id, category, normalized);
      const duplicate = valid ? counts.get(normalized) > 1 : false;
      const points = !normalized ? 0 : !valid ? 0 : duplicate ? 50 : 100;
      const reason = !normalized ? 'vacía' : !valid ? 'inválida' : duplicate ? 'repetida' : 'única';
      const entry = { answer: raw, normalized, valid, duplicate, points, reason };
      byCategory[category][player.id] = entry;
      byPlayer[player.id][category] = entry;
      playerTotals[player.id] += points;
    }
  }

  return { byCategory, byPlayer, playerTotals };
}
