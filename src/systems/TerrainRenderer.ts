import Phaser from 'phaser';
import { TILE_IDX } from '../data/assetManifest';
import { CAMERA, DEPTH, TILE, TILESET_BY_LEVEL } from '../data/config';
import type { IslandGrid } from '../mapgen/IslandGrid';
import { type Rng } from '../mapgen/rng';
import { fxKey } from './AnimationRegistry';
import { cliffDepth, plateauDepth } from './depth';

type AutoTiles = {
  tl: number; t: number; tr: number; l: number; c: number; r: number; bl: number; b: number; br: number;
  vTop: number; vMid: number; vBot: number; hLeft: number; hMid: number; hRight: number; single: number;
};

/** Кадры прямых ступеней в legacy Tilemap_Elevation (4×8 клеток, ступени — нижний ряд). */
const STAIR_FRAMES = { left: 28, mid: 29, right: 30, single: 31 } as const;

/** Автотайл 16 вариантов по 4 соседям (см. гайд Tiny Swords «Flat Ground»). */
function autotile(set: AutoTiles, n: boolean, s: boolean, w: boolean, e: boolean): number {
  if (!w && !e) return n && s ? set.vMid : s ? set.vTop : n ? set.vBot : set.single;
  if (!n && !s) return w && e ? set.hMid : e ? set.hLeft : set.hRight;
  const row = !n ? 0 : !s ? 2 : 1;
  const col = !w ? 0 : !e ? 2 : 1;
  return [
    [set.tl, set.t, set.tr],
    [set.l, set.c, set.r],
    [set.bl, set.b, set.br],
  ][row][col];
}

/**
 * Рисует остров по правилам тайлсета Tiny Swords:
 * вода → пена → плоская земля → для каждого уровня L≥2: тени → верх плато + скалы + лестницы.
 */
export class TerrainRenderer {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private map?: Phaser.Tilemaps.Tilemap;

  constructor(private readonly scene: Phaser.Scene, private readonly grid: IslandGrid, private readonly rng: Rng) {}

  get widthPx(): number {
    return this.grid.w * TILE;
  }

  get heightPx(): number {
    return this.grid.h * TILE;
  }

