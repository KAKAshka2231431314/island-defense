// Автопилот (только для отладки баланса): простая «рука игрока» — защищает дома, лечит отряды, жмёт способности.
import { TILE } from '../data/config';
import type { House } from '../entities/House';
import type { Squad } from '../entities/Squad';
import type { BattleWorld } from './BattleWorld';
import { canUseAbility, useAbility } from './Abilities';

const INTERVAL = 1.2;

export class Autopilot {
  private left = 0;

  constructor(private readonly world: BattleWorld) {}

  update(dt: number): void {
    this.left -= dt;
    if (this.left > 0) return;
    this.left = INTERVAL;
    const w = this.world;
    const enemies = w.units.filter((u) => u.team === 'enemy' && u.alive && !u.hidden);
    const squads = w.squads.filter((s) => !s.lost);
    const taken = new Set<House>();

    for (const sq of squads) {
      if (sq.inHouse || sq.entering) continue;
      const c = sq.center();
      const engaged = enemies.some((e) => Math.hypot(e.x - c.x, e.y - c.y) < 1.6 * TILE);
      // способность, если рядом враги
      if (canUseAbility(sq) && enemies.some((e) => Math.hypot(e.x - c.x, e.y - c.y) < 4 * TILE)) useAbility(w, sq);
      // потрёпанный отряд без врагов рядом — лечиться
      const near = enemies.filter((e) => Math.hypot(e.x - c.x, e.y - c.y) < 4 * TILE).length;
      if (sq.hpFraction < 0.45 && near === 0) {
        const house = this.nearestSafeHouse(sq);
        if (house && w.orderEnterHouse(sq, house)) continue;
      }
      // обстреливают, а рукопашной рядом нет — бросить отряд ближнего боя на стрелка
      if (sq.cls !== 'archer') {
        const melee = enemies.some((e) => !e.stats.projectile && Math.hypot(e.x - c.x, e.y - c.y) < 2.5 * TILE);
        const shooter = enemies.filter((e) => e.stats.projectile && Math.hypot(e.x - c.x, e.y - c.y) < 6 * TILE)
          .sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0];
        if (!melee && shooter && !engaged) {
          w.orderSquad(sq, shooter.x, shooter.y);
          continue;
        }
      }
      // дом под угрозой: враги ближе всего к нему
      if (engaged) continue; // уже дерутся — не дёргать
      const threat = this.mostThreatened(enemies, taken);
      if (threat) {
        taken.add(threat);
        // дом уже бьют у двери — идти на поджигателя, иначе встать у двери
        const burner = enemies.filter((e) => e.aiTag === 'burn' && e.targetHouse === threat)
          .sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0];
        if (burner) {
          if (Math.hypot(burner.x - sq.anchor.x, burner.y - sq.anchor.y) > TILE * 1.5) w.orderSquad(sq, burner.x, burner.y);
        } else if (Math.hypot(threat.door.x - sq.anchor.x, threat.door.y - sq.anchor.y) > TILE * 1.5) {
          w.orderSquad(sq, threat.door.x, threat.door.y + TILE * 0.6);
        }
        continue;
      }
      // иначе — к ближайшему врагу
      const foe = enemies.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
      if (foe && Math.hypot(foe.x - sq.anchor.x, foe.y - sq.anchor.y) > TILE * 2) w.orderSquad(sq, foe.x, foe.y);
    }
  }

  private nearestSafeHouse(sq: Squad): House | null {
    const c = sq.center();
    const enemies = this.world.units.filter((u) => u.team === 'enemy' && u.alive);
    return this.world.houses
      .filter((h) => h.alive && !h.occupant && !enemies.some((e) => Math.hypot(e.x - h.door.x, e.y - h.door.y) < 5 * TILE))
      .sort((a, b) => Math.hypot(a.door.x - c.x, a.door.y - c.y) - Math.hypot(b.door.x - c.x, b.door.y - c.y))[0] ?? null;
  }

  private mostThreatened(enemies: { x: number; y: number }[], taken: Set<House>): House | null {
    let best: House | null = null, bestD = 7 * TILE;
    for (const h of this.world.houses) {
      if (!h.alive || taken.has(h)) continue;
      for (const e of enemies) {
        const d = Math.hypot(e.x - h.door.x, e.y - h.door.y);
        if (d < bestD) { bestD = d; best = h; }
      }
    }
    return best;
  }
}
