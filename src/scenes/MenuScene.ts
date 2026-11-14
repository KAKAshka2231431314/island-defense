import Phaser from 'phaser';
import { UNIT_ANIMS } from '../data/assetManifest';
import { FOG, MENU } from '../data/balance';
import { DEPTH, TILE, WATER_COLOR } from '../data/config';
import { generateIsland, type IslandData } from '../mapgen/IslandGenerator';
import { mulberry32, type Rng } from '../mapgen/rng';
import { animKey, fxKey } from '../systems/AnimationRegistry';
import { Campaign } from '../systems/CampaignState';
import { depthAt } from '../systems/depth';
import { Fog } from '../systems/Fog';
import { IslandDecorRenderer } from '../systems/IslandDecorRenderer';
import { sfx } from '../systems/Sound';
import { TerrainRenderer } from '../systems/TerrainRenderer';
import { COLOR, ConfirmBox, label, MenuList, SettingsPanel, type MenuListItem } from './ui';

export const GAME_TITLE = 'Последний берег';
const SUBTITLE = 'защити острова от набегов';
/** Глубины слоёв меню поверх острова (но под туманом Fog, который на DEPTH.ui − 300). */
const DEPTH_CLOUD_SHADOW = DEPTH.ui - 320;
const DEPTH_ISLAND_COVER = DEPTH.ui - 310;
/** Шаг строя рыцарей у дома, px мира. */
const KNIGHT_GAP_X = 36;
const KNIGHT_GAP_Y = 26;

interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * Фон меню: маленький живой остров посреди моря (как в Bad North) — качаются деревья, бродят овцы,
 * у дома стоит отряд, вдали изредка проплывает лодка, по острову ползут тени облаков.
 */
export class MenuScene extends Phaser.Scene {
  private island!: IslandData;
  private rng!: Rng;
  private land!: Box;
  private baseZoom = 1;
  private leaving = false;
  private elapsed = 0;
  private shadows: Phaser.GameObjects.Image[] = [];

  constructor() {
    super('Menu');
  }

