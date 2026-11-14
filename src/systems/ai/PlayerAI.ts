import { AI, MOVE, SQUAD } from '../../data/balance';
import { TILE } from '../../data/config';
import type { Point, Unit } from '../../entities/Unit';
import type { BattleWorld } from '../BattleWorld';

/**
 * Решения солдата игрока (вызывается несколько раз в секунду).
 * По приказу — идёт на своё место в строю, не отвлекаясь. На месте — сам вступает в бой
 * с врагами в радиусе, но не отходит от точки стояния дальше «поводка» отряда.
 */
export function thinkPlayer(u: Unit, w: BattleWorld): void {
  const sq = u.squad;
  if (!sq || sq.lost || u.hidden) return;
  const slot = sq.slots.get(u);
  if (!slot) return;
  const dSlot = u.dist(slot);

  if (u.ordered) {
    if (sq.cls === 'pike') {
      if (dSlot <= MOVE.arriveDist) {
        u.ordered = false;
        u.navGoal = null;
      } else {
        u.navGoal = { ...slot };
        u.target = null;
        u.guarding = false;
        return;
      }
    }
    // враг вплотную преградил путь — боец ближнего боя отвечает, а не толкается (копейщики на марше не бьют: копья подняты)
    const near = !u.stats.projectile && !sq.entering && sq.cls !== 'pike' ? w.findTarget(u, u, Infinity, u.stats.range + 10) : null;
    const blocker = near && w.canMelee(u, near) ? near : null;
    if (dSlot <= MOVE.arriveDist * 2 || (!u.navGoal && dSlot < TILE) || blocker) {
      u.ordered = false;
    } else {
      if (!u.navGoal) u.navGoal = { ...slot };
      u.target = null;
      u.guarding = false;
      return;
    }
  }
  if (sq.entering) return; // идут в дом
  if (!u.canAct) return;

  const s = u.stats;
  const leash = u.isCommander ? sq.leash * SQUAD.commanderLeashMult : sq.leash;
  // стрелки бьют общую цель отряда (залп) по приоритету; бойцы ближнего боя держат свою цель
  let t = s.projectile ? archerFocus(u, w, slot, leash) : u.target;
  if (t && !s.projectile && (!t.targetable || Math.hypot(t.x - slot.x, t.y - slot.y) > leash + s.range + 24 || u.dist(t) > s.aggro * AI.playerChaseMult)) t = null;
  if (!t && !s.projectile) t = w.findTarget(u, slot, leash + s.range * 1.3, s.aggro);
  // копейщики достают копьём врага на подъёме ниже — ищут его на всю длину копья
  if (!t && sq.cls === 'pike') {
    const far = w.findTarget(u, slot, leash + s.range * (1.3 + AI.pikeBraceReach + AI.pikeStairReach), s.aggro);
    if (far && w.holdsClimb(u, far)) t = far;
  }
  // самооборона: враг вплотную — бьём, даже если он за пределами поводка
  if (!t && !s.projectile) t = w.findTarget(u, u, Infinity, s.range + 10);
  // ближний бой — только на своём уровне (или на ступенях): за врагом под обрывом не бегаем, держим клетку
  if (t && !s.projectile && !w.canMelee(u, t) && !w.holdsClimb(u, t)) t = null;
  u.target = t;

  const braces = sq.cls === 'pike' || sq.cls === 'infantry';
  // щиты против стрелков: лучники, гарпунщики, летящие снаряды — если достать некого (стрелки далеко,
  // за пределами поводка или на другом уровне), пехота встаёт на своё место и закрывается щитами лицом к стрелку;
  // стрелка рядом, на своём уровне, — идёт рубить
  if (s.blocksFront && !t) {
    const shot = w.rangedThreat(u);
    if (shot) {
      u.lookAt(shot);
      u.navGoal = dSlot > MOVE.arriveDist ? { ...slot } : null;
      u.guarding = !u.navGoal;
      return;
    }
  }
  // лучники: враг вплотную — отходят на клетку внутри своей зоны (если есть куда), иначе слабо отбиваются
  if (s.projectile && u.kiteLeft <= 0) {
    const close = w.nearestFoe(u, AI.archerBackoffDist);
    if (close && w.canMelee(u, close)) {
      u.kiteLeft = AI.archerBackoffSec;
      const away = backoffPoint(u, w, close, sq.zone ? { x: sq.zone.cx, y: sq.zone.cy } : slot);
      if (away) {
        u.navGoal = away;
        u.guarding = false;
        return;
      }
    }
  }
  if (t) {
    u.lookAt(t);
    const d = u.dist(t);
    if (d <= w.rangeTo(u, t)) {
      u.navGoal = null;
      // копейщики бьют из стойки и возвращаются в неё; остальные опускают щит на время удара
      u.guarding = sq.cls === 'pike';
      if (u.cooldownLeft <= 0) u.startAttack(t);
      return;
    }
    u.guarding = false;
    if (sq.cls === 'pike') {
      // копейщики не бегут навстречу: держат строй с опущенными копьями и ждут, пока враг подойдёт
      u.guarding = true;
      u.navGoal = dSlot > MOVE.arriveDist ? { ...slot } : null;
      return;
    }
    if (s.projectile) {
      // стрелки не бегут за целью — держат позицию
      u.navGoal = dSlot > MOVE.arriveDist ? { ...slot } : null;
      return;
    }
    // подойти на дистанцию удара, но не дальше поводка
    const nx = t.x - ((t.x - u.x) / d) * s.range * 0.7;
    const ny = t.y - ((t.y - u.y) / d) * s.range * 0.7;
    if (Math.hypot(nx - slot.x, ny - slot.y) <= leash + 4) u.navGoal = { x: nx, y: ny };
    else u.navGoal = dSlot > MOVE.arriveDist ? { ...slot } : null;
    return;
  }

  u.navGoal = dSlot > MOVE.arriveDist ? { ...slot } : null;
  // подготовка: враг приближается — отряд разворачивается к нему, копейщики опускают копья, пехота поднимает щиты
  const near = w.nearestFoe(u, s.aggro * AI.braceRadiusMult);
  const shooter = s.blocksFront ? w.nearestFoeShooter(u, 8 * TILE) : null;
  const threat = near ?? shooter;
  if (threat) u.lookAt(threat);
  u.guarding = !!threat && braces && !u.navGoal;
}

