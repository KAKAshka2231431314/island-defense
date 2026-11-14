import Phaser from 'phaser';
import { ITEMS } from '../data/balance';
import { MISSIONS, WEATHER } from '../data/conditions';
import { DEPTH } from '../data/config';
import { CLASS_NAMES } from '../data/units';
import type { Boat } from '../entities/Boat';
import type { House } from '../entities/House';
import type { Squad } from '../entities/Squad';
import type { Point } from '../entities/Unit';
import type { LandingPoint } from '../mapgen/IslandGenerator';
import { ITEM_NAMES } from '../systems/CampaignState';
import { sfx } from '../systems/Sound';
import { WeatherFX } from '../systems/WeatherFX';
import type { BattleScene } from './BattleScene';
import { PauseMenu } from './PauseMenu';
import { BannerQueue, COLOR, iconFast, iconOverview, iconPause, label, plate, RoundButton, Tooltip, uiScale } from './ui';
import { ABILITY_NAMES } from './UpgradeScene';

/** Размеры интерфейса боя при масштабе ×1, px. */
const L = {
  margin: 12,
  cardW: 112,
  cardH: 90,
  cardGap: 8,
  /** выбранная карточка приподнята */
  cardLift: 6,
  avatar: 50,
  abilitySize: 34,
  barH: 6,
  flagGap: 20,
  flagH: 14,
  houseIcon: 20,
};
/** Поведение и анимации, с / мс. */
const T = {
  /** карточка пульсирует красным столько секунд после последнего удара */
  fightSec: 1.5,
  fightPulseMs: 420,
  /** потерянный отряд: карточка серая, затем сворачивается */
  lostCollapseDelayMs: 2000,
  lostCollapseMs: 400,
  doubleClickMs: 320,
  /** перелёт камеры к отряду по двойному клику, с */
  flySec: 0.6,
  plusMs: 900,
  readyFlashMs: 450,
  houseShakeMs: 60,
  countdownFadeMs: 400,
  /** последняя подсказка («пауза») висит столько секунд */
  hintLastSec: 8,
  hintFadeMs: 400,
  arrowPulseMs: 160,
};
/** Замедление времени: виньетка и приглушение цветов (доли при полном замедлении). */
const SLOW_FX = { vignetteAlpha: 0.55, greyAlpha: 0.16, grey: 0x8a8f94 };
/** Значки классов на карточках (у копейщиков значок рисуется кодом). */
const CLASS_ICON: Record<string, string | null> = { infantry: 'icon_06', archer: 'arrow', pike: null, militia: 'tool_pickaxe' };
const ABILITY_ICON: Record<string, string> = { infantry: 'icon_06', archer: 'arrow', pike: 'icon_05' };

interface Rect { x: number; y: number; w: number; h: number }

interface Card {
  sq: Squad;
  root: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  avatar: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  houseMark: Phaser.GameObjects.Image;
  lostMark: Phaser.GameObjects.Graphics;
  ability: { root: Phaser.GameObjects.Container; shade: Phaser.GameObjects.Graphics; ring: Phaser.GameObjects.Graphics } | null;
  abilityRect: Rect | null;
  rect: Rect;
  x: number;
  baseY: number;
  lostAt: number | null;
  collapsing: boolean;
  collapsed: boolean;
  wasReady: boolean;
  lastClick: number;
}

interface Hint {
  text: string;
  when: () => boolean;
  done: () => boolean;
}

/**
 * Интерфейс боя в духе Bad North: почти ничего на экране — флажки волн сверху, дома и монеты справа,
 * пауза и ускорение слева, карточки отрядов внизу. Остальное появляется по событию и тихо уходит.
 */
export class BattleHudScene extends Phaser.Scene {
  private battle!: BattleScene;
  private k = 1;
  private cards: Card[] = [];
  private flags!: Phaser.GameObjects.Graphics;
  private countdown!: Phaser.GameObjects.Text;
  private countdownShown = false;
  private houseRoot!: Phaser.GameObjects.Container;
  private houseIcons: { house: House; img: Phaser.GameObjects.Image; crack: Phaser.GameObjects.Graphics }[] = [];
  private coinText!: Phaser.GameObjects.Text;
  private pauseBtn!: RoundButton;
  private fastBtn!: RoundButton;
  private overviewBtn!: RoundButton;
  private arrows!: Phaser.GameObjects.Graphics;
  private arrowLabels: Phaser.GameObjects.Text[] = [];
  private banner!: BannerQueue;
  private tooltip!: Tooltip;
  private hintRoot!: Phaser.GameObjects.Container;
  private hintBg!: Phaser.GameObjects.Graphics;
  private hintText!: Phaser.GameObjects.Text;
  private hints: Hint[] = [];
  private hintShown: Hint | null = null;
  private hintSince = 0;
  private slowVignette!: Phaser.GameObjects.Image;
  private slowGrey!: Phaser.GameObjects.Rectangle;
  private vignetteKey = '';
  private pause: PauseMenu | null = null;
  private ended = false;
  private weather!: WeatherFX;
  private conditions!: Phaser.GameObjects.Text;

