import Phaser from 'phaser';
import type { WeatherKind } from '../data/conditions';
import { mulberry32 } from '../mapgen/rng';

interface Drop { x: number; y: number; vx: number; vy: number; length: number }

export class WeatherFX {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly drops: Drop[] = [];
  private readonly clouds: Phaser.GameObjects.Image[] = [];
  private readonly rain: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene, private readonly kind: WeatherKind, seed: number) {
    if (kind === 'clear') return;
    const { width: w, height: h } = scene.scale;
    const rng = mulberry32(seed ^ 0x42c0ffee);
    if (kind === 'rain' || kind === 'mist') {
      this.objects.push(scene.add.rectangle(0, 0, w, h, kind === 'rain' ? 0x263b50 : 0xb8c8cc, kind === 'rain' ? 0.09 : 0.08)
        .setOrigin(0).setDepth(-31));
    }
    if (kind === 'mist') {
      for (let i = 0; i < 7; i++) {
        const cloud = scene.add.image(rng() * w, rng() * h, `cloud${(i % 8) + 1}`)
          .setScale(0.7 + rng() * 0.8).setTint(0xd9e3e5).setAlpha(0.13).setDepth(-30);
        this.clouds.push(cloud);
        this.objects.push(cloud);
      }
      return;
    }
    this.rain = scene.add.graphics().setDepth(-30);
    this.objects.push(this.rain);
    const count = Phaser.Math.Clamp(Math.round(w * h / (kind === 'rain' ? 10000 : 18000)), 30, 100);
    for (let i = 0; i < count; i++) {
      this.drops.push({
        x: rng() * w, y: rng() * h,
        vx: kind === 'rain' ? -85 : 520 + rng() * 180,
        vy: kind === 'rain' ? 620 + rng() * 180 : 90 + rng() * 60,
        length: kind === 'rain' ? 12 + rng() * 10 : 20 + rng() * 30,
      });
    }
  }

  update(dt: number): void {
    const scene = this.rain?.scene ?? this.clouds[0]?.scene;
    if (!scene) return;
    const { width: w, height: h } = scene.scale;
    if (this.kind === 'mist') {
      for (const cloud of this.clouds) {
        cloud.x += dt * 9;
        if (cloud.x > w + 300) cloud.x = -300;
      }
      return;
    }
    const g = this.rain;
    if (!g) return;
    g.clear().lineStyle(1, this.kind === 'rain' ? 0xb9d7e5 : 0xe5edf0, this.kind === 'rain' ? 0.38 : 0.25);
    for (const d of this.drops) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y > h + 30) { d.y = -30; d.x = (d.x + w * 0.37) % w; }
      if (d.x > w + 50) d.x = -50;
      if (d.x < -50) d.x = w + 50;
      const k = d.length / Math.hypot(d.vx, d.vy);
      g.lineBetween(d.x, d.y, d.x - d.vx * k, d.y - d.vy * k);
    }
  }

  destroy(): void {
    this.objects.forEach((o) => o.destroy());
  }
}
