import Phaser from 'phaser';
import { AI, ENEMY_UNITS, ENEMY_UNLOCK, TIME, type EnemyType } from '../data/balance';
import { islandConditions, MISSIONS, type MissionKind, type WeatherKind } from '../data/conditions';
import { TILE } from '../data/config';
import { saveSettings, settings } from '../data/settings';
import { CLASS_NAMES } from '../data/units';
import type { House } from '../entities/House';
import type { Squad, SquadDef } from '../entities/Squad';
import type { Point } from '../entities/Unit';
import { generateIsland, type IslandData } from '../mapgen/IslandGenerator';
import { mulberry32 } from '../mapgen/rng';
import { abilityCooldown, canTargetAbility, canUseAbility, useAbility } from '../systems/Abilities';
import { Autopilot } from '../systems/Autopilot';
import { BattleWorld } from '../systems/BattleWorld';
import { CameraController } from '../systems/CameraController';
import { DebugOverlay } from '../systems/DebugOverlay';
import { Fog } from '../systems/Fog';
import { IslandDecorRenderer } from '../systems/IslandDecorRenderer';
import { SelectionController } from '../systems/SelectionController';
import { sfx } from '../systems/Sound';
import { TerrainRenderer } from '../systems/TerrainRenderer';
import { planWaves, WaveManager } from '../systems/WaveManager';
import type { BattleHudScene } from './BattleHudScene';

export interface BattleSceneData {
  seed?: number;
  squads?: SquadDef[];
  /** сложность острова (0 — первый) */
  difficulty?: number;
  isFinal?: boolean;
  /** монеты игрока (для отображения) */
  coins?: number;
  /** сцена, куда вернуться с результатом (без неё — следующий случайный остров) */
  returnTo?: string;
  /** отладка: автопилот вместо игрока и множитель скорости симуляции */
  autopilot?: boolean;
  simSpeed?: number;
  weather?: WeatherKind;
  mission?: MissionKind;
}

export interface BattleResult {
  won: boolean;
  seed: number;
  housesSaved: number;
  housesTotal: number;
  coinsEarned: number;
  usedSquadIds: number[];
  lostSquadIds: number[];
  mission?: MissionKind;
  missionCoins?: number;
  missionFailed?: boolean;
  /** отряды отступили с острова */
  retreated?: boolean;
  /** подробности для экрана итогов */
  houses?: { value: number; saved: boolean; kind?: 'house' | 'barracks' }[];
  squads?: { name: string; avatar: number; cls: SquadDef['cls']; hpFrac: number; lost: boolean }[];
}

/** Конец боя: победа — замедление и облёт острова, поражение — тишина и затемнение; секунды реального времени. */
const END = { victorySlow: 0.3, orbitSec: 3.2, defeatFadeSec: 1.6, resultsDelaySec: 3.4 };

/** В скольких первых боях кампании показывать подсказки управления. */
const HINT_BATTLES = 3;

const DEFAULT_SQUADS: SquadDef[] = [
  { id: 1, name: 'Бьорн', cls: 'infantry', level: 1, avatar: 1, item: 'shield', ability: 1 },
  { id: 2, name: 'Аса', cls: 'archer', level: 1, avatar: 5, item: null, ability: 1 },
  { id: 3, name: 'Ульф', cls: 'pike', level: 1, avatar: 9, item: 'horn', ability: 1 },
  { id: 4, name: 'Хельга', cls: 'militia', level: 0, avatar: 13, item: null, ability: 0 },
];

function seedFromUrl(): number | undefined {
  const s = new URLSearchParams(window.location.search).get('seed');
  return s !== null && s !== '' && Number.isFinite(Number(s)) ? Number(s) >>> 0 : undefined;
}

/** Бой на острове. */
export class BattleScene extends Phaser.Scene {
  island!: IslandData;
  world!: BattleWorld;
  waves!: WaveManager;
  selection!: SelectionController;
  weather: WeatherKind = 'clear';
  mission: MissionKind = 'defense';
  keyHouse: House | null = null;
  paused = false;
  fast = false;
  coins = 0;
  cameraCtl!: CameraController;
  private debug!: DebugOverlay;
  private hud!: BattleHudScene;
  private slowFactor = 1;
  /** конец боя: замедление времени до этого множителя (победа) */
  private endSlow = 1;
  ended = false;
  private input0!: BattleSceneData;
  private autopilot: Autopilot | null = null;
  /** итог боя (для отладки баланса) */
  result: BattleResult | null = null;

  constructor() {
    super('Battle');
  }

