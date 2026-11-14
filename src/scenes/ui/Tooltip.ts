import Phaser from 'phaser';
import { COLOR, label, plate } from './theme';

/** Отступ текста от края подложки и зазор до предмета, px (× масштаб). */
const PAD = 8;
const GAP = 8;

/** Всплывающая подсказка на тёмной подложке: строки текста над точкой (не вылезает за экран). */
export class Tooltip {
  private readonly root: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene, private readonly k: number, depth: number) {
    this.bg = scene.add.graphics();
    this.text = label(scene, 0, 0, '', 14 * k, COLOR.light).setLineSpacing(3 * k);
    this.root = scene.add.container(0, 0, [this.bg, this.text]).setDepth(depth).setVisible(false);
  }

  /** Показать над точкой (x, y) экрана. */
  show(x: number, y: number, lines: string[]): void {
    const k = this.k;
    this.text.setText(lines.join('\n'));
    const w = Math.round(this.text.width + PAD * 2 * k), h = Math.round(this.text.height + PAD * 2 * k);
    const { width } = this.scene.scale;
    const left = Phaser.Math.Clamp(Math.round(x - w / 2), 6, width - w - 6);
    const top = Math.max(6, Math.round(y - h - GAP * k));
    this.bg.clear();
    plate(this.bg, 0, 0, w, h, 0.85);
    this.text.setPosition(PAD * k, PAD * k);
    this.root.setPosition(left, top).setVisible(true);
  }

  hide(): void {
    this.root.setVisible(false);
  }

  destroy(): void {
    this.root.destroy();
  }
}
