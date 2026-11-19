import Phaser from 'phaser';
import { CAMPAIGN, ECONOMY, HOUSE } from '../data/balance';
import { islandConditions, MISSIONS, WEATHER } from '../data/conditions';
import { CLASS_NAMES } from '../data/units';
import type { SquadDef } from '../entities/Squad';
import type { IslandNode } from '../mapgen/campaignMap';
import { generateIsland, type IslandData } from '../mapgen/IslandGenerator';
import { Campaign, ITEM_NAMES } from '../systems/CampaignState';
import { fxKey } from '../systems/AnimationRegistry';
import { sfx } from '../systems/Sound';
import { itemTexture } from './BattleHudScene';
import { COLOR, fadeToScene, label, MenuList, navKey, paper, PaperList, plate, restartOnResize, ribbonTitle, Tooltip, uiScale, type MenuListItem, type PaperItem } from './ui';

/** пикселей на клетку в миниатюре острова: подбирается под размер колонки и ряда карты */
let CELL = 3;
/** Цвета миниатюры по уровню — как тайлсеты боя: низина оливковая, плато зелёное, терраса светлая. */
const LEVEL_COLOR = [0, 0xa3a94e, 0x5f9e3c, 0x9cc24f];
/** Типичный размер суши острова в клетках (по нему считается масштаб миниатюр). */
const LAND_W = 26, LAND_H = 19;
/** Окно подготовки к бою: предпросмотр острова слева. */
const PREP = { maxW: 900, previewH: 300, narrow: 760 };
/** Раскладка карты при масштабе ×1, px: поля, высота верхней и нижней полос, ширина карточки отряда. */
const L = { margin: 16, top: 84, bottom: 150, squadW: 150 };
/** Виньетка по краям моря (как в главном меню). */
const VIGNETTE = { color: '11,26,34', alpha: 0.5 };

/** Монеты за все здания острова. */
function islandCoins(island: IslandData): number {
  return island.houses.reduce((a, hs) => a + (hs.kind === 'barracks' ? HOUSE.barracksCoins : HOUSE.coinsByVariant[hs.variant] ?? 0), 0);
}

/**
 * Карта кампании в стиле главного меню: море с виньеткой, архипелаг слева направо, шторм наступает сзади.
 * Слева вверху — монеты и ход, внизу слева — текстовый список действий кампании, справа — отряды.
 * Клик по светящемуся острову — окно подготовки: предпросмотр острова и выбор отрядов.
 */
export class CampaignScene extends Phaser.Scene {
  private campaign!: Campaign;
  private k = 1;
  private modal: Phaser.GameObjects.Container | null = null;
  private prepList: PaperList | null = null;
  private list: MenuList | null = null;
  private mapRect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly nodeDims = new Map<number, { w: number; h: number }>();
  private tip!: Tooltip;
  private vignetteKey = '';

  constructor() {
    super('Campaign');
  }

