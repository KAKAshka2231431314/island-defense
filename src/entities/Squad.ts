import { SQUAD, type PlayerClass } from '../data/balance';
import type { Zone } from '../mapgen/zones';
import type { House } from './House';
import type { Point, Unit } from './Unit';

export type ItemId = 'bomb' | 'horn' | 'shield';

/** Постоянные данные отряда (живут в кампании между боями). */
export interface SquadDef {
  id: number;
  name: string;
  cls: PlayerClass;
  /** 0 — ополчение; 1..3 — уровень класса */
  level: number;
  avatar: number;
  item: ItemId | null;
  /** уровень способности (0 — не куплена) */
  ability: number;
}

/** Отряд в бою: командир + солдаты. */
export class Squad {
  readonly units: Unit[] = [];
  commander!: Unit;
  readonly slots = new Map<Unit, Point>();
  anchor: Point = { x: 0, y: 0 };
  /** цели залпа лучников отряда (до AI.volleyTargets ближайших с высшим приоритетом) и когда их выбрали */
  focus: Unit[] = [];
  focusAt = -99;
  lost = false;
  /** общее здоровье отряда (см. BattleWorld.squadDamage) */
  hp = 0;
  maxHp = 1;
  /** доля запаса на одного солдата и на командира */
  soldierHp = 1;
  cmdHp = 1;
  /** перезарядка способности, с */
  abilityCooldown = 0;
  /** время боя (world.time), когда отряд последний раз бил или получал удар — для пульсации карточки */
  lastFight = -999;
  /** зона острова, которую занимает отряд */
  zone: Zone | null = null;
  /** идёт в дом / сидит в доме */
  entering: House | null = null;
  inHouse: House | null = null;

  constructor(readonly def: SquadDef, readonly index: number) {}

  get cls(): PlayerClass {
    return this.def.cls;
  }

  get aliveUnits(): Unit[] {
    return this.units.filter((u) => u.alive);
  }

  get soldiersMax(): number {
    return SQUAD.soldiersByLevel[Math.min(this.def.level, SQUAD.soldiersByLevel.length - 1)];
  }

  /** Доля общего здоровья отряда (для HUD и полоски над командиром). */
  get hpFraction(): number {
    return this.lost ? 0 : Math.max(0, Math.min(1, this.hp / this.maxHp));
  }

  get leash(): number {
    if (this.cls === 'pike') return SQUAD.pikeLeash;
    if (this.cls === 'archer') return SQUAD.archerLeash;
    return SQUAD.leash;
  }

  center(): Point {
    const alive = this.aliveUnits.filter((u) => !u.hidden);
    if (!alive.length) return { ...this.anchor };
    let x = 0, y = 0;
    for (const u of alive) { x += u.x; y += u.y; }
    return { x: x / alive.length, y: y / alive.length };
  }
}
