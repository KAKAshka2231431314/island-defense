import Phaser from 'phaser';
import { sfx } from '../../systems/Sound';
import { COLOR, label, navKey, pointer } from './theme';

/** Указатель левее текста на, px (× масштаб); сторона галочки, px (× масштаб). */
const POINTER_GAP = 16;
const BOX = 12;
/** Прозрачность недоступного пункта. */
const DISABLED_ALPHA = 0.45;

export interface PaperItem {
  label: string;
  x: number;
  y: number;
  size?: number;
  run: () => void;
  /** пункт-галочка: квадратик слева, заполнен, если checked */
  checkbox?: boolean;
  checked?: boolean;
  enabled?: boolean;
}

interface Row {
  item: PaperItem;
  text: Phaser.GameObjects.Text;
  ptr: Phaser.GameObjects.Image;
  box: Phaser.GameObjects.Graphics | null;
}

/**
 * Пункты тёмным текстом на бумаге (как «Да / Нет» в подтверждении): выбранный — жирный, тёмно-красный,
 * со стрелкой слева. Галочки для выбора, недоступные пункты бледнее. Мышь — наведение и клик;
 * клавиатура — handleKey (↑/↓/←/→ — по порядку пунктов, Enter — выполнить).
 */
export class PaperList {
  readonly root: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];
  private sel = 0;

  constructor(scene: Phaser.Scene, items: PaperItem[], private readonly k: number) {
    this.root = scene.add.container(0, 0);
    items.forEach((item, i) => {
      const size = (item.size ?? 16) * k;
      const tx = item.checkbox ? item.x + (BOX + 8) * k : item.x;
      const text = label(scene, tx, item.y, item.label, size, COLOR.dark, false).setOrigin(0, 0.5);
      const ptr = pointer(scene, item.x - POINTER_GAP * k, item.y, 0.55 * k).setAlpha(0);
      const box = item.checkbox ? scene.add.graphics() : null;
      text.setInteractive({ useHandCursor: true });
      text.on('pointerover', () => this.select(i));
      text.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (!p.leftButtonDown()) return;
        this.select(i, false);
        this.activate();
      });
      this.root.add([ptr, text, ...(box ? [box] : [])]);
      this.rows.push({ item, text, ptr, box });
    });
    this.refresh();
    this.select(Math.max(0, this.rows.findIndex((r) => r.item.enabled !== false)), false);
  }

  /** Перерисовать галочки и доступность (после изменения item.checked / item.enabled / подписи). */
  refresh(): void {
    const k = this.k;
    for (const r of this.rows) {
      r.text.setText(r.item.label).setAlpha(r.item.enabled === false ? DISABLED_ALPHA : 1);
      if (!r.box) continue;
      const s = BOX * k, x = r.item.x, y = r.item.y - s / 2;
      r.box.clear().lineStyle(Math.max(2, Math.round(2 * k)), 0x3d2718, r.item.enabled === false ? DISABLED_ALPHA : 1).strokeRect(x, y, s, s);
      if (r.item.checked) r.box.fillStyle(0x7a2e12, 1).fillRect(x + 3 * k, y + 3 * k, s - 6 * k, s - 6 * k);
    }
    this.select(this.sel, false);
  }

  select(i: number, sound = true): void {
    if (sound && i !== this.sel) sfx.play('click', 0.5);
    this.sel = i;
    this.rows.forEach((r, j) => {
      const on = j === i;
      r.ptr.setAlpha(on ? 1 : 0);
      r.text.setColor(on ? COLOR.darkSel : COLOR.dark).setFontStyle(on ? 'bold' : '');
    });
  }

  activate(): void {
    const r = this.rows[this.sel];
    if (!r || r.item.enabled === false) return;
    sfx.unlock();
    sfx.play('click', 0.5);
    r.item.run();
  }

  handleKey(e: KeyboardEvent): boolean {
    const n = this.rows.length;
    switch (navKey(e)) {
      case 'up': case 'left': this.select((this.sel + n - 1) % n); return true;
      case 'down': case 'right': this.select((this.sel + 1) % n); return true;
      case 'enter': this.activate(); return true;
      default: return false;
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}
