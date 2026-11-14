import Phaser from 'phaser';

/** Пиксельный шрифт (Pixelify Sans, с кириллицей); если не загрузился — monospace. */
export const FONT = '"Pixelify Sans", monospace';

export const COLOR = {
  light: '#f6eed8',
  idle: '#d8ccae',
  stroke: '#13202a',
  dark: '#3d2718',
  darkSel: '#7a2e12',
  darkSoft: '#7a5a3a',
  gold: '#ffd84a',
  red: '#ff6a5a',
  green: '#8be07a',
} as const;

/** Подложки интерфейса боя: тёмные полупрозрачные пластины с мягкими краями. */
export const PLATE = { color: 0x0f1a20, alpha: 0.62, radius: 6 } as const;

/** Базовое разрешение, под которое рассчитан интерфейс боя (масштаб ×1 до 2× этого размера). */
const UI_BASE_W = 1100;
const UI_BASE_H = 660;

/** Целочисленный масштаб интерфейса боя: ×1 на ноутбуке 1366×768 и Full HD, ×2 на 2560×1440 и больше. */
export function uiScale(scene: Phaser.Scene): number {
  const { width, height } = scene.scale;
  return Math.max(1, Math.floor(Math.min(width / UI_BASE_W, height / UI_BASE_H)));
}

/** Подпись пиксельным шрифтом; size — уже в пикселях экрана. */
export function label(scene: Phaser.Scene, x: number, y: number, s: string, size: number, color: string = COLOR.light, stroke = true): Phaser.GameObjects.Text {
  const px = Math.round(size);
  return scene.add.text(x, y, s, {
    fontFamily: FONT, fontSize: `${px}px`, color,
    ...(stroke ? { stroke: COLOR.stroke, strokeThickness: Math.max(2, Math.round(px / 7)) } : {}),
  });
}

/** Тёмная полупрозрачная пластина со скруглёнными углами. */
export function plate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, alpha: number = PLATE.alpha): Phaser.GameObjects.Graphics {
  return g.fillStyle(PLATE.color, alpha).fillRoundedRect(x, y, w, h, PLATE.radius);
}

/** Указатель-стрелка (legacy Pointers/01, повёрнута вправо). */
export function pointer(scene: Phaser.Scene, x: number, y: number, scale: number): Phaser.GameObjects.Image {
  return scene.add.image(x, y, 'ui_pointer').setAngle(135).setScale(scale);
}

/** Распознать клавиши навигации (стрелки, WASD в обеих раскладках, Enter/пробел, Esc). */
export function navKey(e: KeyboardEvent): 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | null {
  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': case 'ц': case 'Ц': return 'up';
    case 'ArrowDown': case 's': case 'S': case 'ы': case 'Ы': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Enter': case ' ': return 'enter';
    case 'Escape': return 'esc';
    default: return null;
  }
}