  create(): void {
    const c = (this.registry.get('campaign') as Campaign | undefined) ?? Campaign.load();
    if (!c) {
      this.scene.start('Menu');
      return;
    }
    this.campaign = c;
    this.registry.set('campaign', c);
    this.modal = null;
    this.prepList = null;
    this.list = null;
    this.nodeDims.clear();
    if (c.data.outcome !== 'playing') {
      this.scene.start('Results', { final: true });
      return;
    }
    sfx.startAmbience('calm');
    const { width, height } = this.scale;
    const k = (this.k = uiScale(this));
    this.add.tileSprite(0, 0, width, height, 'water_bg').setOrigin(0);
    this.drawVignette();
    this.mapRect = { x: 30 * k, y: (L.top + 20) * k, w: width - 60 * k, h: height - (L.top + L.bottom + 40) * k };
    const colW = (this.mapRect.w * CAMPAIGN.mapSpreadX) / (CAMPAIGN.columns + 1);
    const rowH = (this.mapRect.h * CAMPAIGN.mapSpreadY) / 3;
    CELL = Phaser.Math.Clamp(Math.floor(Math.min((colW * 0.8) / LAND_W, (rowH * 0.8) / LAND_H)), 1, CAMPAIGN.mapCellMax * k);
    this.tip = new Tooltip(this, k, 1000);
    this.drawMap();
    this.drawTopBar();
    this.drawBottomBar();
    restartOnResize(this);
    this.cameras.main.fadeIn(250, 0, 0, 0);

    this.input.keyboard?.on('keydown', this.onKey, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', this.onKey, this);
      sfx.stopAmbience();
      this.scene.stop('IslandPreview');
      if (this.vignetteKey && this.textures.exists(this.vignetteKey)) this.textures.remove(this.vignetteKey);
    });
  }

  /** Esc — закрыть окно подготовки, иначе в главное меню (кампания сохраняется сама); стрелки и Enter — по спискам. */
  private onKey(e: KeyboardEvent): void {
    sfx.unlock();
    if (this.modal) {
      if (navKey(e) === 'esc') this.closePrep();
      else this.prepList?.handleKey(e);
      return;
    }
    if (navKey(e) === 'esc') fadeToScene(this, 'Menu');
    else this.list?.handleKey(e);
  }

  /** Тёмные края моря, как в главном меню (радиальный градиент на canvas). */
  private drawVignette(): void {
    const { width: w, height: h } = this.scale;
    this.vignetteKey = `campaign_vignette_${w}x${h}_${Date.now()}`;
    const tex = this.textures.createCanvas(this.vignetteKey, w, h)!;
    const ctx = tex.getContext();
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / Math.max(w, h), h / Math.max(w, h));
    const r = Math.max(w, h) * 0.75;
    const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r);
    g.addColorStop(0, `rgba(${VIGNETTE.color},0)`);
    g.addColorStop(1, `rgba(${VIGNETTE.color},${VIGNETTE.alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(-r * 2, -r * 2, r * 4, r * 4);
    tex.refresh();
    this.add.image(0, 0, this.vignetteKey).setOrigin(0);
  }

  /** Позиция острова: архипелаг сжат к центру поля (mapSpread), чтобы острова стояли ближе друг к другу. */
  private nodePos(n: IslandNode): { x: number; y: number } {
    const r = this.mapRect;
    return {
      x: r.x + (0.5 + (n.x - 0.5) * CAMPAIGN.mapSpreadX) * r.w,
      y: r.y + (0.5 + (n.y - 0.5) * CAMPAIGN.mapSpreadY) * r.h,
    };
  }

  /** x левой границы колонки col (дробной — для шторма) с учётом сжатия архипелага. */
  private colX(col: number): number {
    const r = this.mapRect;
    const nx = col / (CAMPAIGN.columns + 1);
    return r.x + (0.5 + (nx - 0.5) * CAMPAIGN.mapSpreadX) * r.w;
  }

  private drawMap(): void {
    const c = this.campaign;
    const d = c.data;
    const k = this.k;
    const available = new Set(c.available().map((n) => n.id));
    const links = this.add.graphics();
    for (const n of d.nodes) {
      const a = this.nodePos(n);
      for (const id of n.links) {
        const b = this.nodePos(c.node(id));
        const used = n.state === 'done' && c.node(id).state === 'done';
        links.lineStyle(3 * k, used ? 0xffe9a8 : 0xffffff, used ? 0.9 : 0.35);
        // пунктир
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = 0; t < len; t += 14 * k) {
          const t2 = Math.min(len, t + 8 * k);
          links.lineBetween(a.x + ((b.x - a.x) * t) / len, a.y + ((b.y - a.y) * t) / len, a.x + ((b.x - a.x) * t2) / len, a.y + ((b.y - a.y) * t2) / len);
        }
      }
    }
    for (const n of d.nodes) this.drawNode(n, available.has(n.id));

    // шторм
    if (d.stormCol > 0.01) {
      const stormX = this.colX(d.stormCol);
      const g = this.add.graphics();
      g.fillStyle(0x1a2333, 0.62).fillRect(0, 0, stormX, this.scale.height);
      for (let i = 0; i < 5; i++) {
        const cl = this.add.image(stormX - 40 * k, this.mapRect.y + (i / 4) * this.mapRect.h, `cloud${(i % 8) + 1}`)
          .setScale(0.5 * k).setTint(0x556070).setAlpha(0.9);
        this.tweens.add({ targets: cl, x: cl.x + 18 * k, duration: 2500 + i * 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      label(this, Math.max(70 * k, stormX - 70 * k), this.mapRect.y - 10 * k, 'Шторм', 18 * k, '#c8d4e6').setOrigin(0.5);
    }

    this.drawPlayerBoat();
  }

  /** Точка в море у острова, со стороны направления движения. */
  private boatAnchor(n: IslandNode, dir: { x: number; y: number }): { x: number; y: number } {
    const p = this.nodePos(n);
    const dim = this.nodeDims.get(n.id) ?? { w: 80 * this.k, h: 56 * this.k };
    return {
      x: p.x - dir.x * (dim.w / 2 + 30 * this.k),
      y: p.y - dir.y * (dim.h / 2 + 22 * this.k),
    };
  }

  /** Корабль игрока стоит в море у текущего острова; после победы доплывает от прежнего острова к новому. */
  private drawPlayerBoat(): void {
    const d = this.campaign.data;
    const k = this.k;
    const current = d.current !== null ? this.campaign.node(d.current) : null;
    const fromId = this.registry.get('campaignBoatFrom') as number | null | undefined;
    this.registry.remove('campaignBoatFrom');
    let at = { x: this.colX(0) - 54 * k, y: this.mapRect.y + this.mapRect.h / 2 };
    let to: { x: number; y: number } | null = null;
    let dir = { x: 1, y: 0 };
    if (current) {
      const previous = fromId !== null && fromId !== undefined && fromId !== current.id ? this.campaign.node(fromId) : null;
      if (previous) {
        const a = this.nodePos(previous), b = this.nodePos(current);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        at = this.boatAnchor(previous, dir);
        to = this.boatAnchor(current, dir);
      } else {
        at = this.boatAnchor(current, dir);
      }
    }
    const boat = this.add.sprite(0, 0, 'boat').setScale(0.22 * k).setFlipX(dir.x < 0);
    boat.play(fxKey('boat'));
    const flag = this.add.graphics();
    flag.fillStyle(0x3d2718, 1).fillRect(-2 * k, -34 * k, 3 * k, 30 * k);
    flag.fillStyle(0x3d7bd6, 1).fillTriangle(1 * k, -34 * k, 1 * k, -20 * k, 20 * k, -27 * k);
    const root = this.add.container(at.x, at.y, [boat, flag]).setDepth(20);
    const bob = () => this.tweens.add({ targets: root, y: root.y - 4 * k, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (to) {
      sfx.play('splash', 0.35);
      this.tweens.add({ targets: root, x: to.x, y: to.y, duration: 1100, ease: 'Sine.easeInOut', onComplete: bob });
    } else {
      bob();
    }
  }

  private drawNode(n: IslandNode, isAvailable: boolean): void {
    const k = this.k;
    const p = this.nodePos(n);
    const island = generateIsland(n.seed);
    const g = island.grid;
    // миниатюра по границам суши (не всей карты с морем), центр — в точке острова
    let bx0 = g.w, by0 = g.h, bx1 = 0, by1 = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (g.getLevel(x, y) < 1 && !g.cliffLevel(x, y)) continue;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x + 1); by0 = Math.min(by0, y); by1 = Math.max(by1, y + 1);
    }
    const w = (bx1 - bx0) * CELL, h = (by1 - by0) * CELL;
    this.nodeDims.set(n.id, { w, h });
    const foam = Math.max(1, Math.round(CELL * 0.6));
    const ox = Math.round(p.x - w / 2) - bx0 * CELL, oy = Math.round(p.y - h / 2) - by0 * CELL;
    const box = { x: ox + bx0 * CELL, y: oy + by0 * CELL };
    const gr = this.add.graphics();
    // пена
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (g.getLevel(x, y) >= 1 || g.cliffLevel(x, y)) gr.fillStyle(0xd8f3ea, 1).fillRect(ox + x * CELL - foam, oy + y * CELL - foam, CELL + foam * 2, CELL + foam * 2);
    }
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const lv = g.getLevel(x, y);
      if (g.cliffLevel(x, y) && !g.stairAt(x, y)) gr.fillStyle(0x56756f, 1).fillRect(ox + x * CELL, oy + y * CELL, CELL, CELL);
      else if (lv >= 1) gr.fillStyle(LEVEL_COLOR[Math.min(lv, 3)], 1).fillRect(ox + x * CELL, oy + y * CELL, CELL, CELL);
    }
    for (const hs of island.houses) gr.fillStyle(0x3d7bd6, 1).fillRect(ox + hs.x * CELL, oy + (hs.y - 1) * CELL, CELL * hs.width, CELL * 2);
    if (n.state === 'stormed') gr.setAlpha(0.35);
    if (n.state === 'done') gr.setAlpha(0.75);
    const fogged = this.isFogged(n);
    if (fogged) {
      // остров ещё не разведан — под туманом видно лишь смутный силуэт
      gr.setAlpha(0.18);
      for (let i = 0; i < 2; i++) {
        const c = this.add.image(p.x + (i ? 18 : -14) * k, p.y + (i ? 6 : -6) * k, `cloud${((n.id + i) % 8) + 1}`)
          .setTint(0xdce8ec).setAlpha(0.92).setScale(Math.max(0.2, (w + 20 * k) / 576));
        this.tweens.add({ targets: c, x: c.x + (i ? -10 : 10) * k, duration: 3000 + n.id * 137 % 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }

    if (isAvailable) {
      const ring = this.add.graphics();
      ring.lineStyle(3 * k, 0xffe14a, 1).strokeRoundedRect(box.x - 8 * k, box.y - 8 * k, w + 16 * k, h + 16 * k, 10 * k);
      this.tweens.add({ targets: ring, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
    }
    const zone = this.add.zone(box.x - 8 * k, box.y - 8 * k, w + 16 * k, h + 16 * k).setOrigin(0).setInteractive({ useHandCursor: isAvailable });
    if (isAvailable) zone.on('pointerdown', () => { if (!this.modal) { sfx.play('click', 0.6); this.openPrep(n); } });
    zone.on('pointerover', () => {
      if (this.modal) return;
      let lines: string[];
      if (fogged) lines = ['Остров скрыт туманом', 'откроется, когда подойдёте ближе'];
      else {
        lines = [n.isFinal ? 'Финальный остров' : `Опасность ${n.difficulty + 1}`, `домов: ${island.houses.length} (до ${islandCoins(island)} монет)`];
        const conditions = islandConditions(n.seed, n.difficulty, n.isFinal);
        if (conditions.weather !== 'clear') lines.push(`погода: ${WEATHER[conditions.weather].name.toLowerCase()}`);
        if (conditions.mission !== 'defense') lines.push(`задание: ${MISSIONS[conditions.mission].name.toLowerCase()}`);
        if (n.reward === 'item' && n.item) lines.push(`награда: ${ITEM_NAMES[n.item]}`);
        if (n.reward === 'recruit') lines.push('награда: новый отряд');
        lines.push(n.state === 'done' ? 'остров отстоян' : n.state === 'stormed' ? 'поглощён штормом' : isAvailable ? 'клик — подготовка к бою' : 'пока недоступен');
      }
      this.tip.show(p.x, box.y - 6 * k, lines);
    });
    zone.on('pointerout', () => this.tip.hide());
    // Под каждым разведанным островом — звёзды сложности; статус и финал подписываем строкой ниже.
    if (!fogged) {
      const count = Math.min(6, n.difficulty + 1);
      const stars = this.add.graphics();
      const color = n.isFinal ? 0xe26d5a : n.state === 'stormed' ? 0x87969c : 0xffd84a;
      stars.fillStyle(color, n.state === 'open' ? 1 : 0.65);
      stars.lineStyle(Math.max(1, k), 0x3d2718, 0.8);
      for (let i = 0; i < count; i++) {
        const cx = p.x + (i - (count - 1) / 2) * 13 * k, cy = box.y + h + 8 * k;
        stars.beginPath();
        for (let j = 0; j < 10; j++) {
          const angle = -Math.PI / 2 + j * Math.PI / 5;
          const r = (j % 2 ? 2.4 : 5.5) * k;
          const x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
          if (j === 0) stars.moveTo(x, y); else stars.lineTo(x, y);
        }
        stars.closePath().fillPath().strokePath();
      }
    }
    const text = fogged ? '???' : n.isFinal ? 'Финал' : n.state === 'done' ? 'отстоян' : n.state === 'stormed' ? 'потерян' : '';
    if (text) label(this, p.x, box.y + h + 20 * k, text, 13 * k, n.isFinal ? COLOR.red : isAvailable ? COLOR.light : COLOR.idle).setOrigin(0.5, 0);
    if (n.state === 'open' && !fogged) {
      if (n.reward === 'item' && n.item) this.add.image(box.x + w - 4 * k, box.y + 4 * k, itemTexture(n.item)).setScale((n.item === 'bomb' ? 0.6 : 0.4) * k);
      if (n.reward === 'recruit') this.add.image(box.x + w - 4 * k, box.y + 4 * k, 'avatar_20').setScale(0.16 * k);
      if (n.isFinal) this.add.image(box.x + w / 2, box.y - 12 * k, 'enemy_avatar_08').setScale(0.22 * k);
    }
  }

  /** Разведано: колонки до следующей за самой дальней пройденной; финал виден всегда. */
  private isFogged(n: IslandNode): boolean {
    if (n.isFinal || n.state !== 'open') return false;
    const done = this.campaign.data.nodes.filter((x) => x.state === 'done');
    const reach = done.length ? Math.max(...done.map((x) => x.col)) + 1 : 1;
    return n.col > reach;
  }

  /** Слева вверху: монеты, ход, отряды; по центру — что делать (или предупреждение о шторме). */
  private drawTopBar(): void {
    const d = this.campaign.data;
    const k = this.k, m = L.margin * k;
    const bg = this.add.graphics();
    const coins = label(this, m + 40 * k, m + 22 * k, String(d.coins), 24 * k, COLOR.gold).setOrigin(0, 0.5);
    const info = label(this, coins.x + coins.width + 18 * k, m + 22 * k, `ход ${d.turn + 1}  ·  отрядов ${d.squads.length}/${ECONOMY.maxRoster}`, 16 * k, COLOR.light).setOrigin(0, 0.5);
    // пластина создана раньше подписей — лежит под ними
    plate(bg, m, m, info.x + info.width - m + 16 * k, 44 * k);
    this.add.image(m + 20 * k, m + 22 * k, 'icon_03').setScale(0.5 * k);

    const left = this.campaign.available().filter((n) => n.col < Math.floor(d.stormCol + CAMPAIGN.stormSpeed + 0.001) && !n.isFinal).length;
    const promptY = this.scale.width < 760 * k ? m + 66 * k : m + 22 * k;
    label(this, this.scale.width / 2, promptY, left ? `Шторм поглотит ${left} остр. в следующий ход` : 'Выберите остров', 20 * k, left ? COLOR.red : COLOR.light)
      .setOrigin(0.5);
  }

  /** Внизу слева — текстовый список (как в главном меню), справа — отряды на тёмной пластине. */
  private drawBottomBar(): void {
    const { width, height } = this.scale;
    const d = this.campaign.data;
    const k = this.k, m = L.margin * k;
    const items: MenuListItem[] = [
      { label: 'Отряды', run: () => fadeToScene(this, 'Upgrade') },
      {
        label: 'Отдохнуть',
        sub: 'пропустить ход · шторм наступит',
        run: () => { this.campaign.rest(); this.scene.restart(); },
      },
      { label: 'Главное меню', run: () => fadeToScene(this, 'Menu') },
    ];
    const opts = { k, size: 24, gap: 40, subSize: 13 };
    const listH = MenuList.height(items, opts);
    const listY = height - m - listH - 18 * k;
    const lbg = this.add.graphics();
    plate(lbg, m, listY - 22 * k, 280 * k, listH + 40 * k, 0.55);
    this.list = new MenuList(this, m + 36 * k, listY, items, opts);

    // отряды справа: портрет, имя, класс, готов/отдыхает, предмет
    const sx0 = m + 300 * k;
    const entryW = L.squadW * k;
    const fit = Math.max(1, Math.floor((width - m - sx0) / entryW));
    const shown = d.squads.slice(0, fit);
    const rowH = 64 * k;
    const sy = height - m - rowH;
    const sw = Math.min(width - m - sx0, shown.length * entryW + 12 * k);
    const sbg = this.add.graphics();
    plate(sbg, width - m - sw, sy, sw, rowH, 0.5);
    let x = width - m - sw + 10 * k;
    for (const sq of shown) {
      const resting = d.resting.includes(sq.id) && this.campaign.readySquads().length !== d.squads.length;
      this.add.image(x + 22 * k, sy + rowH / 2, `avatar_${String(sq.avatar).padStart(2, '0')}`).setScale((44 * k) / 256).setAlpha(resting ? 0.5 : 1);
      label(this, x + 50 * k, sy + 8 * k, sq.name, 14 * k, COLOR.light);
      label(this, x + 50 * k, sy + 26 * k, `${CLASS_NAMES[sq.cls]}${sq.level ? ` ур.${sq.level}` : ''}`, 12 * k, COLOR.idle);
      label(this, x + 50 * k, sy + 42 * k, resting ? 'отдыхает' : 'готов', 12 * k, resting ? COLOR.red : COLOR.green);
      if (sq.item) this.add.image(x + 40 * k, sy + rowH - 12 * k, itemTexture(sq.item)).setScale((sq.item === 'bomb' ? 0.5 : 0.3) * k);
      x += entryW;
    }
    const notes: string[] = [];
    if (d.squads.length > shown.length) notes.push(`ещё отрядов: ${d.squads.length - shown.length}`);
    if (d.items.length) notes.push(`на складе: ${d.items.map((i) => ITEM_NAMES[i]).join(', ')}`);
    if (notes.length) label(this, width - m, sy - 8 * k, notes.join('  ·  '), 13 * k, COLOR.idle).setOrigin(1, 1);
  }

  /**
   * Окно подготовки к бою на бумаге: слева — как выглядит остров (сцена IslandPreview в окошке), справа —
   * награда и выбор до 3 отрядов галочками, внизу — «Отмена» / «В бой». В узком окне предпросмотр сверху.
   */
  private openPrep(n: IslandNode): void {
    this.tip.hide();
    if (this.list) this.list.enabled = false;
    const { width, height } = this.scale;
    const k = this.k;
    const c = this.campaign;
    const ready = c.readySquads();
    const wide = width >= PREP.narrow * k;
    const w = Math.min(PREP.maxW * k, width - 20 * k);
    const rowH = 34 * k;
    const listH = 156 * k + Math.max(1, c.data.squads.length) * rowH + 70 * k;
    const pw = wide ? Math.round(w * 0.5) : w - 44 * k;
    const ph = wide ? Math.max(PREP.previewH * k, listH - 130 * k) : Math.min(PREP.previewH * k, Math.round(height * 0.3));
    const h = Math.min(height - 56 * k, wide ? Math.max(70 * k + ph + 70 * k, listH) : 70 * k + ph + listH - 30 * k);
    const x = Math.round((width - w) / 2), y = Math.max(46 * k, Math.round((height - h) / 2));
    const root = this.add.container(0, 0).setDepth(500);
    this.modal = root;
    const shade = this.add.rectangle(0, 0, width, height, 0x000000, 0.5).setOrigin(0).setInteractive();
    root.add([shade, paper(this, x, y, w, h)]);
    const island = generateIsland(n.seed);
    root.add(ribbonTitle(this, width / 2, y + 4 * k, Math.min(w + 40 * k, width - 10), n.isFinal ? 'Финальный остров' : `Остров · опасность ${n.difficulty + 1}`, n.isFinal ? 'red' : 'blue', 22 * k));

    // предпросмотр острова
    const prev = { x: x + 22 * k, y: y + 66 * k, w: pw, h: ph };
    this.scene.launch('IslandPreview', { seed: n.seed, rect: prev });
    this.scene.bringToTop('IslandPreview');
    root.add(label(this, prev.x, prev.y + prev.h + 10 * k, `домов ${island.houses.length} (до ${islandCoins(island)} монет) · высадок ${island.landings.length}`, 13 * k, COLOR.darkSoft, false));

    // условия, награда и отряды
    const lx = wide ? prev.x + pw + 40 * k : x + 44 * k;
    let ly = wide ? y + 74 * k : prev.y + prev.h + 44 * k;
    const reward = n.reward === 'item' && n.item ? `Награда: ${ITEM_NAMES[n.item]}` : n.reward === 'recruit' ? 'Награда: новый отряд' : '';
    if (reward) { root.add(label(this, lx - 16 * k, ly, reward, 15 * k, COLOR.dark, false).setFontStyle('bold')); ly += 26 * k; }
    const conditions = islandConditions(n.seed, n.difficulty, n.isFinal);
    const weather = WEATHER[conditions.weather], mission = MISSIONS[conditions.mission];
    root.add(label(this, lx - 16 * k, ly, `Погода: ${weather.name}${weather.effect ? ` — ${weather.effect}` : ''}`, 13 * k, COLOR.darkSoft, false));
    ly += 24 * k;
    root.add(label(this, lx - 16 * k, ly, `Задание: ${mission.description}${mission.bonus ? ` · +${mission.bonus}` : ''}`, 13 * k, COLOR.darkSoft, false));
    ly += 30 * k;
    root.add(label(this, lx - 16 * k, ly, `Отряды в бой (до ${ECONOMY.maxSquadsInBattle}):`, 15 * k, COLOR.darkSoft, false));
    ly += 36 * k;

    const chosen = new Set<number>(ready.slice(0, ECONOMY.maxSquadsInBattle).map((s) => s.id));
    const items: PaperItem[] = [];
    const squadItems: { sq: SquadDef; item: PaperItem }[] = [];
    const by = y + h - 36 * k;
    const go: PaperItem = {
      label: 'В бой', x: x + w - 130 * k, y: by, size: 22, enabled: chosen.size > 0,
      run: () => this.startBattle(n, c.data.squads.filter((s) => chosen.has(s.id))),
    };
    const cancel: PaperItem = { label: 'Отмена', x: x + w - 290 * k, y: by, size: 22, run: () => this.closePrep() };
    c.data.squads.forEach((sq, i) => {
      const isReady = ready.includes(sq);
      const item: PaperItem = {
        label: `${sq.name} — ${CLASS_NAMES[sq.cls]}${sq.level ? ` ур.${sq.level}` : ''}${isReady ? '' : ' (отдыхает)'}`,
        x: lx, y: ly + i * rowH, size: 16, checkbox: true, checked: chosen.has(sq.id), enabled: isReady,
        run: () => {
          if (chosen.has(sq.id)) chosen.delete(sq.id);
          else if (chosen.size < ECONOMY.maxSquadsInBattle) chosen.add(sq.id);
          for (const s of squadItems) s.item.checked = chosen.has(s.sq.id);
          go.enabled = chosen.size > 0;
          this.prepList?.refresh();
        },
      };
      items.push(item);
      squadItems.push({ sq, item });
    });
    items.push(cancel, go);
    this.prepList = new PaperList(this, items, k);
    root.add(this.prepList.root);
    // по умолчанию выбрано «В бой»: Enter сразу начинает бой
    this.prepList.select(items.length - 1, false);
  }

  private closePrep(): void {
    this.scene.stop('IslandPreview');
    this.prepList = null;
    this.modal?.destroy();
    this.modal = null;
    if (this.list) this.list.enabled = true;
  }

  private startBattle(n: IslandNode, squads: SquadDef[]): void {
    if (!squads.length) return;
    this.scene.stop('IslandPreview');
    this.registry.set('campaignBoatFrom', this.campaign.data.current);
    this.registry.set('pendingNode', n.id);
    this.scene.start('Battle', {
      seed: n.seed,
      squads: squads.map((s) => ({ ...s })),
      difficulty: n.difficulty,
      isFinal: n.isFinal,
      coins: this.campaign.data.coins,
      returnTo: 'Results',
    });
  }
}
