import { AI } from '../../data/balance';
import { TILE } from '../../data/config';
import type { House } from '../../entities/House';
import type { Point, Unit } from '../../entities/Unit';
import type { BattleWorld } from '../BattleWorld';

/**
 * Роли врагов (как в Bad North):
 * raider — рядовые, щитоносцы, подрывники: жгут дома, отряд бьют, если он рядом или мешает;
 * heavy — громила и чемпион: охотятся на отряды;
 * shooter — стрелки и шаман: бьют уязвимые отряды (лучники, копейщики, ополчение) и держат дистанцию;
 * barrel — бочка-камикадзе: в самое плотное скопление отряда или к дому.
 */
type Role = 'raider' | 'heavy' | 'shooter' | 'barrel';

function roleOf(u: Unit): Role {
  switch (u.type) {
    case 'troll': case 'minotaur': return 'heavy';
    case 'harpoon_fish': case 'shaman': return 'shooter';
    case 'goblin_barrel': return 'barrel';
    default: return 'raider';
  }
}

/** Отряды без щитов — любимая цель стрелков. */
function vulnerable(t: Unit): boolean {
  return !t.stats.blocksFront;
}

/** Решение врага (вызывается несколько раз в секунду). */
export function thinkEnemy(u: Unit, w: BattleWorld): void {
  // в лодке: стрелок бьёт с палубы по цели в радиусе, остальные ждут высадки
  if (u.boat) {
    if (u.stats.projectile && u.cooldownLeft <= 0 && !u.attacking && u.stunLeft <= 0) {
      const t = w.findTarget(u, u, Infinity, u.stats.range);
      if (t) {
        u.target = t;
        u.lookAt(t);
        u.startAttack(t);
      }
    }
    return;
  }
  if (!u.canAct) return;
  // высадка: сначала сойти с лодки на берег
  if (u.aiTag === 'landing') {
    if (u.navGoal) return;
    u.aiTag = '';
  }
  // стоим в воде/непроходимой клетке (сбили при высадке) — сначала выйти на сушу
  const cell = w.cellIdx(u.x, u.y);
  if (cell < 0 || !w.grid.isWalkable(cell % w.grid.w, Math.floor(cell / w.grid.w))) {
    if (!u.navGoal) u.navGoal = w.nearestWalkable(u.x, u.y);
    return;
  }
  const s = u.stats;
  const role = roleOf(u);
  const houses = w.houses.filter((h) => h.alive);
  const boat = u.homeBoat;

  // отступление: бегом к причалу своей лодки и на борт (у дома — сначала дожечь его)
  if (boat?.retreating && boat.state === 'standby' && !houses.some((h) => u.dist(h.center) < AI.retreatHouseDist)) {
    const l = boat.landing;
    const dock = { x: (l.x + 0.5) * TILE, y: (l.y + 0.5) * TILE };
    u.target = null;
    u.targetHouse = null;
    u.guarding = false;
    if (u.dist(dock) < TILE * 0.8) {
      w.fx.splash(u.x + l.dx * 30, u.y + l.dy * 30);
      boat.board(u);
      return;
    }
    u.navGoal = dock;
    u.lookAt(dock);
    return;
  }

  // сбор у берега: пока лодка высаживает остальных и ещё AI.gatherSec — ждём; отвечаем только тем, кто вплотную
  const gathering = !!boat && (boat.unloadedAt < 0 || w.time < boat.unloadedAt + AI.gatherSec);

  // щитоносец держит щит к ближайшей угрозе: бойцу вплотную, иначе к стрелку
  if (s.blocksFront && !u.attacking) {
    // под обстрелом щит поднят (закрывает переднюю половину) и в рукопашной — опускается только на свой удар
    const near = w.nearestFoe(u, s.range * 1.6);
    const shot = w.rangedThreat(u);
    if (near) u.lookAt(near);
    else if (shot) u.lookAt(shot);
    u.guarding = !!shot;
  }

  // стрелки, подрывник, шаман держат дистанцию от бойцов ближнего боя (ищут клетку повыше)
  if ((role === 'shooter' || u.type === 'goblin_tnt') && u.kiteLeft <= 0) {
    const melee = nearestMeleeFoe(u, w, AI.kiteDist);
    if (melee) {
      const away = kitePoint(u, w, melee);
      u.kiteLeft = AI.kiteSec;
      if (away) {
        u.navGoal = away;
        u.target = null;
        return;
      }
    }
  }

  const t = pickTarget(u, w, role, houses.length > 0, gathering);
  if (gathering && (!t || u.dist(t) > s.range + 16)) {
    u.navGoal = null;
    return;
  }

  if (t) {
    u.target = t;
    u.targetHouse = null;
    u.aiTag = '';
    const d = u.dist(t);
    // щитоносец под обстрелом держит щит к стрелку, пока до цели не дошёл (повернётся к ней на ударе)
    if (!u.guarding || d <= w.rangeTo(u, t)) u.lookAt(t);
    if (role === 'barrel') {
      // бочка — в самую плотную группу
      const c = w.clusterNear(u, s.aggro) ?? { x: t.x, y: t.y, n: 1 };
      if (Math.hypot(c.x - u.x, c.y - u.y) <= s.range + 12 || d <= s.range) u.startAttack(null, u.x, u.y);
      else u.navGoal = { x: c.x, y: c.y };
      return;
    }
    // минотавр: рывок по прямой, сбивая всех на пути
    if (u.type === 'minotaur' && u.dashCooldown <= 0 && d >= AI.minoDash.minDist && d <= AI.minoDash.maxDist) {
      const m = AI.minoDash;
      u.dash = { left: m.duration, vx: u.aimX * m.speed, vy: u.aimY * m.speed, hit: new Set(), power: 1, damage: m.damage, knockback: m.knockback };
      u.dashCooldown = m.cooldown;
      w.fx.dust(u.x, u.y);
      return;
    }
    if (d <= w.rangeTo(u, t)) {
      u.navGoal = null;
      if (u.cooldownLeft <= 0) {
        // подрывник бросает в скопление, а не в одного
        const c = u.type === 'goblin_tnt' ? w.clusterNear(u, w.rangeTo(u, t)) : null;
        if (c && c.n > 1) u.startAttack(t, c.x, c.y);
        else u.startAttack(t);
      }
      return;
    }
    u.navGoal = { x: t.x, y: t.y };
    return;
  }
  u.target = null;
  if (gathering) return;

  const h = chooseHouse(u, w, houses);
  u.targetHouse = h;
  if (!h) {
    u.navGoal = null;
    u.aiTag = '';
    return;
  }
  // Здание можно повредить только у двери и с того же уровня земли.
  if (u.dist(h.door) < AI.burnDoorDist && w.levelAt(u) === w.levelAt(h.door)) {
    u.aiTag = 'burn';
    u.navGoal = null;
    if (role === 'barrel') {
      u.startAttack(null, u.x, u.y);
    } else {
      u.lookAt(h.center);
      if (u.cooldownLeft <= 0) u.startAttack(null, h.center.x, h.center.y - 20);
    }
    return;
  }
  u.aiTag = '';
  if (!u.navGoal) u.navGoal = { x: h.door.x + (Math.random() - 0.5) * 50, y: h.door.y + Math.random() * 16 };
}