/**
 * Цели залпа лучников отряда: группа из AI.volleyTargets ближайших врагов высшего приоритета (враги в лодках
 * и высаживающиеся → стрелки → остальные); лучники делят их между собой (стрела убивает с одного попадания —
 * весь отряд в одного бить незачем). Группа держится AI.retargetSec, потом пересматривается.
 */
function archerFocus(u: Unit, w: BattleWorld, slot: Point, leash: number): Unit | null {
  const sq = u.squad!;
  const s = u.stats;
  const ok = (e: Unit | null): e is Unit => !!e && e.team !== u.team && e.targetable
    && Math.hypot(e.x - slot.x, e.y - slot.y) <= leash + s.range * 1.3 && u.dist(e) <= s.aggro * 1.3;
  const mine = (list: Unit[]) => list[sq.units.indexOf(u) % list.length];
  const alive = sq.focus.filter(ok);
  if (alive.length && w.time - sq.focusAt < AI.retargetSec) return mine(alive);
  const prio = (e: Unit) => (e.boat || e.aiTag === 'landing' ? 0 : e.stats.projectile ? 1 : 2);
  const cands = w.units.filter(ok).sort((a, b) => prio(a) - prio(b) || u.dist(a) - u.dist(b));
  sq.focus = cands.filter((e) => prio(e) === prio(cands[0])).slice(0, AI.volleyTargets);
  sq.focusAt = w.time;
  return sq.focus.length ? mine(sq.focus) : null;
}

/** Куда лучнику отойти от врага: клетка в сторону от него, не дальше клетки от центра своей зоны, на том же уровне. */
function backoffPoint(u: Unit, w: BattleWorld, from: Unit, zone: Point): Point | null {
  const ax = u.x - from.x, ay = u.y - from.y, al = Math.hypot(ax, ay) || 1;
  const g = w.grid;
  const ux = Math.floor(u.x / TILE), uy = Math.floor(u.y / TILE);
  for (const turn of [0, 0.6, -0.6, 1.1, -1.1]) {
    const c = Math.cos(turn), sn = Math.sin(turn);
    const dx = (ax * c - ay * sn) / al, dy = (ax * sn + ay * c) / al;
    const p = { x: u.x + dx * TILE * 0.8, y: u.y + dy * TILE * 0.8 };
    if (Math.abs(p.x - zone.x) > TILE * 1.1 || Math.abs(p.y - zone.y) > TILE * 1.1) continue;
    const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE);
    if ((px !== ux || py !== uy) && !g.canStep(ux, uy, px, py)) continue;
    if (!g.isWalkable(px, py)) continue;
    return p;
  }
  return null;
}
