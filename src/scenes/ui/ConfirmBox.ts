import Phaser from 'phaser';
import { sfx } from '../../systems/Sound';
import { slice9 } from './base';
import { COLOR, label, navKey, pointer } from './theme';

/** Затемнение под плашкой и время появления, мс. */
const SHADE_ALPHA = 0.35;
const FADE_MS = 150;

/**
 * Короткое подтверждение на бумажной плашке: вопрос и «Да» / «Нет» (по умолчанию выбрано «Нет»).
 * Мышь — наведение/клик, клавиатура — ←/→ (↑/↓), Enter, Esc = «Нет».
 */
export class ConfirmBox {
  private readonly root: Phaser.GameObjects.Container;
  private readonly choices: { text: Phaser.GameObjects.Text; ptr: Phaser.GameObjects.Image }[];
  private sel = 1;
  private done = false;

  constructor(scene: Phaser.Scene, question: string, private readonly onAnswer: (yes: boolean) => void, k: number, depth = 900) {
    const { width, height } = scene.scale;
    const w = Math.min(Math.round(460 * k), width - 24), h = Math.round(170 * k);
    const x = Math.round((width - w) / 2), y = Math.round((height - h) / 2);
    this.root = scene.add.container(0, 0).setDepth(depth);
    this.root.add(scene.add.rectangle(0, 0, width, height, 0x000000, SHADE_ALPHA).setOrigin(0).setInteractive());
    this.root.add(slice9(scene, 'paper', x, y, w, h));
    this.root.add(label(scene, width / 2, y + Math.round(20 * k), question, 18 * k, COLOR.dark, false)
      .setOrigin(0.5, 0).setAlign('center').setLineSpacing(4 * k).setWordWrapWidth(w - 40 * k));
    this.choices = ['Да', 'Нет'].map((s, i) => {
      const cx = width / 2 + (i === 0 ? -1 : 1) * Math.round(70 * k);
      const cy = y + h - Math.round(34 * k);
      const text = label(scene, cx, cy, s, 22 * k, COLOR.dark, false).setOrigin(0.5);
      const ptr = pointer(scene, cx - text.width / 2 - Math.round(16 * k), cy, 0.6 * k).setAlpha(0);
      text.setInteractive({ useHandCursor: true });
      text.on('pointerover', () => this.select(i));
      text.on('pointerup', () => this.answer(i === 0));
      this.root.add([ptr, text]);
      return { text, ptr };
    });
    this.select(1, false);
    this.root.setAlpha(0);
    scene.tweens.add({ targets: this.root, alpha: 1, duration: FADE_MS });
  }

  private select(i: number, sound = true): void {
    if (sound && i !== this.sel) sfx.play('click', 0.5);
    this.sel = i;
    this.choices.forEach((c, j) => {
      c.ptr.setAlpha(j === i ? 1 : 0);
      c.text.setColor(j === i ? COLOR.darkSel : COLOR.dark).setFontStyle(j === i ? 'bold' : '');
    });
  }

  private answer(yes: boolean): void {
    if (this.done) return;
    this.done = true;
    sfx.play('click', 0.5);
    this.root.destroy();
    this.onAnswer(yes);
  }

  /** Клавиши подтверждения; всегда «съедает» ввод, пока плашка открыта. */
  handleKey(e: KeyboardEvent): boolean {
    switch (navKey(e)) {
      case 'left': case 'right': case 'up': case 'down': this.select(1 - this.sel); break;
      case 'enter': this.answer(this.sel === 0); break;
      case 'esc': this.answer(false); break;
      default: break;
    }
    return true;
  }

  get open(): boolean {
    return !this.done;
  }

  destroy(): void {
    this.done = true;
    this.root.destroy();
  }
}
