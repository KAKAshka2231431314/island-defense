// Только для разработки: проверка щитов врагов (скелеты) на ровной арене, без отрисовки.
// В консоли браузера: await shieldTest() → сколько стрел и ударов отбито щитом в разных положениях.
import Phaser from 'phaser';
import { ENEMY_UNITS, type PlayerClass } from '../data/balance';
import { TILE } from '../data/config';
import type { SquadDef } from '../entities/Squad';
import type { Unit } from '../entities/Unit';
import { BattleWorld } from './BattleWorld';
import { ARENA_H, ARENA_W, ArenaScene, arena } from './matchups';

const STEP = 0.05;

interface Case {
  name: string;
  /** ожидание словами (для отчёта) */
  expect: string;
  run: (w: BattleWorld, cx: number, cy: number) => { foes: Unit[]; seconds: number };
}

const def = (id: number, cls: PlayerClass): SquadDef => ({ id, name: `S${id}`, cls, level: 2, avatar: 1, item: null, ability: 0 });

/** Отряд, который не бьёт и не гибнет (мишень или приманка). */
function dummy(w: BattleWorld, id: number, cls: PlayerClass, x: number, y: number): void {
  const sq = w.spawnSquad(def(id, cls), id - 1, { x, y });
  sq.hp = sq.maxHp = 1e6;
  for (const u of sq.units) u.damageMult = 0;
}

function skulls(w: BattleWorld, n: number, x: number, y: number): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < n; i++) out.push(w.spawnUnit('enemy', 'skull', { ...ENEMY_UNITS.skull }, x + (i % 2) * 30, y + (i - n / 2) * 30));
  for (const u of out) { u.hp = u.maxHp = 1e6; u.damageMult = 0; } // не гибнут и не бьют — считаем только щит
  return out;
}

/** Скелет идёт мимо (не к стрелкам): ИИ выключен, цель — точка, щит поднят к стрелку, как это делает ИИ. */
function walker(u: Unit, goal: { x: number; y: number }, faceTo: { x: number; y: number } | null): void {
  u.thinkLeft = 1e9;
  u.speedMult = 0.3; // идут медленно — дольше под обстрелом
  u.target = null;
  u.navGoal = goal;
  if (faceTo) { u.lookAt(faceTo); u.guarding = true; }
}