  create(data: BattleSceneData): void {
    this.input0 = data;
    const seed = data.seed ?? seedFromUrl() ?? (Math.random() * 1e9) >>> 0;
    this.island = generateIsland(seed);
    const conditions = islandConditions(seed, data.difficulty ?? 0, data.isFinal ?? false);
    this.weather = data.weather ?? conditions.weather;
    this.mission = data.mission ?? conditions.mission;
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      const weather = params.get('weather'), mission = params.get('mission');
      if (weather === 'clear' || weather === 'rain' || weather === 'wind' || weather === 'mist') this.weather = weather;
      if (mission === 'defense' || mission === 'keyHouse' || mission === 'extraWave') this.mission = mission;
    }
    this.slowFactor = 1;
    this.endSlow = 1;
    this.fast = false;
    this.paused = false;
    this.ended = false;
    this.coins = data.coins ?? 0;
    sfx.startAmbience(data.isFinal || (data.difficulty ?? 0) >= ENEMY_UNLOCK.troll ? 'tense' : 'calm', true);

    const rng = mulberry32(seed ^ 0x5bd1e995);
    const terrain = new TerrainRenderer(this, this.island.grid, rng);
    terrain.render();
    const decor = new IslandDecorRenderer(this, this.island, rng);
    decor.render();
    const fog = new Fog(this, this.island.grid, rng);
    this.cameraCtl = new CameraController(this, this.island);
    this.debug = new DebugOverlay(this, this.island);

    this.world = new BattleWorld(this, this.island, decor.houseSprites, this.weather);
    this.keyHouse = null;
    if (this.mission === 'keyHouse') {
      const index = Math.floor(mulberry32(seed ^ 0x6a09e667)() * this.world.houses.length);
      this.keyHouse = this.world.houses[index];
      this.keyHouse.setKeyHouse();
    }
    const squads = data.squads ?? DEFAULT_SQUADS;
    const spawns = this.squadSpawnPoints(squads.length);
    squads.forEach((def, i) => this.world.spawnSquad(def, i, spawns[i]));

    const plans = planWaves(data.difficulty ?? 0, data.isFinal ?? false, this.island.landings, mulberry32(seed ^ 0x2545f491), this.mission === 'extraWave');
    this.waves = new WaveManager(this, this.world, plans, mulberry32(seed ^ 0x9e3779b9));
    this.autopilot = data.autopilot ? new Autopilot(this.world) : null;
    this.result = null;

    this.scene.launch('BattleHud', { battle: this });
    this.hud = this.scene.get('BattleHud') as BattleHudScene;
    this.selection = new SelectionController(
      this, this.world, (p) => this.hud.scene.isActive() && this.hud.isOverUi(p),
      (sq, at) => useAbility(this.world, sq, at),
      (sq, at) => canTargetAbility(sq, at),
    );

