// Только для разработки: быстрые прогоны боёв автопилотом для настройки баланса.
// В консоли браузера: await simBatch([11, 22, 33]) → сводка побед/потерь по сложности.
import Phaser from 'phaser';
import type { PlayerClass } from '../data/balance';
import type { SquadDef } from '../entities/Squad';
import type { BattleScene } from '../scenes/BattleScene';
import { runMatchups } from './matchups';
import { shieldTest } from './shieldTest';

const S = (id: number, cls: PlayerClass, level: number, ability = 0): SquadDef =>
  ({ id, name: `S${id}`, cls, level, avatar: id, item: null, ability });

/** Типичный состав отрядов игрока к острову данной сложности. */
export function rosterFor(d: number): SquadDef[] {
  if (d <= 0) return [S(1, 'militia', 0), S(2, 'militia', 0)];
  if (d === 1) return [S(1, 'pike', 1), S(2, 'militia', 0)];
  if (d === 2) return [S(1, 'pike', 1), S(2, 'infantry', 1), S(3, 'militia', 0)];
  if (d === 3) return [S(1, 'pike', 2), S(2, 'infantry', 1), S(3, 'archer', 1, 1)];
  if (d === 4) return [S(1, 'pike', 2, 1), S(2, 'infantry', 2, 1), S(3, 'archer', 1, 1)];
  if (d === 5) return [S(1, 'pike', 2, 1), S(2, 'infantry', 2, 1), S(3, 'archer', 2, 1)];
  return [S(1, 'pike', 3, 2), S(2, 'infantry', 3, 2), S(3, 'archer', 2, 1)];
}

export interface SimResult {
  d: number;
  seed: number;
  won: boolean;
  timeout: boolean;
  houses: string;
  lost: number;
  t: number;
}

/** Один бой автопилотом, без отрисовки, игровым временем шагами по 0.05 с. */
export function simBattle(game: Phaser.Game, d: number, seed: number, squads = rosterFor(d), isFinal = d >= 6): SimResult {
  for (const k of ['Results', 'Menu', 'MenuUi', 'Campaign', 'Upgrade', 'Battle', 'BattleHud']) if (game.scene.isActive(k)) game.scene.stop(k);
  game.scene.start('Battle', { seed, squads, difficulty: d, isFinal, returnTo: 'Results', autopilot: true });
  let sc = game.scene.getScene('Battle') as BattleScene;
  for (let i = 0; i < 20 && !(sc.scene.isActive() && sc.island?.seed === seed); i++) {
    game.step(performance.now(), 16);
    sc = game.scene.getScene('Battle') as BattleScene;
  }
  sc.paused = true;
  sc.simulate(900);
  const r = sc.result;
  return {
    d, seed, won: !!r?.won, timeout: !r,
    houses: r ? `${r.housesSaved}/${r.housesTotal}` : '-',
    lost: r ? r.lostSquadIds.length : -1,
    t: Math.round(sc.world.time),
  };
}

export async function simBatch(game: Phaser.Game, seeds: number[], difficulties = [0, 1, 2, 3, 4, 5, 6]): Promise<Record<number, string>> {
  const out: Record<number, { w: number; n: number; lost: number; to: number }> = {};
  for (const seed of seeds) {
    for (const d of difficulties) {
      const r = simBattle(game, d, seed + d * 13);
      const o = (out[d] ??= { w: 0, n: 0, lost: 0, to: 0 });
      o.n++;
      if (r.won) o.w++;
      if (r.timeout) o.to++;
      o.lost += Math.max(0, r.lost);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  const text: Record<number, string> = {};
  for (const [d, o] of Object.entries(out)) text[Number(d)] = `побед ${o.w}/${o.n}, потеряно отрядов ${o.lost}${o.to ? `, зависаний ${o.to}` : ''}`;
  return text;
}

export function installDevSim(game: Phaser.Game): void {
  const w = window as unknown as Record<string, unknown>;
  w.simBattle = (d: number, seed: number) => simBattle(game, d, seed);
  w.simBatch = (seeds: number[], ds?: number[]) => simBatch(game, seeds, ds);
  w.runMatchups = (runs?: number, only?: string) => runMatchups(game, runs, only);
  w.shieldTest = (runs?: number) => shieldTest(game, runs);
}