const CASES: Case[] = [
  {
    name: 'стрелы спереди: скелеты идут на лучников',
    expect: 'почти всё отбито',
    run: (w, cx, cy) => {
      w.spawnSquad(def(1, 'archer'), 0, { x: cx - 3 * TILE, y: cy });
      return { foes: skulls(w, 3, cx + 4 * TILE, cy), seconds: 10 };
    },
  },
  {
    name: 'стрелы сбоку: скелеты идут мимо, щит к лучникам',
    expect: 'почти всё отбито (щит повёрнут к стрелку)',
    run: (w, cx, cy) => {
      w.spawnSquad(def(1, 'archer'), 0, { x: cx, y: cy + 3 * TILE });
      const f = skulls(w, 3, cx - 4 * TILE, cy - TILE);
      for (const u of f) walker(u, { x: cx + 8 * TILE, y: u.y }, { x: cx, y: cy + 3 * TILE });
      return { foes: f, seconds: 14 };
    },
  },
  {
    name: 'стрелы сбоку: скелеты идут мимо, к лучникам не повернулись',
    expect: 'почти всё попадает (щит смотрит по ходу)',
    run: (w, cx, cy) => {
      w.spawnSquad(def(1, 'archer'), 0, { x: cx, y: cy + 3 * TILE });
      const f = skulls(w, 3, cx - 4 * TILE, cy - TILE);
      for (const u of f) walker(u, { x: cx + 8 * TILE, y: u.y }, null);
      return { foes: f, seconds: 14 };
    },
  },
  {
    name: 'ИИ: скелеты идут на пехоту, лучники сбоку',
    expect: 'почти всё отбито (щит к стрелкам, пока не дошли)',
    run: (w, cx, cy) => {
      dummy(w, 2, 'infantry', cx + 5 * TILE, cy - TILE);
      w.spawnSquad(def(1, 'archer'), 0, { x: cx, y: cy + 3.5 * TILE });
      const f = skulls(w, 3, cx - 4 * TILE, cy - TILE);
      for (const u of f) u.speedMult = 0.3;
      return { foes: f, seconds: 14 };
    },
  },
  {
    name: 'стрелы в спину: скелеты уходят от лучников',
    expect: 'почти всё попадает',
    run: (w, cx, cy) => {
      w.spawnSquad(def(1, 'archer'), 0, { x: cx - 4 * TILE, y: cy });
      const f = skulls(w, 3, cx - TILE, cy);
      for (const u of f) walker(u, { x: cx + 9 * TILE, y: u.y }, null);
      return { foes: f, seconds: 14 };
    },
  },
  {
    name: 'стрелы с фланга: скелеты бьются с пехотой',
    expect: 'больше половины попадает',
    run: (w, cx, cy) => {
      dummy(w, 2, 'infantry', cx, cy - TILE);
      w.spawnSquad(def(1, 'archer'), 0, { x: cx, y: cy + 3.5 * TILE });
      return { foes: skulls(w, 3, cx + 3 * TILE, cy - TILE), seconds: 8 };
    },
  },
  {
    name: 'рукопашная спереди: пехота рубит скелетов',
    expect: 'часть ударов отбита (шанс AI.meleeBlockChance, пока скелет сам не бьёт)',
    run: (w, cx, cy) => {
      w.spawnSquad(def(1, 'infantry'), 0, { x: cx - 2 * TILE, y: cy });
      const f = skulls(w, 3, cx + 2 * TILE, cy);
      for (const u of f) u.damageMult = 1; // скелеты отвечают — щит опускается на время своего удара
      return { foes: f, seconds: 8 };
    },
  },
  {
    name: 'рукопашная: громила по скелету',
    expect: 'ничего не отбито (удар тяжёлого щит не держит)',
    run: (w, cx, cy) => {
      // проверка правила напрямую: «громила» — свой же враг со стороны игрока не бывает; бьём пикой с устойчивостью тролля
      w.spawnSquad(def(1, 'pike'), 0, { x: cx - 2 * TILE, y: cy });
      for (const u of w.squads[0].units) (u.stats as { knockResist: number }).knockResist = 0.85;
      return { foes: skulls(w, 3, cx + 2 * TILE, cy), seconds: 8 };
    },
  },
];

export interface ShieldResult { case: string; expect: string; arrows: string; melee: string }

export async function shieldTest(game: Phaser.Game, runs = 10): Promise<ShieldResult[]> {
  if (!game.scene.getScene('Arena')) game.scene.add('Arena', ArenaScene, true);
  const scene = game.scene.getScene('Arena');
  scene.scene.setVisible(false);
  const out: ShieldResult[] = [];
  for (const c of CASES) {
    let hits = 0, blocks = 0, mOn = 0, mBlk = 0;
    for (let r = 0; r < runs; r++) {
      const w = new BattleWorld(scene, arena(), new Map());
      const cx = Math.floor(ARENA_W / 2) * TILE, cy = Math.floor(ARENA_H / 2) * TILE;
      const { seconds } = c.run(w, cx, cy);
      while (w.time < seconds) w.update(STEP);
      hits += w.stats.arrowHits; blocks += w.stats.arrowBlocked;
      mOn += w.stats.meleeOnShield; mBlk += w.stats.meleeBlocked;
      w.destroy();
      scene.children.removeAll(true);
    }
    await new Promise((res) => setTimeout(res, 0));
    out.push({
      case: c.name, expect: c.expect,
      arrows: hits + blocks ? `отбито ${Math.round((blocks / (hits + blocks)) * 100)} % из ${Math.round((hits + blocks) / runs)} за бой` : '—',
      melee: mOn ? `отбито ${Math.round((mBlk / mOn) * 100)} % из ${Math.round(mOn / runs)} за бой` : '—',
    });
  }
  return out;
}