    const kb = this.input.keyboard!;
    // в паузе Пробел и Esc обрабатывает меню паузы (интерфейс боя)
    kb.on('keydown-SPACE', () => { if (!this.paused && !this.ended) this.togglePause(); });
    this.events.on('escapeIdle', () => { if (!this.paused && !this.ended) this.togglePause(); });
    kb.on('keydown-F', () => this.toggleFast());
    kb.on('keydown-Q', () => { if (this.world.selected) this.useAbility(this.world.selected); });
    kb.on('keydown-G', () => this.debug.toggle());
    // выйти в меню можно только из быстрого боя (в кампании бой нужно довести до конца)
    kb.on('keydown-M', () => { if (this.registry.get('pendingNode') == null) this.scene.start('Menu'); });
    kb.on('keydown-H', () => {
      if (this.scene.isActive('DebugHud')) this.scene.stop('DebugHud');
      else this.scene.launch('DebugHud');
    });
    if (import.meta.env.DEV) {
      kb.on('keydown-E', () => this.debugSpawnEnemies());
      kb.on('keydown-N', () => this.restartFresh());
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.clearTimeout(this.endTimer);
      sfx.setMuffle(0);
      sfx.stopAmbience();
      this.anims.globalTimeScale = 1;
      this.tweens.timeScale = 1;
      this.time.timeScale = 1;
      this.world.destroy();
      this.waves.destroy();
      fog.destroy();
      this.scene.stop('BattleHud');
      this.scene.stop('DebugHud');
    });

    if (!data.returnTo) window.history.replaceState(null, '', `?seed=${seed}`);
    // В кампании подсказки постепенно исчезают, в быстром бою помогают заново освоить управление.
    this.hintsActive = settings.hints && !data.autopilot && (!this.inCampaign || settings.hintBattles < HINT_BATTLES);
    if (this.hintsActive && this.inCampaign) {
      settings.hintBattles++;
      saveSettings();
    }
  }

  /** показывать ли в этом бою подсказки управления */
  hintsActive = false;

  /** Насколько сейчас замедлено время выбором отряда: 0 — обычная скорость, 1 — полное замедление. */
  get slowAmount(): number {
    const lo = Math.min(settings.slowMo, 0.99);
    return Phaser.Math.Clamp((1 - this.slowFactor) / (1 - lo), 0, 1);
  }

  /** Отладка баланса: прогнать бой без отрисовки до конца (или до лимита игрового времени). */
  simulate(maxTime: number): void {
    while (!this.result && this.world.time < maxTime) {
      this.autopilot?.update(0.05);
      this.waves.update(0.05);
      this.world.update(0.05);
      this.checkEnd();
    }
  }

  /** Опасность острова (0 — первый). */
  get difficulty(): number {
    return this.input0.difficulty ?? 0;
  }

  /** Бой в кампании? (тогда вместо «в меню» — отступление) */
  get inCampaign(): boolean {
    return this.registry.get('pendingNode') != null;
  }

  /** Отступить: остров потерян, выжившие отряды уходят (потерянные остаются потерянными). */
  forfeit(): void {
    if (this.ended) return;
    this.ended = true;
    this.paused = false;
    this.result = { ...this.makeResult(false), retreated: true, coinsEarned: 0 };
    const cam = this.cameras.main;
    cam.fadeOut(400, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(this.input0.returnTo ?? 'Menu', { result: this.result }));
  }

  private makeResult(won: boolean): BattleResult {
    const houses = this.world.houses;
    const saved = houses.filter((h) => h.alive);
    const missionCoins = won ? MISSIONS[this.mission].bonus : 0;
    return {
      won,
      seed: this.island.seed,
      housesSaved: saved.length,
      housesTotal: houses.length,
      coinsEarned: won ? saved.reduce((s, h) => s + h.value, 0) + missionCoins : 0,
      usedSquadIds: this.world.squads.map((s) => s.def.id),
      lostSquadIds: this.world.squads.filter((s) => s.lost).map((s) => s.def.id),
      mission: this.mission,
      missionCoins,
      missionFailed: this.mission === 'keyHouse' && !!this.keyHouse && !this.keyHouse.alive,
      houses: houses.map((h) => ({ value: h.value, saved: h.alive, kind: h.spot.kind })),
      squads: this.world.squads.map((s) => ({ name: s.def.name, avatar: s.def.avatar, cls: s.def.cls, hpFrac: s.lost ? 0 : s.hpFraction, lost: s.lost })),
    };
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  toggleFast(): void {
    this.fast = !this.fast;
  }

  useAbility(sq: Squad): void {
    if (!canUseAbility(sq)) return;
    if (sq.cls === 'infantry' || sq.cls === 'archer') {
      this.selection.startAbility(sq);
      return;
    }
    if (useAbility(this.world, sq)) this.selection.select(null);
  }

  abilityCooldownMax(sq: Squad): number {
    return abilityCooldown(sq) || 1;
  }

  /** Награда за остров сейчас: уцелевшие дома и бонус за особое задание. */
  get reward(): number {
    return this.world.houses.filter((h) => h.alive).reduce((s, h) => s + h.value, 0) + MISSIONS[this.mission].bonus;
  }

  update(_t: number, dtMs: number): void {
    const real = Math.min(dtMs, 50) / 1000;
    const target = this.ended ? this.endSlow : this.world.selected ? settings.slowMo : 1;
    this.slowFactor += (target - this.slowFactor) * Math.min(1, real / TIME.slowMoBlend);
    if (Math.abs(this.slowFactor - target) < 0.01) this.slowFactor = target;
    const scale = this.paused ? 0 : this.slowFactor * (this.fast ? TIME.fast : 1);
    this.anims.globalTimeScale = Math.max(scale, 0.0001);
    this.tweens.timeScale = Math.max(scale, 0.0001);
    this.time.timeScale = scale;
    // большие шаги (ускорение) режем на куски, чтобы физика не «прыгала»
    let left = real * scale * (this.input0.simSpeed ?? 1);
    while (left > 0) {
      const step = Math.min(0.05, left);
      left -= step;
      this.autopilot?.update(step);
      this.waves.update(step);
      this.world.update(step);
      this.checkEnd();
      if (this.ended) break;
    }
    if (!this.paused) this.cameraCtl.update(real);
    // выбран отряд — звук глуше и тише (после поражения — тишина)
    if (!this.ended) sfx.setMuffle(this.paused ? 0.6 : this.slowAmount * 0.8);
    this.checkEnd();
    if (this.scene.isActive('DebugHud')) this.updateDebugText(scale);
  }

  private checkEnd(): void {
    if (this.ended) return;
    // тупик: все волны высажены, но давно никто никого не бьёт — враги отступают
    if (this.waves.allSpawned && this.world.time - this.world.lastActivity > AI.stalemateTime
      && this.world.units.some((u) => u.team === 'enemy' && u.alive)) {
      // выжившие бегут к своим лодкам и уплывают (те, кому плыть не на чем, исчезают)
      this.waves.retreatAll();
      this.world.retreatEnemies();
      this.world.lastActivity = this.world.time;
      this.hud.showBanner('Враги отступили');
    }
    const allLost = this.world.squads.every((s) => s.lost);
    const missionLost = this.mission === 'keyHouse' && !!this.keyHouse && !this.keyHouse.alive;
    const won = this.waves.finished && !allLost && !missionLost;
    if (!won && !allLost && !missionLost) return;
    this.ended = true;
    const result = this.makeResult(won);
    this.result = result;
    if (this.input0.autopilot) return; // прогон баланса: без заставок
    this.world.selected = null;
    this.hud.onBattleEnd(won, missionLost);
    const cam = this.cameras.main;
    const go = () => {
      if (!this.scene.isActive()) return;
      if (this.input0.returnTo) this.scene.start(this.input0.returnTo, { result });
      else this.restartFresh();
    };
    if (won) {
      // победа: время замедляется, камера медленно облетает остров, затем итоги
      this.endSlow = END.victorySlow;
      const g = this.island.grid;
      this.cameraCtl.orbit(g.w * TILE / 2, g.h * TILE / 2, g.w * TILE * 0.18, g.h * TILE * 0.14, END.orbitSec + 1);
      this.endTimer = window.setTimeout(() => {
        if (!this.scene.isActive()) return;
        cam.fadeOut(400, 0, 0, 0);
        cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
      }, END.resultsDelaySec * 1000);
    } else {
      // поражение: тишина и затемнение
      sfx.setMuffle(1);
      cam.fadeOut(END.defeatFadeSec * 1000, 0, 0, 0);
      this.endTimer = window.setTimeout(go, END.resultsDelaySec * 1000);
    }
  }

  /** таймер перехода к итогам (реальное время — не зависит от замедления) */
  private endTimer = 0;

  private restartFresh(): void {
    this.scene.restart({ ...this.input0, seed: (Math.random() * 1e9) >>> 0 });
  }

  /** Точки старта отрядов: подальше от мест высадки, поближе к центру острова. */
  private squadSpawnPoints(count: number): Point[] {
    const g = this.island.grid;
    let cx = 0, cy = 0, n = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.isWalkable(x, y)) { cx += x; cy += y; n++; }
    cx /= n; cy /= n;
    const cands: { x: number; y: number; score: number }[] = [];
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (!g.isWalkable(x, y) || g.stairAt(x, y) || g.getLevel(x, y) < 1) continue;
        const land = Math.min(...this.island.landings.map((l) => Math.hypot(l.x - x, l.y - y)));
        cands.push({ x, y, score: land - 0.6 * Math.hypot(x - cx, y - cy) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const out: Point[] = [];
    for (const c of cands) {
      if (out.length >= count) break;
      if (out.some((p) => Math.hypot(p.x / TILE - 0.5 - c.x, p.y / TILE - 0.5 - c.y) < 3)) continue;
      out.push({ x: (c.x + 0.5) * TILE, y: (c.y + 0.5) * TILE });
    }
    while (out.length < count) out.push(out[0] ?? { x: cx * TILE, y: cy * TILE });
    return out;
  }

  /** Отладка: E — высадить группу врагов у курсора. */
  private debugSpawnEnemies(): void {
    const p = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const at = this.world.nearestWalkable(p.x, p.y);
    if (!at) return;
    const group: EnemyType[] = ['goblin_torch', 'goblin_torch', 'goblin_torch', 'harpoon_fish', 'harpoon_fish', 'troll', 'goblin_tnt'];
    const slots = this.world.formationSlots(at, group.length);
    group.forEach((type, i) => this.world.spawnUnit('enemy', type, { ...ENEMY_UNITS[type] }, slots[i].x, slots[i].y));
  }

  private updateDebugText(scale: number): void {
    const w = this.world;
    const lines = [
      `сид ${this.island.seed}  время ×${scale.toFixed(2)}  волна ${this.waves.waveIndex + 1}/${this.waves.totalWaves}  лодок ${this.waves.boats.length}`,
      ...w.squads.map((s) => `${s.index + 1}. ${s.def.name} — ${CLASS_NAMES[s.cls]}: ${s.lost ? 'ПОТЕРЯН' : `${s.aliveUnits.length} бойцов`}`),
      `врагов ${w.units.filter((u) => u.team === 'enemy' && u.alive).length}  юнитов всего ${w.units.length}  снарядов ${w.projectiles.length}`,
      'G — сетка  E — враги у курсора  N — новый остров  H — скрыть',
    ];
    const text = lines.join('\n');
    if (this.registry.get('hudText') !== text) this.registry.set('hudText', text);
  }
}