  create(): void {
    this.leaving = false;
    this.elapsed = 0;
    this.shadows = [];
    // в dev-сборке сид можно подменить из консоли: game.registry.set('menuSeed', 123); game.scene.start('Menu')
    const seed = (import.meta.env.DEV && (this.registry.get('menuSeed') as number | undefined)) || MENU.seed;
    this.island = generateIsland(seed, MENU.island);
    this.rng = mulberry32(seed);
    new TerrainRenderer(this, this.island.grid, this.rng).render();
    new IslandDecorRenderer(this, this.island, this.rng).render();
    const fog = new Fog(this, this.island.grid, this.rng, { sheet: false });
    this.land = this.measureLand();

    this.spawnKnights();
    this.spawnCloudShadows();
    this.scheduleBoat(MENU.boatDelayMs[0] / 3);

    // появление: сначала только море (остров закрыт водой), потом остров проявляется
    const g = this.island.grid;
    const cover = this.add.rectangle(-TILE, -TILE, (g.w + 2) * TILE, (g.h + 2) * TILE, WATER_COLOR).setOrigin(0).setDepth(DEPTH_ISLAND_COVER);
    this.tweens.add({ targets: cover, alpha: 0, delay: MENU.intro.islandDelayMs, duration: MENU.intro.islandMs, ease: 'Sine.easeInOut', onComplete: () => cover.destroy() });

    this.fitCamera();
    this.scale.on('resize', this.fitCamera, this);
    sfx.startAmbience();

    this.scene.stop('MenuUi');
    this.scene.launch('MenuUi', { skipIntro: false });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.fitCamera, this);
      fog.destroy();
      sfx.stopAmbience();
      this.scene.stop('MenuUi');
    });
  }

  update(_t: number, dtMs: number): void {
    const dt = dtMs / 1000;
    this.elapsed += dtMs;
    // тени облаков ползут слева направо и возвращаются с другой стороны
    const { x0, x1, y0, y1 } = this.land;
    for (const s of this.shadows) {
      s.x += MENU.cloudShadowSpeed * dt;
      if (s.x - s.displayWidth / 2 > x1 + TILE * 2) s.setPosition(x0 - s.displayWidth / 2 - TILE * 2, y0 + this.rng() * (y1 - y0));
    }
    if (this.leaving) return;
    // «дыхание» камеры: медленный дрейф по эллипсу (масштаб остаётся целым — пиксели не плывут)
    const ph = (this.elapsed / MENU.driftPeriodMs) * Math.PI * 2;
    const cx = (x0 + x1) / 2 + Math.sin(ph) * MENU.driftX;
    const cy = (y0 + y1) / 2 + Math.sin(ph * 0.73 + 1) * MENU.driftY;
    this.cameras.main.centerOn(cx, cy);
  }

  /** Уход из меню: камера плавно наезжает на остров, затем затемнение и следующая сцена. */
  leave(target: string, data?: object): void {
    if (this.leaving) return;
    this.leaving = true;
    const cam = this.cameras.main;
    this.tweens.add({ targets: cam, zoom: this.baseZoom * MENU.exit.zoomMult, duration: MENU.exit.zoomMs, ease: 'Sine.easeInOut' });
    this.time.delayedCall(MENU.exit.zoomMs - MENU.exit.blackMs, () => cam.fadeOut(MENU.exit.blackMs, 0, 0, 0));
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(target, data));
  }

  /** Целый масштаб из MENU.zoomSteps, при котором остров ближе всего к MENU.islandScreenFrac высоты экрана. */
  private fitCamera(): void {
    if (this.leaving) return;
    const { width, height } = this.scale;
    const lw = this.land.x1 - this.land.x0, lh = this.land.y1 - this.land.y0;
    let best: number = MENU.zoomSteps[0], bestErr = Infinity;
    for (const z of MENU.zoomSteps) {
      if (lw * z > width * 0.92 && z !== MENU.zoomSteps[0]) continue; // остров должен влезать по ширине
      const err = Math.abs(Math.log((lh * z) / height / MENU.islandScreenFrac));
      if (err < bestErr) { bestErr = err; best = z; }
    }
    this.baseZoom = best;
    this.cameras.main.setZoom(best).centerOn((this.land.x0 + this.land.x1) / 2, (this.land.y0 + this.land.y1) / 2);
  }

  /** Границы суши в пикселях мира (+ клетка сверху под крыши и кроны, + клетка снизу под скалы). */
  private measureLand(): Box {
    const g = this.island.grid;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.getLevel(x, y) < 1 && !g.cliffLevel(x, y)) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      }
    }
    return { x0: x0 * TILE, y0: (y0 - 1) * TILE, x1: x1 * TILE, y1: (y1 + 0.5) * TILE };
  }

  /** Небольшой отряд рыцарей (idle) в квадрате перед дверью дома — как отряд, стоящий в зоне. */
  private spawnKnights(): void {
    const g = this.island.grid;
    const h = this.island.houses[0];
    if (!h) return;
    const spot = { x: h.doorX + 0.5, y: h.doorY + 0.5 };
    const anim = UNIT_ANIMS.warrior_blue;
    const idle = anim.anims.idle!;
    const cols = 3, rows = Math.ceil(MENU.knights / cols);
    for (let i = 0; i < MENU.knights; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x = (spot.x + 0.5) * TILE + (c - (cols - 1) / 2) * KNIGHT_GAP_X;
      const y = (spot.y + 0.5) * TILE + (r - (rows - 1) / 2) * KNIGHT_GAP_Y;
      const s = this.add.sprite(x, y, idle.sheet, idle.start).setOrigin(0.5, anim.originY).setFlipX(this.rng() < 0.3);
      s.play({ key: animKey('warrior_blue', 'idle'), startFrame: Math.floor(this.rng() * 6) });
      s.setDepth(depthAt(g, x, y, i * 1e-3));
    }
  }

