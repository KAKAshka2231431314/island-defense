import Phaser from 'phaser';
import { sfx } from '../../systems/Sound';

/** Видимый диаметр кнопки при масштабе 1, px (картинка пака — 128 px, кнопка в ней ≈ 100 px). */
const SIZE = 40;

export type IconDraw = (g: Phaser.GameObjects.Graphics, r: number, color: number) => void;

/**
 * Круглая кнопка пака (SmallBlueRoundButton): обычная / нажатая (когда включена), иконка рисуется кодом.
 * rect — прямоугольник на экране (для проверки «клик по интерфейсу, не по острову»).
 */
export class RoundButton {
  readonly root: Phaser.GameObjects.Container;
  private readonly img: Phaser.GameObjects.Image;
  private readonly icon: Phaser.GameObjects.Graphics;
  private active = false;
  private hover = false;
  readonly size: number;

  constructor(scene: Phaser.Scene, x: number, y: number, k: number, private readonly draw: IconDraw, onClick: () => void) {
    this.size = SIZE * k;
    const scale = (this.size / 100);
    this.img = scene.add.image(0, 0, 'ui_btn_round').setScale(scale);
    this.icon = scene.add.graphics();
    this.root = scene.add.container(x, y, [this.img, this.icon]).setSize(this.size, this.size);
    this.root.setInteractive(new Phaser.Geom.Circle(this.size / 2, this.size / 2, this.size / 2), Phaser.Geom.Circle.Contains);
    this.root.on('pointerover', () => { this.hover = true; this.redraw(); });
    this.root.on('pointerout', () => { this.hover = false; this.redraw(); });
    this.root.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) return;
      sfx.play('click', 0.6);
      onClick();
    });
    this.redraw();
  }

  get rect(): { x: number; y: number; w: number; h: number } {
    return { x: this.root.x - this.size / 2, y: this.root.y - this.size / 2, w: this.size, h: this.size };
  }

  setActive(on: boolean): this {
    if (on !== this.active) {
      this.active = on;
      this.redraw();
    }
    return this;
  }

  private redraw(): void {
    this.img.setTexture(this.active ? 'ui_btn_round_p' : 'ui_btn_round').setTint(this.hover ? 0xffffff : 0xe6e6e6);
    this.icon.clear().setPosition(0, this.active ? this.size * 0.06 : -this.size * 0.02);
    this.draw(this.icon, this.size * 0.2, this.active ? 0xffd84a : 0xffffff);
  }
}

/** Иконка паузы: две полоски. */
export const iconPause: IconDraw = (g, r, c) => {
  g.fillStyle(0x13202a, 1).fillRect(-r * 0.75 - 1, -r - 1, r * 0.55 + 2, r * 2 + 2).fillRect(r * 0.2 - 1, -r - 1, r * 0.55 + 2, r * 2 + 2);
  g.fillStyle(c, 1).fillRect(-r * 0.75, -r, r * 0.55, r * 2).fillRect(r * 0.2, -r, r * 0.55, r * 2);
};

/** Иконка ускорения: два треугольника ▶▶. */
export const iconFast: IconDraw = (g, r, c) => {
  for (const [col, d] of [[0x13202a, 1.5], [c, 0]] as [number, number][]) {
    g.fillStyle(col, 1);
    g.fillTriangle(-r * 1.1 - d, -r - d, -r * 1.1 - d, r + d, r * 0.05 + d, 0);
    g.fillTriangle(-r * 0.05 - d, -r - d, -r * 0.05 - d, r + d, r * 1.1 + d, 0);
  }
};

/** Иконка общего обзора: четыре угла вокруг острова. */
export const iconOverview: IconDraw = (g, r, c) => {
  const s = r * 1.15, l = r * 0.65;
  for (const [col, w, d] of [[0x13202a, 5, 1], [c, 2.5, 0]] as [number, number, number][]) {
    g.lineStyle(w, col, 1);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * s, y = sy * s;
      g.lineBetween(x, y, x - sx * l, y);
      g.lineBetween(x, y, x, y - sy * l);
    }
    if (d) g.fillStyle(col, 1).fillRect(-r * 0.45 - d, -r * 0.45 - d, r * 0.9 + d * 2, r * 0.9 + d * 2);
  }
  g.fillStyle(c, 1).fillRect(-r * 0.45, -r * 0.45, r * 0.9, r * 0.9);
};
