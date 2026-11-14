import Phaser from 'phaser';
import { sfx } from '../../systems/Sound';
import { COLOR, label, navKey, pointer } from './theme';

/** Сдвиг выбранного пункта вправо, px (× масштаб) и время перехода, мс. */
const HOVER_SHIFT = 8;
const HOVER_MS = 140;
/** Прозрачность невыбранного пункта. */
const IDLE_ALPHA = 0.72;
/** Указатель левее текста на, px (× масштаб). */
const POINTER_GAP = 22;

export interface MenuListItem {
  label: string;
  /** мелкая подпись под пунктом */
  sub?: string;
  run: () => void;
}

export interface MenuListOptions {
  /** масштаб (размеры шрифта и отступов умножаются на него) */
  k: number;
  size?: number;
  gap?: number;
  subSize?: number;
  /** появление пунктов по одному: задержка первого и шаг, мс */
  introDelay?: number;
  introStagger?: number;
  introMs?: number;
}

interface Row {
  item: MenuListItem;
  root: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  ptr: Phaser.GameObjects.Image;
}

/**
 * Текстовый список меню (как в главном меню): выбранный пункт сдвигается вправо и светлеет, слева — стрелка,
 * тихий щелчок. Мышь — наведение и клик; клавиатура — handleKey (↑/↓/Enter).
 */
export class MenuList {
  readonly root: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];
  private sel = 0;
  /** выключен — не реагирует на мышь (например, пока открыто подменю) */
  enabled = true;

  /** Высота списка в пикселях (для выравнивания по низу экрана). */
  static height(items: MenuListItem[], o: MenuListOptions): number {
    const gap = Math.round((o.gap ?? 46) * o.k);
    const sub = Math.round((o.subSize ?? 14) * o.k + 4 * o.k);
    return (items.length - 1) * gap + items.filter((i) => i.sub).length * sub;
  }

  constructor(private readonly scene: Phaser.Scene, x: number, y: number, items: MenuListItem[], private readonly o: MenuListOptions) {
    const k = o.k;
    const gap = Math.round((o.gap ?? 46) * k);
    const size = (o.size ?? 30) * k;
    this.root = scene.add.container(x, y);
    let cy = 0;
    items.forEach((item, i) => {
      const text = label(scene, 0, 0, item.label, size, COLOR.idle).setOrigin(0, 0.5).setAlpha(IDLE_ALPHA);
      const ptr = pointer(scene, -POINTER_GAP * k, 0, 0.75 * k).setAlpha(0);
      const parts: Phaser.GameObjects.GameObject[] = [ptr, text];
      let extra = 0;
      if (item.sub) {
        const s = label(scene, 0, Math.round(22 * k), item.sub, (o.subSize ?? 14) * k, COLOR.idle).setOrigin(0, 0.5).setAlpha(0.75);
        parts.push(s);
        extra = Math.round((o.subSize ?? 14) * k + 4 * k);
      }
      const root = scene.add.container(0, cy, parts);
      const zone = scene.add.zone(-30 * k, -gap / 2, text.width + 60 * k, gap + extra).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => { if (this.enabled) this.select(i); });
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (!this.enabled || !p.leftButtonDown()) return;
        this.select(i, false);
        this.activate();
      });
      root.add(zone);
      this.root.add(root);
      this.rows.push({ item, root, text, ptr });
      if (o.introDelay !== undefined) {
        root.setAlpha(0).x -= 12 * k;
        scene.tweens.add({ targets: root, alpha: 1, x: root.x + 12 * k, delay: o.introDelay + i * (o.introStagger ?? 80), duration: o.introMs ?? 320, ease: 'Sine.easeOut' });
      }
      cy += gap + extra;
    });
    this.select(0, false);
  }

  get selected(): number {
    return this.sel;
  }

  select(i: number, sound = true): void {
    const k = this.o.k;
    if (sound && i !== this.sel) sfx.play('click', 0.6);
    this.sel = i;
    this.rows.forEach((r, j) => {
      const on = j === i;
      this.scene.tweens.killTweensOf([r.text, r.ptr]);
      r.text.setColor(on ? COLOR.light : COLOR.idle);
      this.scene.tweens.add({ targets: r.text, x: on ? HOVER_SHIFT * k : 0, alpha: on ? 1 : IDLE_ALPHA, duration: HOVER_MS, ease: 'Sine.easeOut' });
      this.scene.tweens.add({ targets: r.ptr, alpha: on ? 1 : 0, x: (on ? HOVER_SHIFT - POINTER_GAP : -POINTER_GAP) * k, duration: HOVER_MS, ease: 'Sine.easeOut' });
    });
  }

  activate(): void {
    sfx.unlock();
    this.rows[this.sel]?.item.run();
  }

  /** ↑/↓ — выбор, Enter — выполнить. true — клавиша обработана. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    const n = this.rows.length;
    switch (navKey(e)) {
      case 'up': this.select((this.sel + n - 1) % n); return true;
      case 'down': this.select((this.sel + 1) % n); return true;
      case 'enter': this.activate(); return true;
      default: return false;
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}
