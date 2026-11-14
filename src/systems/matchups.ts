// Только для разработки: матчапы «1 отряд против группы врагов» на ровной площадке, без отрисовки.
// В консоли браузера: await runMatchups() → таблица побед, оставшегося здоровья и блоков стрел.
import Phaser from 'phaser';
import { ENEMY_UNITS, type EnemyType, type PlayerClass } from '../data/balance';
import { TILE } from '../data/config';
import type { SquadDef } from '../entities/Squad';
import type { Unit } from '../entities/Unit';
import type { IslandData } from '../mapgen/IslandGenerator';
import { IslandGrid } from '../mapgen/IslandGrid';
import { packSquares } from '../mapgen/zones';
import { BattleWorld } from './BattleWorld';

/** Арена: ровная суша 24×16 клеток в кольце воды (вода далеко — в неё не сбрасывают случайно). */
export const ARENA_W = 28, ARENA_H = 20;
const WATER = 2;
/** Шаг симуляции и предел боя, с. */
const STEP = 0.05, LIMIT = 90;

export interface Matchup {
  name: string;
  cls: PlayerClass;
  level?: number;
  enemies: [EnemyType, number][];
  /** расстояние до врагов при старте, клеток */
  dist: number;
  /** лучники стреляют с фланга: враги заняты отрядом-приманкой (пехота) и подходят сбоку от лучников */
  flank?: boolean;
  expect: string;
}

export const MATCHUPS: Matchup[] = [
  { name: 'пехота vs 8 рядовых', cls: 'infantry', enemies: [['goblin_torch', 8]], dist: 5, expect: 'победа' },
  { name: 'пехота vs 4 стрелка', cls: 'infantry', enemies: [['harpoon_fish', 4]], dist: 6, expect: 'потери ≤20 %' },
  { name: 'лучники vs 6 рядовых вплотную', cls: 'archer', enemies: [['goblin_torch', 6]], dist: 1.5, expect: 'поражение' },
  { name: 'лучники vs 6 рядовых с 9 клеток', cls: 'archer', enemies: [['goblin_torch', 6]], dist: 9, expect: 'победа' },
  { name: 'копейщики vs 8 рядовых', cls: 'pike', enemies: [['goblin_torch', 8]], dist: 5, expect: 'победа' },
  { name: 'копейщики vs громила', cls: 'pike', enemies: [['troll', 1]], dist: 5, expect: '≥80 % побед' },
  { name: 'пехота vs громила', cls: 'infantry', enemies: [['troll', 1]], dist: 5, expect: '≤50 % побед' },
  { name: 'лучники vs 4 щитоносца спереди', cls: 'archer', enemies: [['skull', 4]], dist: 7, expect: 'блок ≥70 %' },
  { name: 'лучники vs 4 щитоносца с фланга', cls: 'archer', enemies: [['skull', 4]], dist: 7, flank: true, expect: 'блок мало' },
  { name: 'ополчение vs 3 рядовых', cls: 'militia', enemies: [['goblin_torch', 3]], dist: 5, expect: 'победа' },
  { name: 'ополчение vs 6 рядовых', cls: 'militia', enemies: [['goblin_torch', 6]], dist: 5, expect: 'поражение' },
  { name: 'ополчение vs 2 стрелка', cls: 'militia', enemies: [['harpoon_fish', 2]], dist: 6, expect: 'поражение' },
];

/** Пустая сцена-хозяин для мира без отрисовки. */
export class ArenaScene extends Phaser.Scene {
  constructor() {
    super('Arena');
  }
}

export function arena(): IslandData {
  const rows: string[] = [];
  for (let y = 0; y < ARENA_H; y++) {
    let r = '';
    for (let x = 0; x < ARENA_W; x++) r += x < WATER || y < WATER || x >= ARENA_W - WATER || y >= ARENA_H - WATER ? '~' : '.';
    rows.push(r);
  }
  const grid = IslandGrid.fromAscii(rows);
  return { seed: 0, attempt: 0, grid, landings: [], houses: [], decor: [], landCells: 0, squares: packSquares(grid) };
}