  constructor() {
    super('BattleHud');
  }

  init(data: { battle: BattleScene }): void {
    this.battle = data.battle;
    this.cards = [];
    this.houseIcons = [];
    this.arrowLabels = [];
    this.pause = null;
    this.hintShown = null;
    this.countdownShown = false;
    this.ended = false;
  }

  create(): void {
    this.k = uiScale(this);
    const k = this.k;
    this.weather = new WeatherFX(this, this.battle.weather, this.battle.island.seed);
    this.buildSlowOverlay();
    this.arrows = this.add.graphics().setDepth(DEPTH.ui);
    this.flags = this.add.graphics();
    const weather = WEATHER[this.battle.weather], mission = MISSIONS[this.battle.mission];
    this.conditions = label(this, 0, 0, `${weather.name} · ${mission.name}${mission.bonus ? ` · +${mission.bonus}` : ''}`, 13 * k, COLOR.light)
      .setOrigin(0.5, 0).setStroke('#0b1a22', 4 * k);
    this.countdown = label(this, 0, 0, '', 14 * k, COLOR.light).setOrigin(0.5, 0).setAlpha(0);
    this.buildHouses();
    this.pauseBtn = new RoundButton(this, 0, 0, k, iconPause, () => this.battle.togglePause());
    this.fastBtn = new RoundButton(this, 0, 0, k, iconFast, () => this.battle.toggleFast());
    this.overviewBtn = new RoundButton(this, 0, 0, k, iconOverview, () => this.battle.cameraCtl.showOverview(0.35));
    for (const sq of this.battle.world.squads) this.cards.push(this.makeCard(sq));
    this.banner = new BannerQueue(this, k, 0, DEPTH.ui + 5);
    this.tooltip = new Tooltip(this, k, DEPTH.ui + 20);
    this.buildHints();
    this.layout();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.keyboard?.on('keydown', this.onKey, this);

    // события боя
    const w = this.battle.world;
    this.battle.events.on('waveStarted', this.onWave, this);
    w.events.on('houseIgnited', this.onHouseIgnited, this);
    w.events.on('houseBurned', this.onHouseBurned, this);
    w.events.on('squadLost', this.onSquadLost, this);
    w.events.on('soldierRestored', this.onSoldierRestored, this);

    // перестройка при изменении окна
    let timer: Phaser.Time.TimerEvent | null = null;
    const onResize = () => {
      timer?.remove();
      timer = this.time.delayedCall(150, () => this.scene.restart({ battle: this.battle }));
    };
    this.scale.on('resize', onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize);
      this.input.keyboard?.off('keydown', this.onKey, this);
      this.battle.events.off('waveStarted', this.onWave, this);
      w.events.off('houseIgnited', this.onHouseIgnited, this);
      w.events.off('houseBurned', this.onHouseBurned, this);
      w.events.off('squadLost', this.onSquadLost, this);
      w.events.off('soldierRestored', this.onSoldierRestored, this);
      this.pause?.destroy();
      this.pause = null;
      this.banner.destroy();
      this.weather.destroy();
      if (this.vignetteKey && this.textures.exists(this.vignetteKey)) this.textures.remove(this.vignetteKey);
    });
  }

  // ------------------------------------------------------------------ сборка

  /** Виньетка и приглушение цветов на время замедления (видимость — по степени замедления). */
  private buildSlowOverlay(): void {
    const { width: w, height: h } = this.scale;
    this.vignetteKey = `hud_vignette_${w}x${h}_${Date.now()}`;
    const tex = this.textures.createCanvas(this.vignetteKey, w, h)!;
    const ctx = tex.getContext();
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / Math.max(w, h), h / Math.max(w, h));
    const r = Math.max(w, h) * 0.75;
    const g = ctx.createRadialGradient(0, 0, r * 0.45, 0, 0, r);
    g.addColorStop(0, 'rgba(8,16,20,0)');
    g.addColorStop(1, 'rgba(8,16,20,1)');
    ctx.fillStyle = g;
    ctx.fillRect(-r * 2, -r * 2, r * 4, r * 4);
    tex.refresh();
    this.slowGrey = this.add.rectangle(0, 0, w, h, SLOW_FX.grey, 1).setOrigin(0).setAlpha(0);
    this.slowVignette = this.add.image(0, 0, this.vignetteKey).setOrigin(0).setAlpha(0);
  }

  /** Справа вверху: иконки домов (сгоревшие — тёмные, с трещиной) и монеты, которые дадут уцелевшие дома. */
  private buildHouses(): void {
    const k = this.k;
    const bg = this.add.graphics();
    const items: Phaser.GameObjects.GameObject[] = [bg];
    // у картинки дома прозрачные поля: сам домик ≈ 100 px из 128
    const s = (L.houseIcon * k) / 100;
    let x = 10 * k;
    for (const house of this.battle.world.houses) {
      // казарма шире: её значок занимает полтора места
      const iw = house.spot.kind === 'barracks' ? L.houseIcon * 1.5 : L.houseIcon;
      const img = this.add.image(x + (iw * k) / 2, 47 * k, house.spot.kind === 'barracks' ? 'barracks' : 'house1').setOrigin(0.5, 1).setScale(s);
      const crack = this.add.graphics();
      if (house === this.battle.keyHouse) {
        const mx = img.x, my = 9 * k;
        crack.fillStyle(0xffd84a, 1).lineStyle(Math.max(1, k), 0x3d2718, 1);
        crack.fillTriangle(mx, my - 6 * k, mx + 5 * k, my, mx, my + 6 * k)
          .fillTriangle(mx, my - 6 * k, mx - 5 * k, my, mx, my + 6 * k);
      }
      items.push(img, crack);
      const icon = { house, img, crack };
      this.houseIcons.push(icon);
      if (!house.alive) this.markBurned(icon, false);
      x += iw * k + 6 * k;
    }
    const coin = this.add.image(x + 8 * k, 26 * k, 'icon_03').setScale(0.42 * k);
    this.coinText = label(this, x + 22 * k, 26 * k, '', 18 * k, COLOR.gold).setOrigin(0, 0.5);
    items.push(coin, this.coinText);
    const width = x + 60 * k;
    plate(bg, 0, 0, width, 52 * k);
    this.houseRoot = this.add.container(0, 0, items).setSize(width, 52 * k);
  }

  private makeCard(sq: Squad): Card {
    const k = this.k;
    const W = L.cardW * k, H = L.cardH * k;
    const frame = this.add.graphics();
    const av = L.avatar * k;
    const slotSize = av + 6 * k;
    const slot = this.add.image(5 * k, 5 * k, 'ui_slot').setOrigin(0).setScale(slotSize / 192);
    const avatar = this.add.image(5 * k + slotSize / 2, 5 * k + slotSize / 2, `avatar_${String(sq.def.avatar).padStart(2, '0')}`).setScale(av / 256);
    const key = label(this, 4 * k, 2 * k, String(sq.index + 1), 13 * k, COLOR.light);
    const parts: Phaser.GameObjects.GameObject[] = [frame, slot, avatar, key];
    // значок класса — у правого верхнего угла портрета, предмет — у правого нижнего
    const icx = 5 * k + slotSize + 2 * k, icy = 12 * k;
    const ci = CLASS_ICON[sq.cls];
    if (ci) parts.push(this.add.image(icx, icy, ci).setScale((sq.cls === 'archer' ? 0.42 : 0.3) * k));
    else parts.push(this.spearIcon(icx, icy));
    if (sq.def.item) parts.push(this.add.image(icx, 5 * k + slotSize - 8 * k, itemTexture(sq.def.item)).setScale((sq.def.item === 'bomb' ? 0.55 : 0.3) * k));
    const houseMark = this.add.image(5 * k + 12 * k, 5 * k + slotSize - 4 * k, 'house1').setOrigin(0.5, 1).setScale((18 * k) / 128).setVisible(false);
    const bar = this.add.graphics();
    const lostMark = this.add.graphics().setVisible(false);
    parts.push(houseMark, bar, lostMark);
    let ability: Card['ability'] = null;
    if (sq.def.ability > 0 && sq.cls !== 'militia') {
      const size = L.abilitySize * k;
      const img = this.add.image(0, 0, 'ui_btn_round').setScale(size / 100);
      const icon = this.add.image(0, -1 * k, ABILITY_ICON[sq.cls]).setScale((sq.cls === 'archer' ? 0.42 : 0.34) * k);
      const shade = this.add.graphics();
      const ring = this.add.graphics();
      const q = label(this, size / 2 - 1 * k, size / 2 - 3 * k, 'Q', 11 * k, COLOR.light).setOrigin(0.5);
      const root = this.add.container(W - size / 2 - 6 * k, 5 * k + slotSize / 2 + 6 * k, [img, icon, shade, ring, q]);
      parts.push(root);
      ability = { root, shade, ring };
    } else if (sq.cls !== 'militia') {
      // способность ещё не изучена — пустое тусклое гнездо на её месте
      const size = L.abilitySize * k;
      parts.push(this.add.image(W - size / 2 - 6 * k, 5 * k + slotSize / 2 + 6 * k, 'ui_btn_round').setScale(size / 100).setAlpha(0.3).setTint(0x8a8f94));
    }
    const root = this.add.container(0, 0, parts);
    return {
      sq, root, frame, avatar, bar, houseMark, lostMark, ability, abilityRect: null,
      rect: { x: 0, y: 0, w: W, h: H }, x: 0, baseY: 0,
      lostAt: sq.lost ? -Infinity : null, collapsing: false, collapsed: sq.lost, wasReady: sq.abilityCooldown <= 0, lastClick: 0,
    };
  }

  /** Значок копейщиков (в паке нет): копьё по диагонали. */
  private spearIcon(x: number, y: number): Phaser.GameObjects.Graphics {
    const k = this.k;
    const g = this.add.graphics({ x, y });
    g.lineStyle(4 * k, 0x13202a, 1).lineBetween(-7 * k, 7 * k, 6 * k, -6 * k);
    g.lineStyle(2 * k, 0xc8a46a, 1).lineBetween(-7 * k, 7 * k, 6 * k, -6 * k);
    g.fillStyle(0x13202a, 1).fillTriangle(4 * k, -9 * k, 9 * k, -4 * k, 9 * k, -10 * k);
    g.fillStyle(0xe8eef0, 1).fillTriangle(5 * k, -8 * k, 8 * k, -5 * k, 8 * k, -9 * k);
    return g;
  }

  /** Подсказки управления — по одной, по ситуации, в первых боях кампании и в быстром бою. */
  private buildHints(): void {
    const k = this.k;
    this.hintBg = this.add.graphics();
    this.hintText = label(this, 0, 0, '', 15 * k, COLOR.light).setOrigin(0.5)
      .setWordWrapWidth(this.scale.width - 32 * k).setAlign('center');
    this.hintRoot = this.add.container(0, 0, [this.hintBg, this.hintText]).setAlpha(0).setDepth(DEPTH.ui + 2);
    if (!this.battle.hintsActive) return;
    const w = this.battle.world;
    const startZones = new Map(w.squads.map((s) => [s, s.zone]));
    let abilityUsed = false;
    this.hints = [
      { text: 'Осмотри остров — Home или кнопка обзора слева вверху', when: () => true, done: () => this.hintSince > 4 },
      { text: 'Выбери отряд — клавиши 1–4 или клик по нему', when: () => true, done: () => !!w.selected },
      { text: 'Кликни по свободной клетке — отряд встанет туда', when: () => !!w.selected, done: () => w.squads.some((s) => s.zone !== startZones.get(s)) },
      {
        text: 'Кликни по дому, чтобы восстановить солдат',
        when: () => w.squads.some((s) => !s.lost && s.hpFraction < 0.75 && !s.inHouse),
        done: () => w.squads.some((s) => !!s.entering || !!s.inHouse),
      },
      {
        text: 'Q — выбрать способность, клик по квадрату — применить',
        when: () => {
          const s = w.selected;
          if (!s || s.abilityCooldown > 0 || !this.cards.find((c) => c.sq === s)?.ability) return false;
          const c = s.center();
          return w.units.some((u) => u.team === 'enemy' && u.alive && Math.hypot(u.x - c.x, u.y - c.y) < 4 * 64);
        },
        done: () => {
          if (w.squads.some((s) => s.abilityCooldown > 0)) abilityUsed = true;
          return abilityUsed;
        },
      },
      { text: 'Пробел — пауза, Esc — меню', when: () => this.battle.waves.waveIndex >= 0, done: () => false },
    ];
  }

  // ------------------------------------------------------------------ раскладка

  private layout(): void {
    const { width, height } = this.scale;
    const k = this.k;
    const m = L.margin * k;
    // кнопки слева вверху
    const bs = this.pauseBtn.size;
    this.pauseBtn.root.setPosition(m + bs / 2, m + bs / 2);
    this.fastBtn.root.setPosition(m + bs * 1.5 + 8 * k, m + bs / 2);
    this.overviewBtn.root.setPosition(m + bs * 2.5 + 16 * k, m + bs / 2);
    // дома и монеты справа вверху
    this.houseRoot.setPosition(width - this.houseRoot.width - m, m);
    this.conditions.setPosition(width / 2, 50 * k);
    // баннер под флажками волн
    this.banner.place(width / 2, 112 * k);
    this.layoutCards();
    const top = Math.min(height, ...this.cards.filter((c) => !c.collapsed).map((c) => c.rect.y));
    this.hintRoot.setPosition(width / 2, top - 22 * k);
  }

  /** Карточки по центру внизу; на узком экране — в два ряда. */
  private layoutCards(): void {
    const { width, height } = this.scale;
    const k = this.k;
    const shown = this.cards.filter((c) => !c.collapsed);
    const W = L.cardW * k, H = L.cardH * k, gap = L.cardGap * k;
    let perRow = Math.max(1, shown.length);
    if (perRow * W + (perRow - 1) * gap > width - 24 * k) perRow = Math.ceil(shown.length / 2);
    const rows = Math.ceil(shown.length / perRow);
    shown.forEach((c, i) => {
      const row = Math.floor(i / perRow), inRow = Math.min(perRow, shown.length - row * perRow);
      const total = inRow * W + (inRow - 1) * gap;
      c.x = Math.round((width - total) / 2 + (i % perRow) * (W + gap));
      c.baseY = Math.round(height - L.margin * k - (rows - row) * H - (rows - 1 - row) * (gap + L.cardLift * k));
      c.root.setPosition(c.x, c.baseY);
      c.rect = { x: c.x, y: c.baseY - L.cardLift * k, w: W, h: H + L.cardLift * k };
      if (c.ability) {
        const s = L.abilitySize * k;
        c.abilityRect = { x: c.x + c.ability.root.x - s / 2, y: c.baseY + c.ability.root.y - s / 2, w: s, h: s };
      }
    });
  }

  // ------------------------------------------------------------------ ввод

  /** Указатель над интерфейсом — клик не уходит на остров. */
  isOverUi(p: Phaser.Input.Pointer): boolean {
    if (this.pause) return true;
    const inR = (r: Rect) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
    if (inR(this.pauseBtn.rect) || inR(this.fastBtn.rect) || inR(this.overviewBtn.rect)) return true;
    if (inR({ x: this.houseRoot.x, y: this.houseRoot.y, w: this.houseRoot.width, h: this.houseRoot.height })) return true;
    return this.cards.some((c) => !c.collapsed && inR(c.rect));
  }

  private cardAt(p: Phaser.Input.Pointer): Card | null {
    return this.cards.find((c) => !c.collapsed && p.x >= c.rect.x && p.y >= c.rect.y && p.x <= c.rect.x + c.rect.w && p.y <= c.rect.y + c.rect.h) ?? null;
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (!p.leftButtonDown() || this.pause || this.ended) return;
    const c = this.cardAt(p);
    if (!c || c.sq.lost) return;
    const a = c.abilityRect;
    if (a && p.x >= a.x && p.y >= a.y && p.x <= a.x + a.w && p.y <= a.y + a.h) {
      this.battle.useAbility(c.sq);
      return;
    }
    sfx.play('click', 0.5);
    const now = this.time.now;
    if (now - c.lastClick < T.doubleClickMs) {
      // двойной клик — камера плавно летит к отряду
      const pos = c.sq.center();
      this.battle.cameraCtl.flyTo(pos.x, pos.y, T.flySec);
      this.battle.selection.select(c.sq);
    } else {
      this.battle.selection.toggleIndex(c.sq.index);
    }
    c.lastClick = now;
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const c = this.pause || this.ended ? null : this.cardAt(p);
    if (!c) { this.tooltip.hide(); return; }
    const sq = c.sq, d = sq.def;
    const soldiers = sq.aliveUnits.filter((u) => !u.isCommander).length;
    const lines = [
      `${d.name} — ${CLASS_NAMES[sq.cls]}${d.level ? `, ур. ${d.level}` : ''}`,
      sq.lost ? 'Отряд потерян' : `Здоровье ${Math.round(sq.hpFraction * 100)}% · бойцов ${soldiers + 1}/${sq.soldiersMax + 1}`,
    ];
    if (d.ability > 0 && sq.cls !== 'militia') lines.push(`Способность (Q): ${ABILITY_NAMES[sq.cls]}, ур. ${d.ability}`);
    else if (sq.cls !== 'militia') lines.push(`Способность: ${ABILITY_NAMES[sq.cls]} — не изучена`);
    if (d.item) lines.push(`Предмет: ${ITEM_NAMES[d.item]} — ${ITEMS[d.item].desc}`);
    this.tooltip.show(c.rect.x + c.rect.w / 2, c.rect.y, lines);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.pause) this.pause.handleKey(e);
  }

  // ------------------------------------------------------------------ события

  /** Баннер события (очередь, по одному). */
  showBanner(text: string, color: 'blue' | 'red' | 'yellow' = 'blue'): void {
    if (this.banner && this.scene.isActive()) this.banner.show(text, color);
  }

  private onWave(i: number): void {
    const total = this.battle.waves.totalWaves;
    const last = i === total - 1;
    this.showBanner(last ? 'Последняя волна' : `Волна ${i + 1} из ${total}`, last ? 'red' : 'blue');
  }

  private onHouseIgnited(h: House): void {
    this.showBanner(h.spot.kind === 'barracks' ? 'Казарма горит!' : 'Дом горит!', 'red');
  }

  private onHouseBurned(h: House): void {
    const icon = this.houseIcons.find((o) => o.house === h);
    if (icon) this.markBurned(icon, true);
  }

  private onSquadLost(sq: Squad): void {
    this.showBanner('Отряд потерян', 'red');
    const c = this.cards.find((o) => o.sq === sq);
    if (c && c.lostAt === null) c.lostAt = this.time.now;
  }

  private onSoldierRestored(sq: Squad): void {
    const c = this.cards.find((o) => o.sq === sq);
    if (!c || c.collapsed) return;
    const k = this.k;
    const t = label(this, c.x + 32 * k, c.baseY + 12 * k, '+1', 18 * k, COLOR.green).setOrigin(0.5).setDepth(DEPTH.ui + 3);
    this.tweens.add({ targets: t, y: t.y - 26 * k, alpha: 0, duration: T.plusMs, ease: 'Sine.easeOut', onComplete: () => t.destroy() });
  }

  /** Дом сгорел: иконка темнеет и трескается, число монет вздрагивает и вспыхивает красным. */
  private markBurned(icon: { img: Phaser.GameObjects.Image; crack: Phaser.GameObjects.Graphics }, animate: boolean): void {
    const k = this.k;
    icon.img.setTint(0x4a4a4a).setAlpha(0.55);
    const x = icon.img.x, y = icon.img.y - (L.houseIcon * k * 1.5) / 2;
    icon.crack.clear().lineStyle(Math.max(1, k), 0x13202a, 1)
      .lineBetween(x - 2 * k, y - 8 * k, x + 2 * k, y - 2 * k).lineBetween(x + 2 * k, y - 2 * k, x - 1 * k, y + 3 * k).lineBetween(x - 1 * k, y + 3 * k, x + 3 * k, y + 9 * k);
    if (!animate) return;
    const x0 = this.houseRoot.x;
    this.tweens.add({ targets: this.houseRoot, x: x0 + 4 * k, duration: T.houseShakeMs, yoyo: true, repeat: 3, onComplete: () => this.houseRoot.setX(x0) });
    this.coinText.setColor(COLOR.red);
    this.time.delayedCall(T.houseShakeMs * 8, () => this.coinText.setColor(COLOR.gold));
  }

  /** Конец боя: баннер победы/поражения, подсказки и всплывающие окна убираются. */
  onBattleEnd(won: boolean, missionLost = false): void {
    this.ended = true;
    this.tooltip.hide();
    this.hintRoot.setAlpha(0);
    this.banner.clear();
    this.showBanner(won ? 'Остров отстоян' : missionLost ? 'Ключевой дом потерян' : 'Остров пал', won ? 'blue' : 'red');
  }

  // ------------------------------------------------------------------ кадр

  update(_t: number, dtMs: number): void {
    const b = this.battle;
    if (!b.scene.isActive()) return;
    this.weather.update(Math.min(dtMs, 50) / 1000);
    // замедление: виньетка и приглушённые цвета
    const slow = b.paused ? 0 : b.slowAmount;
    this.slowVignette.setAlpha(slow * SLOW_FX.vignetteAlpha);
    this.slowGrey.setAlpha(slow * SLOW_FX.greyAlpha);

    this.pauseBtn.setActive(b.paused);
    this.fastBtn.setActive(b.fast);
    this.drawFlags();
    this.coinText.setText(String(b.reward));
    this.updateCards();
    this.drawWarnings();
    this.updateHints(dtMs / 1000);

    if (b.paused && !this.pause && !b.ended) {
      this.tooltip.hide();
      this.pause = new PauseMenu(this, b, this.k);
    }
    if (!b.paused && this.pause) { this.pause.destroy(); this.pause = null; }
  }

  /** Флажки волн по центру сверху: пройденные — тусклые, текущая — золотая, последняя — крупнее и красная. */
  private drawFlags(): void {
    const k = this.k;
    const wv = this.battle.waves;
    const n = wv.totalWaves;
    const g = this.flags.clear();
    const cx = this.scale.width / 2, top = L.margin * k;
    const gap = L.flagGap * k;
    const pw = n * gap + 16 * k, ph = 32 * k;
    plate(g, cx - pw / 2, top, pw, ph, 0.5);
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const x = cx + (i - (n - 1) / 2) * gap - 3 * k;
      const h = (last ? L.flagH * 1.35 : L.flagH) * k;
      const cur = i === wv.waveIndex;
      const past = i < wv.waveIndex;
      const bob = cur ? Math.sin(this.time.now / 260) * 1.5 * k : 0;
      const base = top + ph - 6 * k;
      const alpha = past ? 0.35 : cur ? 1 : 0.75;
      const cloth = past ? 0x8a8a8a : cur ? 0xffd84a : last ? 0xe0483c : 0xf6eed8;
      g.fillStyle(0x13202a, alpha).fillRect(x - 1 * k, base - h - 1 * k, 3 * k, h + 1 * k);
      g.fillStyle(0xd9b98a, alpha).fillRect(x, base - h, 1 * k, h);
      const cw = (last ? 13 : 10) * k, ch = (last ? 9 : 7) * k;
      g.fillStyle(0x13202a, alpha).fillTriangle(x + k, base - h - k + bob, x + k, base - h + ch + k + bob, x + cw + 2 * k, base - h + ch / 2 + bob);
      g.fillStyle(cloth, alpha).fillTriangle(x + k, base - h + bob, x + k, base - h + ch + bob, x + cw, base - h + ch / 2 + bob);
    }
    // обратный отсчёт до первой волны — под флажками, исчезает с началом волны
    const cd = wv.countdown;
    if (cd > 0) {
      this.countdown.setText(`волна через ${Math.ceil(cd)}`).setPosition(cx, top + ph + 26 * k);
      if (!this.countdownShown) { this.countdownShown = true; this.countdown.setAlpha(1); }
    } else if (this.countdownShown) {
      this.countdownShown = false;
      this.tweens.add({ targets: this.countdown, alpha: 0, duration: T.countdownFadeMs });
    }
  }

  private updateCards(): void {
    const b = this.battle;
    const w = b.world;
    const k = this.k;
    for (const c of this.cards) {
      if (c.collapsed) continue;
      const sq = c.sq;
      const W = L.cardW * k, H = L.cardH * k;
      // потерян: серая карточка с крестом, через 2 с сворачивается
      if (sq.lost && c.lostAt === null) c.lostAt = this.time.now;
      if (c.lostAt !== null) {
        c.avatar.setTint(0x777777).setAlpha(0.5);
        c.lostMark.setVisible(true).clear().lineStyle(4 * k, 0xc0392b, 0.9)
          .lineBetween(10 * k, 10 * k, 6 * k + L.avatar * k, 6 * k + L.avatar * k).lineBetween(6 * k + L.avatar * k, 10 * k, 10 * k, 6 * k + L.avatar * k);
        if (!c.collapsing && this.time.now - c.lostAt > T.lostCollapseDelayMs) {
          c.collapsing = true;
          this.tweens.add({
            targets: c.root, alpha: 0, duration: T.lostCollapseMs,
            onComplete: () => { c.collapsed = true; c.root.setVisible(false); this.layout(); },
          });
        }
      }
      // приподнять выбранную
      const sel = w.selected === sq;
      c.root.y = c.baseY - (sel ? L.cardLift * k : 0);
      // подложка и рамка: выбран — золотая, в бою — красная пульсация
      const fighting = !sq.lost && w.time - sq.lastFight < T.fightSec;
      const f = c.frame.clear();
      plate(f, 0, 0, W, H, sq.lost ? 0.4 : undefined);
      if (sel) f.lineStyle(2 * k, 0xffd84a, 1).strokeRoundedRect(k, k, W - 2 * k, H - 2 * k, 6);
      else if (fighting) f.lineStyle(2 * k, 0xe0483c, 0.45 + 0.4 * Math.sin((this.time.now / T.fightPulseMs) * Math.PI)).strokeRoundedRect(k, k, W - 2 * k, H - 2 * k, 6);
      else f.lineStyle(k, 0xffffff, 0.15).strokeRoundedRect(k, k, W - 2 * k, H - 2 * k, 6);
      // в доме: значок дома на портрете
      c.houseMark.setVisible(!sq.lost && (!!sq.inHouse || !!sq.entering));
      this.drawBar(c, W);
      // способность: тёмный сектор «отматывается»; готова — вспышка и щелчок
      if (c.ability) {
        const max = b.abilityCooldownMax(sq);
        const left = sq.lost ? max : sq.abilityCooldown;
        const r = (L.abilitySize * k) / 2 - 3 * k;
        c.ability.shade.clear();
        if (left > 0) c.ability.shade.fillStyle(0x000000, 0.6).slice(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / max), false).fillPath();
        const ready = left <= 0;
        if (ready && !c.wasReady && !sq.lost) this.flashReady(c);
        c.wasReady = ready;
      }
    }
  }

  /** Полоса общего здоровья отряда под портретом: заливка по доле, деления по бойцам. */
  private drawBar(c: Card, W: number): void {
    const k = this.k;
    const sq = c.sq;
    const x = 8 * k, y = (5 + L.avatar + 6 + 12) * k, w = W - 16 * k, h = L.barH * k;
    const g = c.bar.clear();
    g.fillStyle(0x13202a, 1).fillRoundedRect(x - 2 * k, y - 2 * k, w + 4 * k, h + 4 * k, 3);
    g.fillStyle(0x3a2f2a, 1).fillRect(x, y, w, h);
    const frac = sq.lost ? 0 : sq.hpFraction;
    const col = frac > 0.5 ? 0x63d66a : frac > 0.25 ? 0xf0c040 : 0xe0483c;
    g.fillStyle(col, 1).fillRect(x, y, Math.round(w * frac), h);
    g.fillStyle(0xffffff, 0.25).fillRect(x, y, Math.round(w * frac), Math.max(1, Math.round(h / 3)));
    const per = sq.soldierHp / sq.maxHp;
    for (let i = 1; i <= sq.soldiersMax; i++) {
      const px = x + Math.round(w * (sq.cmdHp / sq.maxHp + (i - 1) * per));
      if (px > x && px < x + w) g.fillStyle(0x13202a, 0.55).fillRect(px, y, Math.max(1, k), h);
    }
  }

  private flashReady(c: Card): void {
    if (!c.ability) return;
    const k = this.k;
    const ring = c.ability.ring;
    const r = (L.abilitySize * k) / 2;
    sfx.play('ready', 0.7);
    const state = { t: 0 };
    this.tweens.add({
      targets: state, t: 1, duration: T.readyFlashMs,
      onUpdate: () => { ring.clear().lineStyle(3 * k, 0xffffff, 1 - state.t).strokeCircle(0, 0, r + state.t * 8 * k); },
      onComplete: () => { ring.clear(); },
    });
  }

  private updateHints(dt: number): void {
    if (!this.hints.length || this.ended) return;
    this.hintSince += dt;
    const cur = this.hintShown;
    if (cur) {
      // показанная подсказка уходит, когда выполнена; последняя («пауза») — через время
      const last = cur === this.hints[this.hints.length - 1] && cur.text.startsWith('Пробел');
      if ((cur.done() && this.hintSince > 1) || (last && this.hintSince > T.hintLastSec)) {
        this.hints = this.hints.filter((h) => h !== cur);
        this.hintShown = null;
        this.tweens.add({ targets: this.hintRoot, alpha: 0, duration: T.hintFadeMs });
      }
      return;
    }
    // следующая — первая невыполненная, для которой сейчас подходящий момент
    this.hints = this.hints.filter((h) => !h.done());
    const next = this.hints.find((h) => h.when());
    if (!next) return;
    const k = this.k;
    this.hintShown = next;
    this.hintSince = 0;
    this.hintText.setText(next.text);
    const w = this.hintText.width + 24 * k, h = this.hintText.height + 10 * k;
    this.hintBg.clear();
    plate(this.hintBg, -w / 2, -h / 2, w, h, 0.7);
    this.tweens.add({ targets: this.hintRoot, alpha: 1, duration: T.hintFadeMs });
  }

  /**
   * Стрелки у края экрана к подплывающим лодкам (по точке высадки, с числом лодок); если лодки на экране —
   * маркер над ними. До волны — жёлтые стрелки к местам будущей высадки.
   */
  private drawWarnings(): void {
    const g = this.arrows.clear();
    const b = this.battle;
    const cam = b.cameras.main;
    const k = this.k;
    const groups = new Map<LandingPoint, Boat[]>();
    for (const boat of b.waves.incoming) {
      const list = groups.get(boat.landing) ?? [];
      list.push(boat);
      groups.set(boat.landing, list);
    }
    const targets: { p: Point; urgent: boolean; n: number }[] = [];
    for (const list of groups.values()) {
      targets.push({ p: { x: list.reduce((s, o) => s + o.x, 0) / list.length, y: list.reduce((s, o) => s + o.y, 0) / list.length }, urgent: true, n: list.length });
    }
    if (b.waves.countdown > 0) {
      for (const l of b.waves.nextLandings()) targets.push({ p: { x: (l.x + 0.5 + l.dx * 3) * 64, y: (l.y + 0.5 + l.dy * 3) * 64 }, urgent: false, n: 0 });
    }
    const { width } = this.scale;
    const bottom = Math.min(this.scale.height, ...this.cards.filter((c) => !c.collapsed).map((c) => c.rect.y)) - 20 * k;
    const topEdge = 60 * k;
    const margin = 30 * k;
    const pulse = 0.6 + 0.4 * Math.sin(this.time.now / T.arrowPulseMs);
    let used = 0;
    for (const t of targets) {
      const sx = (t.p.x - cam.worldView.x) * cam.zoom;
      const sy = (t.p.y - cam.worldView.y) * cam.zoom;
      const color = t.urgent ? 0xff6a50 : 0xffd84a;
      const onScreen = sx > margin && sy > topEdge && sx < width - margin && sy < bottom;
      let ax: number, ay: number;
      if (onScreen) {
        // маркер над лодками
        ax = sx; ay = sy - 60 * k;
        const s = 9 * k;
        g.fillStyle(0x13202a, 0.6 * pulse).fillTriangle(ax - s - 2, ay - s - 2, ax + s + 2, ay - s - 2, ax, ay + s * 0.6 + 2);
        g.fillStyle(color, pulse).fillTriangle(ax - s, ay - s, ax + s, ay - s, ax, ay + s * 0.6);
      } else {
        // стрелка прижата к краю экрана в сторону лодок
        const cx = width / 2, cy = (topEdge + bottom) / 2;
        const ang = Math.atan2(sy - cy, sx - cx);
        const hw = width / 2 - margin, hh = (bottom - topEdge) / 2 - margin / 2;
        const kk = Math.min(hw / Math.abs(Math.cos(ang) || 1e-6), hh / Math.abs(Math.sin(ang) || 1e-6));
        ax = cx + Math.cos(ang) * kk; ay = cy + Math.sin(ang) * kk;
        const r = 14 * k;
        const pt = (a: number, d: number) => ({ x: ax + Math.cos(a) * d, y: ay + Math.sin(a) * d });
        const tip = pt(ang, r), l = pt(ang + 2.5, r), rr = pt(ang - 2.5, r);
        g.fillStyle(0x13202a, 0.6 * pulse).fillTriangle(tip.x + 2, tip.y + 2, l.x + 2, l.y + 2, rr.x + 2, rr.y + 2);
        g.fillStyle(color, pulse).fillTriangle(tip.x, tip.y, l.x, l.y, rr.x, rr.y);
        ax -= Math.cos(ang) * 24 * k; ay -= Math.sin(ang) * 24 * k;
      }
      if (t.n > 1) {
        const lbl = this.arrowLabels[used] ?? (this.arrowLabels[used] = label(this, 0, 0, '', 14 * k, COLOR.light).setOrigin(0.5).setDepth(DEPTH.ui + 1));
        lbl.setText(`×${t.n}`).setPosition(ax, onScreen ? ay - 16 * k : ay).setVisible(true).setAlpha(0.7 + 0.3 * pulse);
        used++;
      }
    }
    for (let i = used; i < this.arrowLabels.length; i++) this.arrowLabels[i].setVisible(false);
  }
}

/** Картинка предмета (для карточек, кампании и улучшений). */
export function itemTexture(item: string): string {
  return item === 'bomb' ? 'dynamite' : item === 'shield' ? 'icon_06' : 'icon_12';
}
