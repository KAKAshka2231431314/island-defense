import Phaser from 'phaser';
import { sfx } from '../../systems/Sound';

export const UI = {
  wood: 0x5b3b26,
  woodDark: 0x3d2718,
  trim: 0xe9c78a,
  paper: 0xf1e3c2,
  text: '#fff4dc',
  textDark: '#3d2718',
  gold: '#ffd84a',
  red: 0xe0483c,
  green: 0x63d66a,
  font: 'monospace',
} as const;

/** Нарисовать деревянную панель в стиле Tiny Swords. */
export function drawPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, highlight = false): void {
  g.fillStyle(0x000000, 0.35).fillRoundedRect(x + 3, y + 4, w, h, 8);
  g.fillStyle(UI.woodDark, 1).fillRoundedRect(x, y, w, h, 8);
  g.fillStyle(UI.wood, 1).fillRoundedRect(x + 3, y + 3, w - 6, h - 6, 6);
  g.lineStyle(2, highlight ? 0xffe14a : UI.trim, highlight ? 1 : 0.8).strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, 7);
}

type Cut = [number, number][];
const GRID64: Cut = [[0, 64], [128, 64], [256, 64]];

/**
 * Растягиваемые панели пака. В исходниках 9 кусков разложены по сетке с промежутками — склеиваем их вплотную.
 * mar — прозрачные поля склеенной текстуры (l, r, t, b), чтобы видимая часть совпала с запрошенным прямоугольником.
 */
const SLICES = {
  paper: { src: 'ui_paper', cols: GRID64, rows: GRID64, mar: [12, 12, 20, 20] },
  special: { src: 'ui_paper_special', cols: GRID64, rows: GRID64, mar: [9, 9, 20, 21] },
  wood: { src: 'ui_wood', cols: [[44, 84], [192, 64], [320, 84]] as Cut, rows: [[43, 85], [196, 60], [320, 103]] as Cut, mar: [0, 0, 0, 0] },
  scroll: { src: 'ui_banner', cols: [[28, 100], [192, 64], [320, 84]] as Cut, rows: [[60, 68], [192, 64], [320, 111]] as Cut, mar: [0, 0, 0, 0] },
  btn: { src: 'ui_btn_blue', cols: GRID64, rows: GRID64, mar: [19, 19, 17, 17] },
  btn_p: { src: 'ui_btn_blue_p', cols: GRID64, rows: GRID64, mar: [19, 19, 17, 17] },
  btn_red: { src: 'ui_btn_red', cols: GRID64, rows: GRID64, mar: [19, 19, 17, 17] },
  btn_red_p: { src: 'ui_btn_red_p', cols: GRID64, rows: GRID64, mar: [19, 19, 17, 17] },
} as const;
export type SliceKind = keyof typeof SLICES;

