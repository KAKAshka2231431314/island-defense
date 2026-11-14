import Phaser from 'phaser';
import { ribbon, type RibbonColor } from './base';
import { COLOR, FONT } from './theme';

/** Сколько баннер висит на экране, выезд и уход, мс. */
const SHOW_MS = 2000;
const IN_MS = 260;
const OUT_MS = 320;
/** Откуда выезжает (выше места показа на столько px × масштаб). */
const SLIDE = 40;

interface Item {
  text: string;
  color: RibbonColor;
  ms: number;
}

/**
 * Баннер события по центру сверху на ленте пака: «Волна 2 из 4», «Дом горит!», «Отряд потерян»…
 * Одновременно показывается один — остальные ждут в очереди; одинаковые подряд не дублируются.
 */
export class BannerQueue {
  private readonly root: Phaser.GameObjects.Container;
  private readonly band: Phaser.GameObjects.NineSlice;
  private readonly text: Phaser.GameObjects.Text;
  private readonly queue: Item[] = [];
  private busy = false;
  private current = '';

  constructor(private readonly scene: Phaser.Scene, private readonly k: number, private y: number, depth: number) {
    this.band = ribbon(scene, 0, 0, 300, 'blue', true);
    const px = Math.round(26 * k);
    this.text = scene.add.text(0, -8 * k, '', {
      fontFamily: FONT, fontSize: `${px}px`, color: '#ffffff', stroke: COLOR.stroke, strokeThickness: Math.round(px / 5),
    }).setOrigin(0.5);
    this.root = scene.add.container(scene.scale.width / 2, y, [this.band, this.text]).setDepth(depth).setVisible(false).setScale(k);
    this.text.setScale(1 / k);
  }

  show(text: string, color: RibbonColor = 'blue', ms = SHOW_MS): void {
    if (text === this.current || this.queue.some((q) => q.text === text)) return;
    this.queue.push({ text, color, ms });
    if (!this.busy) this.next();
  }

  /** Новое место (после изменения размера экрана). */
  place(x: number, y: number): void {
    this.y = y;
    this.root.x = x;
    if (!this.busy) this.root.y = y;
  }

  private next(): void {
    const it = this.queue.shift();
    if (!it) { this.busy = false; this.current = ''; this.root.setVisible(false); return; }
    this.busy = true;
    this.current = it.text;
    this.text.setText(it.text);
    const w = Math.max(264, this.text.width / this.k + 220);
    this.band.setTexture(`ribbon_big_${it.color}`).setSize(w, 128);
    this.scene.tweens.killTweensOf(this.root);
    this.root.setVisible(true).setAlpha(0).setY(this.y - SLIDE * this.k);
    this.scene.tweens.add({ targets: this.root, alpha: 1, y: this.y, duration: IN_MS, ease: 'Back.easeOut' });
    this.scene.tweens.add({
      targets: this.root, alpha: 0, y: this.y - SLIDE * this.k * 0.5, delay: it.ms - OUT_MS, duration: OUT_MS, ease: 'Sine.easeIn',
      onComplete: () => this.next(),
    });
  }

  clear(): void {
    this.queue.length = 0;
    this.scene.tweens.killTweensOf(this.root);
    this.busy = false;
    this.current = '';
    this.root.setVisible(false);
  }

  destroy(): void {
    this.clear();
    this.root.destroy();
  }
}
