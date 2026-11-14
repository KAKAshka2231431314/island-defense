import { ABILITY, ITEMS } from '../data/balance';
import { Projectile } from '../entities/Projectile';
import type { Squad } from '../entities/Squad';
import type { Point, Unit } from '../entities/Unit';
import type { BattleWorld } from './BattleWorld';

export function abilityCooldown(sq: Squad): number {
  const base = ABILITY.cooldown[sq.cls];
  return base * (1 - ABILITY.cooldownPerLevel * Math.max(0, sq.def.ability - 1));
}

function power(sq: Squad): number {
  return 1 + ABILITY.powerPerLevel * Math.max(0, sq.def.ability - 1);
}

export function canUseAbility(sq: Squad): boolean {
  return !sq.lost && sq.def.ability > 0 && sq.cls !== 'militia' && sq.abilityCooldown <= 0 && !sq.inHouse && !sq.entering;
}

export function canTargetAbility(sq: Squad, at: Point): boolean {
  if (!canUseAbility(sq)) return false;
  if (sq.cls === 'infantry') {
    const lead = sq.commander.alive ? sq.commander : sq.aliveUnits[0];
    return !!lead && Math.hypot(at.x - lead.x, at.y - lead.y) <= ABILITY.charge.searchRadius;
  }
  if (sq.cls === 'archer') {
    const center = sq.center();
    const range = (sq.aliveUnits[0]?.stats.range ?? 0) * 1.15;
    return Math.hypot(at.x - center.x, at.y - center.y) <= range;
  }
  return false;
}

/** Применить способность отряда. Без target автопилот выбирает цель сам. */
export function useAbility(world: BattleWorld, sq: Squad, target?: Point): boolean {
  if (!canUseAbility(sq) || (target && !canTargetAbility(sq, target))) return false;
  const units = sq.aliveUnits.filter((u) => !u.hidden);
  if (!units.length) return false;
  let ok = false;
  if (sq.cls === 'infantry') ok = charge(world, sq, units, target);
  else if (sq.cls === 'archer') ok = volley(world, sq, units, target);
  else if (sq.cls === 'pike') ok = sweep(world, sq, units);
  if (ok) sq.abilityCooldown = abilityCooldown(sq);
  return ok;
}

/** Щитовой рывок: весь отряд бежит в выбранную точку и сбивает всех на пути. */
function charge(world: BattleWorld, sq: Squad, units: Unit[], target?: Point): boolean {
  const c = ABILITY.charge;
  const lead = sq.commander.alive ? sq.commander : units[0];
  const spot = target ?? world.clusterNear(lead, c.searchRadius);
  if (!spot) return false;
  for (const u of units) {
    const d = Math.hypot(spot.x - u.x, spot.y - u.y);
    if (d < 4) continue;
    u.cancelAttack();
    u.lookAt(spot);
    // бежит чуть дальше точки — насквозь через группу
    const left = Math.min(c.duration, d / c.speed + 0.15);
    u.dash = { left, vx: u.aimX * c.speed, vy: u.aimY * c.speed, hit: new Set(), power: power(sq) };
  }
  return true;
}

/** Залп: все лучники отряда несколько раз стреляют в выбранную область. */
function volley(world: BattleWorld, sq: Squad, units: Unit[], target?: Point): boolean {
  const v = ABILITY.volley;
  let spot = target;
  if (!spot) {
    const range = units[0].stats.range * 1.15;
    const center = sq.center();
    const foes = world.units.filter((e) => e.team === 'enemy' && e.targetable && Math.hypot(e.x - center.x, e.y - center.y) <= range);
    if (!foes.length) return false;
    // автопилот выбирает врага, вокруг которого больше всего других врагов
    let best = foes[0], bestN = -1;
    for (const f of foes) {
      const n = foes.filter((o) => Math.hypot(o.x - f.x, o.y - f.y) < 80).length;
      if (n > bestN) { bestN = n; best = f; }
    }
    spot = best;
  }
  const dmg = v.damage * power(sq);
  const tx0 = spot.x, ty0 = spot.y;
  // метка области: стрелы падают через v.delay
  const g = world.scene.add.graphics().setDepth(ty0 + 20000);
  g.lineStyle(2, 0xfff2a0, 0.9).strokeEllipse(tx0, ty0, v.spread * 2.4, v.spread * 1.4);
  g.fillStyle(0xfff2a0, 0.12).fillEllipse(tx0, ty0, v.spread * 2.4, v.spread * 1.4);
  world.scene.tweens.add({ targets: g, alpha: 0, delay: v.delay * 1000, duration: 500, onComplete: () => g.destroy() });
  for (const u of units) {
    u.cancelAttack();
    u.lookAt(spot);
    u.view.playState('attack', false);
    for (let i = 0; i < v.arrowsPerArcher; i++) {
      world.schedule(v.delay + i * v.interval + Math.random() * 0.1, () => {
        if (!u.alive) return;
        const tx = tx0 + (Math.random() - 0.5) * v.spread * 2, ty = ty0 + (Math.random() - 0.5) * v.spread * 2;
        world.projectiles.push(new Projectile(world.scene, 'arrow', 'player', u, null, tx, ty, dmg, v.hitRadius));
      });
    }
    u.cooldownLeft = Math.max(u.cooldownLeft, v.delay + v.arrowsPerArcher * v.interval);
  }
  return true;
}

/** Круговой удар: копейщики бьют вокруг себя и отбрасывают всех врагов рядом. */
function sweep(world: BattleWorld, sq: Squad, units: Unit[]): boolean {
  const s = ABILITY.sweep;
  const p = power(sq);
  for (const u of units) {
    u.cancelAttack();
    u.view.playState('attack', false);
    world.fx.dust(u.x, u.y);
    for (const e of [...world.units]) {
      if (e.team !== 'enemy' || !e.targetable || u.dist(e) > s.radius) continue;
      world.damage(e, (s.damage * p) / Math.max(1, units.length / 3), u, s.knockback * p * u.knockMult, u);
    }
  }
  return true;
}

/** Бонусы предмета командира ко всему отряду (применяется при спавне). */
export function applyItem(sq: Squad): void {
  for (const u of sq.units) applyItemToUnit(sq, u);
}

/** Бонус предмета одному юниту (в т.ч. солдату, восстановленному в доме). */
export function applyItemToUnit(sq: Squad, u: Unit): void {
  const item = sq.def.item;
  if (item === 'horn') u.speedMult *= ITEMS.horn.speedMult;
  if (item === 'bomb') u.knockMult *= ITEMS.bomb.knockMult;
}