/** Склеить 9-slice текстуры панелей и кнопок, 3-slice полосы здоровья и её светлую (тонируемую) заливку. */
export function buildNineSliceTextures(scene: Phaser.Scene): void {
  for (const [kind, s] of Object.entries(SLICES)) {
    const key = `nine_${kind}`;
    if (scene.textures.exists(key) || !scene.textures.exists(s.src)) continue;
    const img = scene.textures.get(s.src).getSourceImage() as HTMLImageElement;
    const w = s.cols.reduce((a, [, cw]) => a + cw, 0), h = s.rows.reduce((a, [, rh]) => a + rh, 0);
    const tex = scene.textures.createCanvas(key, w, h)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    let dy = 0;
    for (const [sy, rh] of s.rows) {
      let dx = 0;
      for (const [sx, cw] of s.cols) { ctx.drawImage(img, sx, sy, cw, rh, dx, dy, cw, rh); dx += cw; }
      dy += rh;
    }
    tex.refresh();
  }
  if (!scene.textures.exists('bar_base') && scene.textures.exists('ui_bigbar_base')) {
    const img = scene.textures.get('ui_bigbar_base').getSourceImage() as HTMLImageElement;
    const tex = scene.textures.createCanvas('bar_base', 192, 64)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    GRID64.forEach(([sx], i) => ctx.drawImage(img, sx, 0, 64, 64, i * 64, 0, 64, 64));
    tex.refresh();
  }
  if (!scene.textures.exists('bar_fill') && scene.textures.exists('ui_bigbar_fill')) {
    // красная заливка пака → светлая, чтобы красить её tint'ом (зелёный/жёлтый/красный)
    const img = scene.textures.get('ui_bigbar_fill').getSourceImage() as HTMLImageElement;
    const tex = scene.textures.createCanvas('bar_fill', 64, 24)!;
    const ctx = tex.getContext();
    ctx.drawImage(img, 0, 20, 64, 24, 0, 0, 64, 24);
    const d = ctx.getImageData(0, 0, 64, 24);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.min(255, Math.round((d.data[i] * 0.5 + d.data[i + 1] * 0.35 + d.data[i + 2] * 0.15) * 1.25 + 40));
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    tex.refresh();
  }
  // тонкая полоса (SmallBar): рамка 3-slice, канал от 59 px с краёв; заливка — светлая линия в рядах 30–32
  if (!scene.textures.exists('sbar_base') && scene.textures.exists('ui_bar_base')) {
    const img = scene.textures.get('ui_bar_base').getSourceImage() as HTMLImageElement;
    const tex = scene.textures.createCanvas('sbar_base', 192, 64)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    GRID64.forEach(([sx], i) => ctx.drawImage(img, sx, 0, 64, 64, i * 64, 0, 64, 64));
    tex.refresh();
  }
  if (!scene.textures.exists('sbar_fill') && scene.textures.exists('ui_bar_fill')) {
    const img = scene.textures.get('ui_bar_fill').getSourceImage() as HTMLImageElement;
    const tex = scene.textures.createCanvas('sbar_fill', 64, 3)!;
    const ctx = tex.getContext();
    ctx.drawImage(img, 0, 30, 64, 3, 0, 0, 64, 3);
    // в светлые оттенки серого — чтобы tint давал чистый цвет
    const d = ctx.getImageData(0, 0, 64, 3);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.min(255, Math.round(d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11) + 60);
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    tex.refresh();
  }
}

/**
 * Панель пака, видимая часть которой занимает (x, y, w, h). scale < 1 делает рамку тоньше
 * (у дерева и свитка края широкие — для мелких плашек нужен scale 0.4–0.5).
 */
export function slice9(scene: Phaser.Scene, kind: SliceKind, x: number, y: number, w: number, h: number, scale = 1): Phaser.GameObjects.NineSlice {
  const s = SLICES[kind];
  const [ml, mr, mt, mb] = s.mar;
  const l = s.cols[0][1], r = s.cols[2][1], t = s.rows[0][1], b = s.rows[2][1];
  const W = Math.max(l + r, w / scale + ml + mr), H = Math.max(t + b, h / scale + mt + mb);
  return scene.add.nineslice(x - ml * scale, y - mt * scale, `nine_${kind}`, undefined, W, H, l, r, t, b).setOrigin(0).setScale(scale);
}

const tiledKeys: string[] = [];

/**
 * Панель, у которой середина и края не растягиваются, а повторяются плиткой (у дерева и свитка
 * растянутый узор превращается в полосы). Текстура собирается под размер и кэшируется.
 */
export function tiledPanel(scene: Phaser.Scene, kind: SliceKind, x: number, y: number, w: number, h: number, scale = 1): Phaser.GameObjects.Image {
  const s = SLICES[kind];
  const [ml, mr, mt, mb] = s.mar;
  const l = s.cols[0][1], r = s.cols[2][1], t = s.rows[0][1], b = s.rows[2][1];
  const W = Math.round(Math.max(l + r, w / scale + ml + mr)), H = Math.round(Math.max(t + b, h / scale + mt + mb));
  const key = `panel_${kind}_${W}x${H}`;
  if (!scene.textures.exists(key)) {
    const img = scene.textures.get(s.src).getSourceImage() as HTMLImageElement;
    const tex = scene.textures.createCanvas(key, W, H)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    const dx = [0, l, W - r], dw = [l, W - l - r, r];
    const dy = [0, t, H - b], dh = [t, H - t - b, b];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const [sx, cw] = s.cols[i], [sy, rh] = s.rows[j];
        for (let py = 0; py < dh[j]; py += rh) {
          for (let px = 0; px < dw[i]; px += cw) {
            const tw = Math.min(cw, dw[i] - px), th = Math.min(rh, dh[j] - py);
            ctx.drawImage(img, sx, sy, tw, th, dx[i] + px, dy[j] + py, tw, th);
          }
        }
      }
    }
    tex.refresh();
    tiledKeys.push(key);
    // старые размеры (после пересборки экранов при ресайзе) больше не нужны
    while (tiledKeys.length > 40) {
      const old = tiledKeys.shift()!;
      if (scene.textures.exists(old)) scene.textures.remove(old);
    }
  } else {
    const i = tiledKeys.indexOf(key);
    if (i >= 0) tiledKeys.splice(i, 1);
    tiledKeys.push(key);
  }
  return scene.add.image(x - ml * scale, y - mt * scale, key).setOrigin(0).setScale(scale);
}

