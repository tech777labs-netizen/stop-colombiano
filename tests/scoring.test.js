import { describe, expect, it } from 'vitest';
import { calculateScores, DEFAULT_CATEGORIES, normalizeAnswer } from '../src/scoring.js';

describe('reglas de puntaje de Stop', () => {
  it('normaliza respuestas ignorando tildes, mayúsculas y espacios', () => {
    expect(normalizeAnswer('  Bogotá  ')).toBe('bogota');
    expect(normalizeAnswer('Ñandú')).toBe('nandu');
  });

  it('da 100 a respuestas únicas, 50 a repetidas y 0 a vacías', () => {
    const players = [
      { id: 'p1', name: 'Ana' },
      { id: 'p2', name: 'Luis' },
      { id: 'p3', name: 'Marta' }
    ];
    const submissions = {
      p1: { animal: 'Ardilla', ciudad: 'Armenia', comida: '' },
      p2: { animal: 'Ardilla', ciudad: 'Arauca', comida: 'Arepa' },
      p3: { animal: 'Alce', ciudad: 'Armenia', comida: 'Ajiaco' }
    };

    const result = calculateScores(players, submissions, ['animal', 'ciudad', 'comida']);

    expect(result.playerTotals).toEqual({ p1: 100, p2: 250, p3: 250 });
    expect(result.byPlayer.p1.animal).toMatchObject({ points: 50, duplicate: true });
    expect(result.byPlayer.p3.animal).toMatchObject({ points: 100, duplicate: false });
    expect(result.byPlayer.p1.comida).toMatchObject({ points: 0 });
  });

  it('incluye categorías colombianas por defecto', () => {
    expect(DEFAULT_CATEGORIES).toContain('nombre');
    expect(DEFAULT_CATEGORIES).toContain('ciudad');
    expect(DEFAULT_CATEGORIES).toContain('comida');
  });
});
