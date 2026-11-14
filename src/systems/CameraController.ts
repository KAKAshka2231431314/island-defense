import Phaser from 'phaser';
import { CAMERA, TILE } from '../data/config';
import type { IslandData } from '../mapgen/IslandGenerator';

/** Камера: WASD/стрелки или перетаскивание правой/средней кнопкой, колесо — зум, Home — весь остров. */
export class CameraController {
  private zoomIndex = 0;
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private dragFrom?: { x: number; y: number; sx: number; sy: number };
  private landBounds: Phaser.Geom.Rectangle;
  /** плавный полёт: центр камеры от from к to за dur секунд реального времени */
  private flight: { from: Phaser.Math.Vector2; to: Phaser.Math.Vector2; t: number; dur: number } | null = null;
  /** облёт острова по эллипсу (после победы) */
  private orbitState: { cx: number; cy: number; rx: number; ry: number; t: number; dur: number; a0: number } | null = null;

  constructor(private readonly scene: Phaser.Scene, island: Pick<IslandData, 'grid'>) {
    const cam = scene.cameras.main;
    const grid = island.grid;
    const worldW = grid.w * TILE, worldH = grid.h * TILE;
    const p = CAMERA.edgePad;
    cam.setBounds(-p, -p, worldW + p * 2, worldH + p * 2);
    cam.setRoundPixels(true);
    this.landBounds = this.findLandBounds(island);
    this.showOverview();

    scene.input.mouse?.disableContextMenu();
    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
    const onHome = () => this.showOverview(0.35);
    const onResize = () => this.showOverview();
    kb.on('keydown-HOME', onHome);
    scene.scale.on('resize', onResize);

    scene.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const next = Phaser.Math.Clamp(this.zoomIndex + (dy > 0 ? -1 : 1), 0, CAMERA.zoomLevels.length - 1);
      if (next === this.zoomIndex) return;
      this.zoomIndex = next;
      cam.setZoom(CAMERA.zoomLevels[next]);
    });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown() || p.middleButtonDown()) this.dragFrom = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragFrom) return;
      if (!p.rightButtonDown() && !p.middleButtonDown()) { this.dragFrom = undefined; return; }
      cam.setScroll(this.dragFrom.sx - (p.x - this.dragFrom.x) / cam.zoom, this.dragFrom.sy - (p.y - this.dragFrom.y) / cam.zoom);
    });
    scene.input.on('pointerup', () => { this.dragFrom = undefined; });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      kb.off('keydown-HOME', onHome);
      scene.scale.off('resize', onResize);
    });
  }

  /** Наибольший стандартный масштаб, при котором суша помещается в свободную часть экрана. */
  showOverview(seconds = 0): void {
    const cam = this.scene.cameras.main;
    const b = this.landBounds;
    const fitW = this.scene.scale.width * 0.9, fitH = this.scene.scale.height * 0.76;
    this.zoomIndex = 0;
    for (let i = CAMERA.zoomLevels.length - 1; i >= 0; i--) {
      const zoom = CAMERA.zoomLevels[i];
      if (b.width * zoom <= fitW && b.height * zoom <= fitH) {
        this.zoomIndex = i;
        break;
      }
    }
    this.orbitState = null;
    this.flight = null;
    cam.setZoom(CAMERA.zoomLevels[this.zoomIndex]);
    const x = b.centerX, y = b.centerY;
    if (seconds > 0) this.flyTo(x, y, seconds);
    else cam.centerOn(x, y);
  }

  private findLandBounds(island: Pick<IslandData, 'grid'>): Phaser.Geom.Rectangle {
    const grid = island.grid;
    let minX = grid.w, minY = grid.h, maxX = -1, maxY = -1;
    for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
      if (grid.getLevel(x, y) < 1 && grid.cliffLevel(x, y) <= 0) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (maxX < 0) return new Phaser.Geom.Rectangle(0, 0, grid.w * TILE, grid.h * TILE);
    const pad = TILE * 2;
    return new Phaser.Geom.Rectangle(minX * TILE - pad, minY * TILE - pad, (maxX - minX + 1) * TILE + pad * 2, (maxY - minY + 1) * TILE + pad * 2);
  }

  /** Плавно перевести камеру на точку мира (двойной клик по карточке отряда). */
  flyTo(x: number, y: number, seconds: number): void {
    const cam = this.scene.cameras.main;
    this.orbitState = null;
    this.flight = { from: new Phaser.Math.Vector2(cam.midPoint.x, cam.midPoint.y), to: new Phaser.Math.Vector2(x, y), t: 0, dur: seconds };
  }

  /** Медленный облёт вокруг центра острова (после победы); ручное управление камерой при этом выключено. */
  orbit(cx: number, cy: number, rx: number, ry: number, seconds: number): void {
    const cam = this.scene.cameras.main;
    this.flight = null;
    this.orbitState = { cx, cy, rx, ry, t: 0, dur: seconds, a0: Math.atan2(cam.midPoint.y - cy, cam.midPoint.x - cx) };
  }

  /** dt — реальное время (не замедленное), сек. */
  update(dt: number): void {
    const cam = this.scene.cameras.main;
    if (this.orbitState) {
      const o = this.orbitState;
      o.t += dt;
      const a = o.a0 + (o.t / o.dur) * Math.PI * 0.5;
      cam.centerOn(o.cx + Math.cos(a) * o.rx, o.cy + Math.sin(a) * o.ry);
      return;
    }
    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const p = Phaser.Math.Easing.Sine.InOut(Math.min(1, f.t / f.dur));
      cam.centerOn(f.from.x + (f.to.x - f.from.x) * p, f.from.y + (f.to.y - f.from.y) * p);
      if (f.t >= f.dur) this.flight = null;
      return;
    }
    const k = this.keys;
    const v = (CAMERA.panSpeed * dt) / cam.zoom;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (dx || dy) cam.setScroll(cam.scrollX + dx * v, cam.scrollY + dy * v);
  }
}