/** Деревянная плашка (интерфейс боя, карточки, панели карты). */
export function woodPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, scale = 0.5): Phaser.GameObjects.Image {
  return tiledPanel(scene, 'wood', x, y, w, h, scale);
}

export interface Bar {
  root: Phaser.GameObjects.Container;
  set(frac: number, color: number): void;
}

/** Полоса здоровья пака: рамка-3-slice и тонируемая заливка. Видимая часть — (x, y, w, 51·scale). */
export function bigBar(scene: Phaser.Scene, x: number, y: number, w: number, scale = 0.4): Bar {
  const W = Math.max(128, w / scale + 80);
  const base = scene.add.nineslice(-40 * scale, -9 * scale, 'bar_base', undefined, W, 64, 64, 64, 0, 0).setOrigin(0).setScale(scale);
  const channel = (W - 102) * scale;
  const fill = scene.add.image(11 * scale, 11 * scale, 'bar_fill').setOrigin(0).setScale(channel / 64, scale);
  const root = scene.add.container(x, y, [base, fill]);
  return {
    root,
    set(frac, color) {
      const f = Phaser.Math.Clamp(frac, 0, 1);
      fill.setVisible(f > 0).setScale(Math.max(0.001, (channel * f) / 64), scale).setTint(color);
    },
  };
}

/** Цвет здоровья по доле. */
export function hpColor(f: number): number {
  return f > 0.5 ? UI.green : f > 0.25 ? 0xf0c040 : UI.red;
}

export type RibbonColor = 'blue' | 'red' | 'yellow' | 'purple' | 'gray';
const RIBBON_ROWS: RibbonColor[] = ['blue', 'red', 'yellow', 'purple', 'gray'];

/**
 * Склеить ленты пака в текстуры для 3-slice по горизонтали:
 * Big: левый край 128 + середина 64 + правый край 128 (ряд 128 px), Small: 64+64+64 (ряд 64 px, два вида на цвет).
 */
export function buildRibbonTextures(scene: Phaser.Scene): void {
  const make = (src: string, key: string, sy: number, h: number, cuts: [number, number][]) => {
    if (scene.textures.exists(key) || !scene.textures.exists(src)) return;
    const img = scene.textures.get(src).getSourceImage() as HTMLImageElement;
    const w = cuts.reduce((s, [, cw]) => s + cw, 0);
    const tex = scene.textures.createCanvas(key, w, h)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    let dx = 0;
    for (const [sx, cw] of cuts) { ctx.drawImage(img, sx, sy, cw, h, dx, 0, cw, h); dx += cw; }
    tex.refresh();
  };
  RIBBON_ROWS.forEach((c, i) => {
    make('ui_ribbons_big', `ribbon_big_${c}`, i * 128, 128, [[0, 128], [192, 64], [320, 128]]);
    // в Small для каждого цвета два ряда: «ласточкин хвост» и «стрелка»
    make('ui_ribbons_small', `ribbon_small_${c}`, i * 128 + 64, 64, [[0, 64], [128, 64], [256, 64]]);
  });
}

/** Лента-плашка нужной ширины (большая — для заголовков, малая — для кнопок). */
export function ribbon(scene: Phaser.Scene, x: number, y: number, w: number, color: RibbonColor, big = false): Phaser.GameObjects.NineSlice {
  const key = big ? `ribbon_big_${color}` : `ribbon_small_${color}`;
  const edge = big ? 128 : 64, h = big ? 128 : 64;
  return scene.add.nineslice(x, y, key, undefined, Math.max(edge * 2 + 8, w), h, edge, edge, 0, 0);
}