/**
 * Цель по роли. Держит прежнюю, пока она достижима (с гистерезисом: бросает дальше, чем берёт),
 * новую ищет не чаще AI.retargetSec.
 */
function pickTarget(u: Unit, w: BattleWorld, role: Role, housesLeft: boolean, gathering: boolean): Unit | null {
  const s = u.stats;
  const cur = u.target && u.target.targetable && !u.target.boat && u.dist(u.target) <= s.aggro * AI.enemyChaseMult ? u.target : null;
  if (cur && (u.retargetLeft > 0 || role !== 'shooter')) return cur;
  if (gathering) return w.findTarget(u, u, Infinity, s.range + 16);
  u.retargetLeft = AI.retargetSec;
  if (role === 'heavy') {
    // громила бьёт только отряд рядом; иначе идёт к замку
    return w.findTarget(u, u, Infinity, s.aggro);
  }
  if (role === 'shooter') {
    // уязвимые отряды (без щитов) в радиусе, иначе любой в радиусе, иначе ближайший уязвимый на острове
    const inRange = w.units.filter((e) => e.team !== u.team && e.targetable && !e.boat && u.dist(e) <= s.aggro);
    const soft = inRange.filter(vulnerable).sort((a, b) => u.dist(a) - u.dist(b))[0];
    if (soft) return soft;
    if (inRange.length) return inRange.sort((a, b) => u.dist(a) - u.dist(b))[0];
    return housesLeft ? null : w.nearestReachableFoe(u);
  }
  // рядовые, подрывник, бочка: бьют отряд в радиусе агрессии, иначе — к домам; домов нет — охотятся
  return w.findTarget(u, u, Infinity, s.aggro) ?? (housesLeft ? null : w.nearestReachableFoe(u));
}

/** Цель десанта: сначала замок; без него — ближайший дом, до двери которого есть маршрут. */
function chooseHouse(u: Unit, w: BattleWorld, houses: House[]): House | null {
  const from = w.cellIdx(u.x, u.y);
  if (from < 0) return null;
  const reachable = (h: House) => {
    const to = w.cellIdx(h.door.x, h.door.y);
    return to >= 0 && Number.isFinite(w.flow.distance(from, to));
  };
  const castle = houses.find((h) => h.spot.kind === 'castle' && reachable(h));
  if (castle) return castle;
  let best: House | null = null, bestD = Infinity;
  for (const h of houses) {
    if (!reachable(h)) continue;
    const d = u.dist(h.door);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

/** Ближайший боец ближнего боя (не стрелок) в радиусе, с которым можно схватиться. */
function nearestMeleeFoe(u: Unit, w: BattleWorld, radius: number): Unit | null {
  let best: Unit | null = null, bd = radius;
  for (const e of w.units) {
    if (e.team === u.team || !e.targetable || e.boat || e.stats.projectile) continue;
    const d = u.dist(e);
    if (d < bd && w.canMelee(u, e)) { bd = d; best = e; }
  }
  return best;
}

/** Куда отойти от бойца ближнего боя: проходимая клетка в сторону от него, лучше — выше. */
function kitePoint(u: Unit, w: BattleWorld, from: Unit): Point | null {
  const g = w.grid;
  const ax = u.x - from.x, ay = u.y - from.y, al = Math.hypot(ax, ay) || 1;
  let best: Point | null = null, bestScore = -Infinity;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const away = (dx * ax + dy * ay) / al;
    if (away < 0.2) continue;
    const p = { x: u.x + dx * TILE * 1.6, y: u.y + dy * TILE * 1.6 };
    const cx = Math.floor(p.x / TILE), cy = Math.floor(p.y / TILE);
    if (!g.isWalkable(cx, cy)) continue;
    const ucell = w.cellIdx(u.x, u.y), pcell = w.cellIdx(p.x, p.y);
    if (ucell < 0 || pcell < 0 || !(w.flow.distance(pcell, ucell) < 4)) continue;
    const score = away + g.walkRange(cx, cy)[1] * 0.6;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}