/** 2–3 полупрозрачные тени облаков над островом (мягкий эллипс-градиент кодом). */
  private spawnCloudShadows(): void {
    if (!this.textures.exists('menu_cloud_shadow')) {
      const size = 128;
      const tex = this.textures.createCanvas('menu_cloud_shadow', size, size)!;
      const ctx = tex.getContext();
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(11,26,34,1)');
      g.addColorStop(0.55, 'rgba(11,26,34,0.75)');
      g.addColorStop(1, 'rgba(11,26,34,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      tex.refresh();
      tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    const { x0, x1, y0, y1 } = this.land;
    const [a0, a1] = MENU.cloudShadowAlpha;
    for (let i = 0; i < MENU.cloudShadows; i++) {
      const w = TILE * (5 + this.rng() * 3), h = w * (0.45 + this.rng() * 0.15);
      const x = x0 + ((i + this.rng() * 0.5) / MENU.cloudShadows) * (x1 - x0 + TILE * 4) - TILE * 2;
      const e = this.add.image(x, y0 + this.rng() * (y1 - y0), 'menu_cloud_shadow').setDisplaySize(w, h)
        .setAlpha(a0 + this.rng() * (a1 - a0)).setDepth(DEPTH_CLOUD_SHADOW);
      this.shadows.push(e);
    }
  }

  /** Пустая лодка изредка проходит вдали (в дымке), то сверху, то снизу от острова. */
  private scheduleBoat(delay: number): void {
    this.time.delayedCall(delay, () => {
      if (this.leaving) return;
      const { x0, x1, y0, y1 } = this.land;
      const top = this.rng() < 0.5;
      const y = top ? y0 - TILE * 2.5 : y1 + TILE * 2.5;
      const right = this.rng() < 0.5;
      const view = this.cameras.main.worldView;
      const from = Math.min(x0, view.x) - TILE * 3, to = Math.max(x1, view.right) + TILE * 3;
      const boat = this.add.sprite(right ? from : to, y, 'boat').setOrigin(0.5, 0.62).setFlipX(!right).setDepth(DEPTH.objects + y);
      boat.play(fxKey('boat'));
      this.tweens.add({
        targets: boat, x: right ? to : from, duration: ((to - from) / MENU.boatSpeed) * 1000,
        onComplete: () => boat.destroy(),
      });
      const [d0, d1] = MENU.boatDelayMs;
      this.scheduleBoat(((to - from) / MENU.boatSpeed) * 1000 + d0 + this.rng() * (d1 - d0));
    });
  }
}

// ======================================================================
// Интерфейс меню
// ======================================================================

type Mode = 'intro' | 'main' | 'leaving';

/** Список в духе Bad North (слева внизу), название сверху, настройки выезжают справа. */
export class MenuUiScene extends Phaser.Scene {
  private k = 1;
  private mode: Mode = 'main';
  private ui!: Phaser.GameObjects.Container;
  private list!: MenuList;
  private settingsPanel: SettingsPanel | null = null;
  private confirmBox: ConfirmBox | null = null;
  private vignetteKey = '';
  private saved: Campaign | null = null;

  constructor() {
    super('MenuUi');
  }

  create(data: { skipIntro?: boolean; settingsRow?: number }): void {
    const { width, height } = this.scale;
    this.k = Phaser.Math.Clamp(Math.min(width / 1280, height / 800), 0.7, 1.5);
    this.settingsPanel = null;
    this.confirmBox = null;
    this.saved = Campaign.load();
    const intro = !data?.skipIntro;
    this.mode = intro ? 'intro' : 'main';

    this.drawVignette();
    this.ui = this.add.container(0, 0);
    this.buildTitle(intro);
    this.buildList(intro);
    this.buildFooter(intro);

    // экран из тьмы: сначала проявляется море
    if (intro) {
      const black = this.add.rectangle(0, 0, width, height, 0x000000).setOrigin(0).setDepth(1000);
      this.tweens.add({ targets: black, alpha: 0, duration: MENU.intro.seaMs, onComplete: () => black.destroy() });
      this.list.enabled = false;
      this.time.delayedCall(MENU.intro.itemsDelayMs + 5 * MENU.intro.staggerMs, () => {
        if (this.mode === 'intro') { this.mode = 'main'; this.syncList(); }
      });
    }

    this.input.keyboard?.on('keydown', this.onKey, this);
    // перестройка при изменении окна (без повторного вступления; открытые настройки остаются открытыми)
    let timer: Phaser.Time.TimerEvent | null = null;
    const onResize = () => {
      timer?.remove();
      timer = this.time.delayedCall(200, () => this.scene.restart({ skipIntro: true, settingsRow: this.settingsPanel ? this.settingsPanel.row : -1 }));
    };
    this.scale.on('resize', onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize);
      this.input.keyboard?.off('keydown', this.onKey, this);
      if (this.vignetteKey && this.textures.exists(this.vignetteKey)) this.textures.remove(this.vignetteKey);
    });
    if (data?.settingsRow !== undefined && data.settingsRow >= 0) this.openSettings(false, data.settingsRow);
  }

  // ------------------------------------------------------------------ оформление

  /** Виньетка и приглушение моря по краям (градиенты на canvas), сверху и снизу — затемнение под текст. */
  private drawVignette(): void {
    const { width: w, height: h } = this.scale;
    this.vignetteKey = `menu_vignette_${w}x${h}_${Date.now()}`;
    const tex = this.textures.createCanvas(this.vignetteKey, w, h)!;
    const ctx = tex.getContext();
    const toRgba = (color: number) => {
      const c = Phaser.Display.Color.IntegerToColor(color);
      return (a: number) => `rgba(${c.red},${c.green},${c.blue},${a})`;
    };
    const rgba = toRgba(MENU.dimColor);
    const haze = toRgba(FOG.color);
    // эллипсы по пропорциям экрана: у острова чисто, дальше море уходит в светлую дымку, углы темнее
    const radial = (stops: [number, string][]) => {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(w / Math.max(w, h), h / Math.max(w, h));
      const r = Math.max(w, h) * 0.72;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      for (const [at, c] of stops) g.addColorStop(at, c);
      ctx.fillStyle = g;
      ctx.fillRect(-r * 2, -r * 2, r * 4, r * 4);
      ctx.restore();
    };
    radial([[0, haze(0)], [0.38, haze(0)], [0.75, haze(MENU.hazeAlpha * 0.8)], [1, haze(MENU.hazeAlpha)]]);
    radial([[0, rgba(0)], [0.4, rgba(MENU.dimAlpha * 0.5)], [0.75, rgba(MENU.dimAlpha)], [1, rgba(MENU.vignetteAlpha)]]);
    const top = ctx.createLinearGradient(0, 0, 0, h * 0.28);
    top.addColorStop(0, rgba(0.35));
    top.addColorStop(1, rgba(0));
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.28);
    const bottom = ctx.createLinearGradient(0, h * 0.6, 0, h);
    bottom.addColorStop(0, rgba(0));
    bottom.addColorStop(1, rgba(0.4));
    ctx.fillStyle = bottom;
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
    tex.refresh();
    this.add.image(0, 0, this.vignetteKey).setOrigin(0);
  }

  private buildTitle(intro: boolean): void {
    const { width, height } = this.scale;
    const k = this.k;
    const title = label(this, width / 2, Math.round(height * 0.06 + 18 * k), GAME_TITLE, 60 * k).setOrigin(0.5, 0).setFontStyle('bold');
    title.setShadow(0, Math.round(5 * k), 'rgba(0,0,0,0.45)', 0, true, true);
    const sub = label(this, width / 2, title.y + title.height + 4 * k, SUBTITLE, 18 * k, COLOR.idle).setOrigin(0.5, 0).setAlpha(0.9);
    sub.setLetterSpacing(Math.round(2 * k));
    this.ui.add([title, sub]);
    if (intro) {
      for (const t of [title, sub]) {
        const a = t === sub ? 0.9 : 1;
        t.setAlpha(0).y -= 8 * k;
        this.tweens.add({ targets: t, alpha: a, y: t.y + 8 * k, delay: MENU.intro.titleDelayMs + (t === sub ? 250 : 0), duration: MENU.intro.titleMs, ease: 'Sine.easeOut' });
      }
    }
  }

  /** Пункты меню: «Продолжить» есть только при сохранении, «Выход» — только вне браузера. */
  private buildList(intro: boolean): void {
    const { height } = this.scale;
    const k = this.k;
    const items: MenuListItem[] = [];
    if (this.saved) {
      const d = this.saved.data;
      items.push({ label: 'Продолжить', sub: `ход ${d.turn + 1} · отрядов: ${d.squads.length}`, run: () => this.startCampaign(this.saved!) });
    }
    items.push({
      label: 'Новая кампания',
      run: () => {
        if (this.saved) this.confirm('Начать новую кампанию?\nТекущее сохранение будет потеряно.', () => this.startCampaign(Campaign.create()));
        else this.startCampaign(Campaign.create());
      },
    });
    items.push({ label: 'Быстрый бой', run: () => this.leave('Battle', { returnTo: 'Results', difficulty: 1 }) });
    items.push({ label: 'Настройки', run: () => this.openSettings(true) });
    if (isDesktopApp()) items.push({ label: 'Выход', run: () => window.close() });
    const opts = {
      k, ...(intro ? { introDelay: MENU.intro.itemsDelayMs, introStagger: MENU.intro.staggerMs, introMs: MENU.intro.itemMs } : {}),
    };
    const y = Math.round(height - 70 * k - MenuList.height(items, opts));
    this.list = new MenuList(this, Math.round(64 * k), y, items, opts);
    this.ui.add(this.list.root);
  }

  private buildFooter(intro: boolean): void {
    const { width, height } = this.scale;
    const t = label(this, width - 16 * this.k, height - 12 * this.k, `${MENU.version}   графика: Tiny Swords (Pixel Frog)`, 13 * this.k, COLOR.idle)
      .setOrigin(1, 1).setAlpha(0.6);
    this.ui.add(t);
    if (intro) {
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 0.6, delay: MENU.intro.itemsDelayMs, duration: 600 });
    }
  }

  /** Список слушает мышь только в главном режиме (не во вступлении, не под настройками/подтверждением). */
  private syncList(): void {
    this.list.enabled = this.mode === 'main' && !this.settingsPanel && !this.confirmBox;
  }

  private onKey(e: KeyboardEvent): void {
    sfx.unlock();
    if (this.confirmBox) { this.confirmBox.handleKey(e); return; }
    if (this.settingsPanel) { this.settingsPanel.handleKey(e); return; }
    if (this.mode === 'main') this.list.handleKey(e);
  }

  // ------------------------------------------------------------------ окна

  private openSettings(animate: boolean, row = 0): void {
    if (this.settingsPanel) return;
    this.settingsPanel = new SettingsPanel(this, {
      k: this.k, row, animate, allowResetSave: true,
      onSaveReset: () => this.scene.restart({ skipIntro: true, settingsRow: this.settingsPanel?.row ?? 0 }),
      onClose: () => { this.settingsPanel = null; this.syncList(); },
    });
    this.syncList();
  }

  private confirm(question: string, yes: () => void): void {
    this.confirmBox = new ConfirmBox(this, question, (ok) => {
      this.confirmBox = null;
      this.syncList();
      if (ok) yes();
    }, this.k, 800);
    this.syncList();
  }

  // ------------------------------------------------------------------ переходы

  private startCampaign(c: Campaign): void {
    c.save();
    this.registry.set('campaign', c);
    this.leave('Campaign');
  }

  /** Интерфейс гаснет, фон наезжает на остров и уходит в чёрное. */
  private leave(target: string, data?: object): void {
    if (this.mode === 'leaving') return;
    this.mode = 'leaving';
    this.syncList();
    this.tweens.add({ targets: [this.ui, this.settingsPanel?.root].filter(Boolean), alpha: 0, duration: MENU.exit.uiFadeMs });
    (this.scene.get('Menu') as MenuScene).leave(target, data);
  }
}

/** Пункт «Выход» нужен только в настольной сборке (в браузере закрыть вкладку нельзя). */
function isDesktopApp(): boolean {
  const w = window as unknown as { __TAURI__?: unknown; process?: { versions?: { electron?: string } } };
  return !!w.__TAURI__ || !!w.process?.versions?.electron || navigator.userAgent.includes('Electron');
}