/** Кнопка-лента: синяя, при наведении жёлтая, неактивная — серая. */
export function ribbonButton(scene: Phaser.Scene, x: number, y: number, w: number, label: string, onClick: () => void, fontSize = 18,
  color: RibbonColor = 'blue'): Button {
  const base = ribbon(scene, 0, 0, w, color);
  const hot = ribbon(scene, 0, 0, w, 'yellow').setVisible(false);
  const off = ribbon(scene, 0, 0, w, 'gray').setVisible(false);
  const lbl = scene.add.text(0, -3, label, {
    fontFamily: UI.font, fontSize: `${fontSize}px`, fontStyle: 'bold', color: '#ffffff', stroke: '#1d2b33', strokeThickness: 4,
  }).setOrigin(0.5);
  const root = scene.add.container(x, y, [base, hot, off, lbl]).setSize(w - 40, 44);
  let enabled = true, hover = false, highlight = false;
  const redraw = () => {
    base.setVisible(enabled && !hover && !highlight);
    hot.setVisible(enabled && (hover || highlight));
    off.setVisible(!enabled);
    lbl.setAlpha(enabled ? 1 : 0.6);
    root.setScale(enabled && hover ? 1.04 : 1);
  };
  root.setInteractive(new Phaser.Geom.Rectangle(0, 0, w - 40, 44), Phaser.Geom.Rectangle.Contains);
  root.on('pointerover', () => { hover = true; redraw(); });
  root.on('pointerout', () => { hover = false; redraw(); });
  root.on('pointerdown', (p: Phaser.Input.Pointer) => {
    if (!enabled || !p.leftButtonDown()) return;
    sfx.play('click');
    root.setScale(0.97);
    scene.time.delayedCall(90, () => { redraw(); onClick(); });
  });
  redraw();
  const api: Button = {
    root, label: lbl,
    setEnabled(v) { enabled = v; redraw(); return api; },
    setText(t) { lbl.setText(t); return api; },
    setHighlight(v) { highlight = v; redraw(); return api; },
  };
  return api;
}

/** Заголовок на большой ленте. */
export function ribbonTitle(scene: Phaser.Scene, x: number, y: number, w: number, title: string, color: RibbonColor = 'blue', fontSize = 30): Phaser.GameObjects.Container {
  const r = ribbon(scene, 0, 0, w, color, true);
  const t = scene.add.text(0, -8, title, {
    fontFamily: UI.font, fontSize: `${fontSize}px`, fontStyle: 'bold', color: '#ffffff', stroke: '#1d2b33', strokeThickness: 6,
  }).setOrigin(0.5);
  return scene.add.container(x, y, [r, t]);
}

