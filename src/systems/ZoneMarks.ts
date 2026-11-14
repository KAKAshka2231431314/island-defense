import Phaser from 'phaser';
import { TILE } from '../data/config';
import type { Zone } from '../mapgen/zones';
import { plateauDepth } from './depth';

export interface MarkStyle {
  fill: number;
  fillAlpha: number;
  line: number;
  lineAlpha: number;
  /** уголки-скобки, как у выделения в Bad North */
  corners?: boolean;
  lineWidth?: number;
}

/** Отступ рамки внутрь квадрата, px. */
const INSET = 4;
/** Длина уголка, px. */
const CORNER = 16;

/**
 * Подсветка квадратов-зон на земле. Квадрат рисуется двумя полосами (по ряду клеток), каждая — чуть выше
 * плитки своего ряда, но ниже стоящих на ней юнитов: рамка лежит на траве, а не поверх бойцов.
 */
export class ZoneMarks {
  private readonly pool: Phaser.GameObjects.Graphics[] = [];
  private used = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  begin(): void {
    this.used = 0;
  }

  mark(z: Zone, st: MarkStyle): void {
    const x0 = z.x0 + INSET, x1 = z.x1 - INSET, y0 = z.y0 + INSET, y1 = z.y1 - INSET;
    const rowTop = Math.round(z.y0 / TILE);
    const midY = z.y0 + TILE;
    const lw = st.lineWidth ?? 2;
    for (let part = 0; part < 2; part++) {
      const g = this.next();
      g.setDepth(plateauDepth(rowTop + part, z.level) + 0.25);
      const top = part === 0 ? y0 : midY, bottom = part === 0 ? midY : y1;
      g.fillStyle(st.fill, st.fillAlpha).fillRect(x0, top, x1 - x0, bottom - top);
      g.lineStyle(lw, st.line, st.lineAlpha);
      // боковые стороны своей полосы, верх — у верхней, низ — у нижней
      g.lineBetween(x0, top, x0, bottom).lineBetween(x1, top, x1, bottom);
      if (part === 0) g.lineBetween(x0, y0, x1, y0);
      else g.lineBetween(x0, y1, x1, y1);
      if (st.corners) {
        g.lineStyle(lw + 2, st.line, Math.min(1, st.lineAlpha + 0.2));
        const y = part === 0 ? y0 : y1, dir = part === 0 ? 1 : -1;
        g.lineBetween(x0, y, x0 + CORNER, y).lineBetween(x0, y, x0, y + dir * CORNER);
        g.lineBetween(x1, y, x1 - CORNER, y).lineBetween(x1, y, x1, y + dir * CORNER);
      }
    }
  }

  end(): void {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].clear().setVisible(false);
  }

  destroy(): void {
    this.pool.forEach((g) => g.destroy());
    this.pool.length = 0;
  }

  private next(): Phaser.GameObjects.Graphics {
    let g = this.pool[this.used];
    if (!g) {
      g = this.scene.add.graphics();
      this.pool.push(g);
    }
    this.used++;
    return g.clear().setVisible(true);
  }
}
