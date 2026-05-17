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

export function calculateScores(players, submissions, categories = DEFAULT_CATEGORIES) {
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
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    byCategory[category] = {};
    for (const player of players) {
      const raw = submissions?.[player.id]?.[category] ?? '';
      const normalized = normalizeAnswer(raw);
      const duplicate = normalized ? counts.get(normalized) > 1 : false;
      const points = !normalized ? 0 : duplicate ? 50 : 100;
      const entry = { answer: raw, normalized, duplicate, points };
      byCategory[category][player.id] = entry;
      byPlayer[player.id][category] = entry;
      playerTotals[player.id] += points;
    }
  }

  return { byCategory, byPlayer, playerTotals };
}