/** Окно на родной «бумажной» панели Tiny Swords (растягивается по 9-slice). */
export function paper(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.GameObject {
  if (!scene.textures.exists('nine_paper')) {
    const g = scene.add.graphics();
    drawPaper(g, x, y, w, h);
    return g;
  }
  return slice9(scene, 'paper', x, y, w, h);
}

/** Светлая «бумажная» панель для окон (запасной вариант, кодом). */
export function drawPaper(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(0x000000, 0.35).fillRoundedRect(x + 4, y + 6, w, h, 10);
  g.fillStyle(0x8a6a44, 1).fillRoundedRect(x, y, w, h, 10);
  g.fillStyle(UI.paper, 1).fillRoundedRect(x + 4, y + 4, w - 8, h - 8, 8);
}

export interface Button {
  root: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  setEnabled(v: boolean): Button;
  setText(t: string): Button;
  setHighlight(v: boolean): Button;
}

/**
 * Кнопка пака (синяя, red — красная) с подписью в прямоугольнике (x, y, w, h).
 * Наведение — светлее, выбранная (highlight) — нажатая с золотой подписью, неактивная — серая.
 */
export function makeButton(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, onClick: () => void,
  fontSize = 16, red = false): Button {
  if (!scene.textures.exists('nine_btn')) return makeWoodButton(scene, x, y, w, h, text, onClick, fontSize);
  // рамка кнопки толще у крупных кнопок; кусок 64 px должен поместиться в высоту
  const s = Math.min(0.5, h / (128 - 34));
  const up = slice9(scene, red ? 'btn_red' : 'btn', 0, 0, w, h, s);
  const down = slice9(scene, red ? 'btn_red_p' : 'btn_p', 0, 0, w, h, s).setVisible(false);
  const label = scene.add.text(w / 2, h / 2 - 2, text, {
    fontFamily: UI.font, fontSize: `${fontSize}px`, fontStyle: 'bold', color: '#ffffff', stroke: '#1d2b33', strokeThickness: 4, align: 'center',
  }).setOrigin(0.5);
  const root = scene.add.container(x, y, [up, down, label]).setSize(w, h);
  let enabled = true, hover = false, highlight = false, pressed = false;
  const redraw = () => {
    const isDown = enabled && (pressed || highlight);
    up.setVisible(!isDown);
    down.setVisible(isDown);
    const tint = !enabled ? 0x8a8a8a : hover ? 0xffffff : 0xe4e4e4;
    up.setTint(tint);
    down.setTint(tint);
    label.setY(h / 2 - 2 + (isDown ? 6 * s : 0));
    label.setColor(highlight && enabled ? UI.gold : '#ffffff');
    label.setAlpha(enabled ? 1 : 0.55);
  };
  root.setInteractive(new Phaser.Geom.Rectangle(w / 2, h / 2, w, h), Phaser.Geom.Rectangle.Contains);
  root.on('pointerover', () => { hover = true; redraw(); });
  root.on('pointerout', () => { hover = false; pressed = false; redraw(); });
  root.on('pointerdown', (p: Phaser.Input.Pointer) => {
    if (!enabled || !p.leftButtonDown()) return;
    sfx.play('click');
    pressed = true;
    redraw();
    scene.time.delayedCall(90, () => { pressed = false; redraw(); });
    onClick();
  });
  redraw();
  const api: Button = {
    root, label,
    setEnabled(v) { enabled = v; redraw(); return api; },
    setText(t) { label.setText(t); return api; },
    setHighlight(v) { highlight = v; redraw(); return api; },
  };
  return api;
}

/** Запасная кнопка, нарисованная кодом (если текстуры пака не загрузились). */
function makeWoodButton(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, onClick: () => void,
  fontSize = 16): Button {
  const g = scene.add.graphics();
  const label = scene.add.text(w / 2, h / 2, text, {
    fontFamily: UI.font, fontSize: `${fontSize}px`, color: UI.text, stroke: '#000', strokeThickness: 3, align: 'center',
  }).setOrigin(0.5);
  const root = scene.add.container(x, y, [g, label]).setSize(w, h);
  let enabled = true, hover = false, highlight = false;
  const redraw = () => {
    g.clear();
    drawPanel(g, 0, 0, w, h, highlight || (hover && enabled));
    label.setAlpha(enabled ? 1 : 0.45);
  };
  root.setInteractive(new Phaser.Geom.Rectangle(w / 2, h / 2, w, h), Phaser.Geom.Rectangle.Contains);
  root.on('pointerover', () => { hover = true; redraw(); });
  root.on('pointerout', () => { hover = false; redraw(); });
  root.on('pointerdown', (p: Phaser.Input.Pointer) => {
    if (!enabled || !p.leftButtonDown()) return;
    sfx.play('click');
    root.setScale(0.97);
    scene.time.delayedCall(80, () => root.setScale(1));
    onClick();
  });
  redraw();
  const api: Button = {
    root, label,
    setEnabled(v) { enabled = v; redraw(); return api; },
    setText(t) { label.setText(t); return api; },
    setHighlight(v) { highlight = v; redraw(); return api; },
  };
  return api;
}

export function text(scene: Phaser.Scene, x: number, y: number, s: string, size = 16, color: string = UI.text, dark = false): Phaser.GameObjects.Text {
  return scene.add.text(x, y, s, {
    fontFamily: UI.font, fontSize: `${size}px`, color, ...(dark ? {} : { stroke: '#000', strokeThickness: 3 }),
  });
}

/** Пересобрать экран при изменении размера окна (с задержкой, чтобы не дёргалось при перетаскивании). */
export function restartOnResize(scene: Phaser.Scene, data?: object): void {
  let timer: Phaser.Time.TimerEvent | null = null;
  const onResize = () => {
    timer?.remove();
    timer = scene.time.delayedCall(200, () => scene.scene.restart(data));
  };
  scene.scale.on('resize', onResize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off('resize', onResize));
}

/** Затемнить экран и перейти в другую сцену (например, обратно в меню). */
export function fadeToScene(scene: Phaser.Scene, key: string, data?: object, ms = 300): void {
  const cam = scene.cameras.main;
  if (cam.fadeEffect.isRunning) return;
  cam.fadeOut(ms, 0, 0, 0);
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => scene.scene.start(key, data));
}
