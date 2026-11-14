import Phaser from 'phaser';
import { IMAGES, SHEETS } from '../data/assetManifest';
import { registerAnimations } from '../systems/AnimationRegistry';
import { buildNineSliceTextures, buildRibbonTextures } from './ui';

/** Загружает все ассеты из манифеста и создаёт анимации. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    const { width, height } = this.scale;
    const barW = Math.min(480, width - 64);
    const box = this.add.rectangle(width / 2, height / 2, barW + 8, 28, 0x000000, 0.5);
    const bar = this.add.rectangle(width / 2 - barW / 2, height / 2, 0, 20, 0xf5d77a).setOrigin(0, 0.5);
    const label = this.add.text(width / 2, height / 2 - 34, 'Загрузка…', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' })
      .setOrigin(0.5);
    void box;

    const errors: string[] = [];
    this.load.on('progress', (v: number) => { bar.width = barW * v; });
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      errors.push(`${file.key}: ${file.url}`);
      console.error('[assets] не удалось загрузить', file.key, file.url);
    });
    this.load.on('complete', () => {
      this.registry.set('loadErrors', errors);
      label.setText(errors.length ? `Ошибок загрузки: ${errors.length}` : 'Готово');
    });

    for (const s of SHEETS) {
      this.load.spritesheet(s.key, encodeURI(s.path), { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    }
    for (const img of IMAGES) this.load.image(img.key, encodeURI(img.path));
  }

  create(): void {
    this.validateSheets();
    registerAnimations(this);
    buildNineSliceTextures(this);
    buildRibbonTextures(this);
    this.scene.start(new URLSearchParams(window.location.search).has('seed') ? 'Battle' : 'Menu');
  }

  /** Проверка манифеста: число кадров в загруженной текстуре = cols × rows. */
  private validateSheets(): void {
    const issues: string[] = this.registry.get('loadErrors') ?? [];
    for (const s of SHEETS) {
      if (!this.textures.exists(s.key)) continue;
      const tex = this.textures.get(s.key);
      const frames = tex.frameTotal - 1; // минус __BASE
      if (frames !== s.cols * s.rows) {
        const msg = `${s.key}: ожидалось ${s.cols * s.rows} кадров, в текстуре ${frames}`;
        issues.push(msg);
        console.warn('[assets]', msg);
      }
    }
    this.registry.set('loadErrors', issues);
  }
}