export interface MatchupResult {
  name: string;
  expect: string;
  wins: number;
  runs: number;
  hp: number;
  lostSoldiers: number;
  blocked: string;
  /** попаданий стрел не в упор за бой (в среднем) */
  hits: number;
  time: number;
}

/** Один бой: true/false — победа отряда, плюс остаток здоровья и потери бойцов. */
function runOnce(scene: Phaser.Scene, m: Matchup): { won: boolean; hp: number; lost: number; t: number; hits: number; blocks: number } {
  const island = arena();
  const w = new BattleWorld(scene, island, new Map());
  const cx = Math.floor(ARENA_W / 2) * TILE, cy = Math.floor(ARENA_H / 2) * TILE;
  const def: SquadDef = { id: 1, name: 'A', cls: m.cls, level: m.level ?? 2, avatar: 1, item: null, ability: 0 };
  const at = m.flank ? { x: cx, y: cy + 3 * TILE } : { x: cx - 2 * TILE, y: cy };
  const sq = w.spawnSquad(def, 0, at);

  if (m.flank) {
    // приманка — пехота впереди, враги идут на неё; лучники сбоку
    // приманка не бьёт и не гибнет — только держит врагов
    const decoy = w.spawnSquad({ ...def, id: 2, cls: 'infantry', name: 'D' }, 1, { x: cx, y: cy - 2 * TILE });
    decoy.hp = decoy.maxHp = 1e6;
    for (const u of decoy.units) u.damageMult = 0;
  }
  const foes: Unit[] = [];
  const ex = m.flank ? cx + m.dist * TILE : at.x + m.dist * TILE, ey = m.flank ? cy - 2 * TILE : at.y;
  let k = 0;
  for (const [type, n] of m.enemies) {
    for (let i = 0; i < n; i++, k++) {
      const ox = (Math.floor(k / 3)) * 30 + (Math.random() - 0.5) * 12, oy = ((k % 3) - 1) * 34 + (Math.random() - 0.5) * 12;
      const u = w.spawnUnit('enemy', type, { ...ENEMY_UNITS[type] }, ex + ox, ey + oy);
      u.lookAt(m.flank ? { x: cx, y: cy - 2 * TILE } : at);
      foes.push(u);
    }
  }
  const h0 = w.stats.arrowHits, b0 = w.stats.arrowBlocked;
  while (w.time < LIMIT) {
    w.update(STEP);
    if (sq.lost || foes.every((u) => !u.alive)) break;
  }
  const won = !sq.lost && foes.every((u) => !u.alive);
  const res = {
    won, hp: sq.lost ? 0 : sq.hp / sq.maxHp, lost: sq.units.filter((u) => !u.alive).length / sq.units.length,
    t: w.time, hits: w.stats.arrowHits - h0, blocks: w.stats.arrowBlocked - b0,
  };
  w.destroy();
  scene.children.removeAll(true);
  return res;
}

export async function runMatchups(game: Phaser.Game, runs = 50, only?: string): Promise<MatchupResult[]> {
  if (!game.scene.getScene('Arena')) game.scene.add('Arena', ArenaScene, true);
  const scene = game.scene.getScene('Arena');
  scene.scene.setVisible(false);
  const out: MatchupResult[] = [];
  for (const m of MATCHUPS) {
    if (only && !m.name.includes(only)) continue;
    let wins = 0, hp = 0, lost = 0, t = 0, hits = 0, blocks = 0;
    for (let i = 0; i < runs; i++) {
      const r = runOnce(scene, m);
      if (r.won) wins++;
      hp += r.hp; lost += r.lost; t += r.t; hits += r.hits; blocks += r.blocks;
      if (i % 10 === 9) await new Promise((res) => setTimeout(res, 0));
    }
    out.push({
      name: m.name, expect: m.expect, wins: Math.round((wins / runs) * 100), runs,
      hp: Math.round((hp / runs) * 100), lostSoldiers: Math.round((lost / runs) * 100),
      hits: Math.round(hits / runs),
      blocked: hits + blocks ? `${Math.round((blocks / (hits + blocks)) * 100)} %` : '—',
      time: Math.round(t / runs),
    });
  }
  return out;
}