  render(): void {
    const { scene, grid } = this;
    const pad = CAMERA.edgePad;
    const water = scene.add.tileSprite(-pad, -pad, this.widthPx + pad * 2, this.heightPx + pad * 2, 'water_bg')
      .setOrigin(0).setDepth(DEPTH.water);
    this.objects.push(water);

    this.map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: grid.w, height: grid.h });
    this.renderWaterRocks();
    this.renderFoam();
    this.renderFlat();
    for (let L = 2; L <= grid.maxLevel; L++) this.renderLevel(L);
  }

  destroy(): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    this.map?.destroy();
  }

  private layer(name: string, tilesetKey: string, depth: number): Phaser.Tilemaps.TilemapLayer {
    const map = this.map!;
    const ts = map.addTilesetImage(tilesetKey, tilesetKey, TILE, TILE, 0, 0)!;
    const layer = map.createBlankLayer(name, ts, 0, 0)!;
    layer.setDepth(depth);
    return layer;
  }

  private renderWaterRocks(): void {
    const { grid, rng } = this;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (!grid.isWater(x, y) || rng() > 0.025) continue;
        if (this.nearLand(x, y, 1)) continue;
        const key = rng() < 0.5 ? 'water_rocks1' : 'water_rocks2';
        const s = this.scene.add.sprite((x + 0.5) * TILE, (y + 0.5) * TILE, key).setDepth(DEPTH.waterDeco);
        s.play({ key: fxKey(key), startFrame: Math.floor(rng() * 16) });
        this.objects.push(s);
      }
    }
  }

  private nearLand(x: number, y: number, r: number): boolean {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (this.grid.isLand(x + dx, y + dy)) return true;
    return false;
  }

  private renderFoam(): void {
    const { grid, rng } = this;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const solid = grid.isLand(x, y) || grid.cliffLevel(x, y) > 0;
        if (!solid) continue;
        let touchesWater = false;
        for (let dy = -1; dy <= 1 && !touchesWater; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (grid.isWater(nx, ny) && grid.cliffLevel(nx, ny) === 0) { touchesWater = true; break; }
          }
        }
        if (!touchesWater) continue;
        const s = this.scene.add.sprite((x + 0.5) * TILE, (y + 0.5) * TILE, 'water_foam').setDepth(DEPTH.foam);
        s.play({ key: fxKey('water_foam'), startFrame: Math.floor(rng() * 16) });
        this.objects.push(s);
      }
    }
  }

  private renderFlat(): void {
    const { grid } = this;
    const layer = this.layer('flat', TILESET_BY_LEVEL[1], DEPTH.flat);
    const land = (x: number, y: number) => grid.isLand(x, y);
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (!land(x, y)) continue;
        layer.putTileAt(autotile(TILE_IDX.flat, land(x, y - 1), land(x, y + 1), land(x - 1, y), land(x + 1, y)), x, y);
      }
    }
  }

  private renderLevel(L: number): void {
    const { grid } = this;
    const key = TILESET_BY_LEVEL[L] ?? TILESET_BY_LEVEL[2];
    // плоская поверхность остаётся под объектами; вертикальные скалы сортируются по ряду
    const put = (frame: number, x: number, y: number, depth: number) => {
      this.objects.push(this.scene.add.image((x + 0.5) * TILE, (y + 0.5) * TILE, key, frame).setDepth(depth));
    };

    const hi = (x: number, y: number) => grid.getLevel(x, y) >= L;
    const stair = (x: number, y: number) => grid.stairAt(x, y)?.def.level === L;
    // ступени продолжают плато: у клетки плато над лестницей нет нижнего края, а скала по бокам не обрывается
    const hiN = (x: number, y: number) => hi(x, y) || stair(x, y);
    const isCliff = (x: number, y: number) => hi(x, y - 1) && !hi(x, y) && !grid.stairAt(x, y);
    const cliffN = (x: number, y: number) => isCliff(x, y) || stair(x, y);

    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (hi(x, y)) {
          // тень от плато — на тайл ниже, под плиткой плато
          const sh = this.scene.add.image((x + 0.5) * TILE, (y + 1.5) * TILE, 'shadow').setDepth(plateauDepth(y, L) - 1);
          this.objects.push(sh);
          const frame = autotile(TILE_IDX.high, hiN(x, y - 1), hiN(x, y + 1), hiN(x - 1, y), hiN(x + 1, y));
          put(frame, x, y, plateauDepth(y, L));
        } else if (isCliff(x, y)) {
          const w = cliffN(x - 1, y), e = cliffN(x + 1, y);
          const toWater = grid.isWater(x, y);
          const T = TILE_IDX.high;
          const idx = toWater
            ? (w && e ? T.cliffWaterMid : e ? T.cliffWaterLeft : w ? T.cliffWaterRight : T.cliffWaterSingle)
            : (w && e ? T.cliffMid : e ? T.cliffLeft : w ? T.cliffRight : T.cliffSingle);
          put(idx, x, y, cliffDepth(y, L));
        }
      }
    }

    // прямые ступени (legacy Tilemap_Elevation, нижний ряд): слева / середина / справа, одиночные
    for (const s of grid.stairs) {
      if (s.level !== L) continue;
      if (s.side === 'left' || s.side === 'right') {
        // боковой склон рисуется текстурой уровня, с которого на него заходят (уровень 3 — травой уровня 2)
        const F = TILE_IDX.flat;
        const stairKey = TILESET_BY_LEVEL[L - 1] ?? TILESET_BY_LEVEL[1];
        const left = s.side === 'left';
        const putStair = (frame: number, x: number, y: number, depth: number) => {
          // за прозрачной половиной склона — обычная земля нижнего уровня, а не повёрнутая скала
          this.objects.push(this.scene.add.image((x + 0.5) * TILE, (y + 0.5) * TILE, stairKey, F.c).setDepth(depth - 0.5));
          this.objects.push(this.scene.add.image((x + 0.5) * TILE, (y + 0.5) * TILE, stairKey, frame).setDepth(depth));
        };
        putStair(left ? F.stairLeftTop : F.stairRightTop, s.x, s.y, plateauDepth(s.y, L));
        putStair(left ? F.stairLeftBot : F.stairRightBot, s.x, s.y + 1, cliffDepth(s.y + 1, L));
        continue;
      }
      for (let i = 0; i < s.width; i++) {
        const frame = s.width === 1 ? STAIR_FRAMES.single : i === 0 ? STAIR_FRAMES.left : i === s.width - 1 ? STAIR_FRAMES.right : STAIR_FRAMES.mid;
        this.objects.push(this.scene.add.image((s.x + i + 0.5) * TILE, (s.y + 0.5) * TILE, 'tiles_elev_legacy', frame).setDepth(cliffDepth(s.y, L)));
      }
    }
  }
}
