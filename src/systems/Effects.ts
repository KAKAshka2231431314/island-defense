import Phaser from 'phaser';
import { DEPTH } from '../data/config';
import { settings } from '../data/settings';
import { fxKey } from './AnimationRegistry';

/** Одноразовые визуальные эффекты: взрывы, брызги, пыль, всплывающие числа урона. */
export class Effects {
  constructor(private readonly scene: Phaser.Scene, private readonly depthOf: (x: number, y: number) => number = (_x, y) => DEPTH.objects + y) {}

  /** Проиграть анимацию эффекта и удалить спрайт по окончании. */
  play(name: string, x: number, y: number, opts: { depth?: number; scale?: number; originY?: number } = {}): Phaser.GameObjects.Sprite | null {
    const key = fxKey(name);
    if (!this.scene.anims.exists(key)) return null;
    const anim = this.scene.anims.get(key);
    const tex = anim.frames[0].textureKey;
    const s = this.scene.add.sprite(x, y, tex)
      .setOrigin(0.5, opts.originY ?? 0.5)
      .setScale(opts.scale ?? 1)
      .setDepth(opts.depth ?? this.depthOf(x, y) + 1);
    s.play(key);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  }

  explosion(x: number, y: number, big = false): void {
    this.play(big ? 'explosion2' : 'explosion1', x, y - 20, { scale: big ? 0.9 : 0.7, depth: this.depthOf(x, y) + 40 });
  }

  splash(x: number, y: number): void {
    this.play('splash', x, y - 10, { scale: 0.6, depth: this.depthOf(x, y) + 2 });
  }

  dust(x: number, y: number): void {
    this.play('dust1', x, y - 6, { depth: this.depthOf(x, y) + 2 });
  }

  /** Короткая белая вспышка спрайта при попадании. */
  flash(target: Phaser.GameObjects.Sprite): void {
    target.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => { if (target.active) target.clearTint(); });
  }

  /** След контакта в направлении удара: видно, кто и откуда попал, даже без чисел урона. */
  hit(x: number, y: number, fromX: number, fromY: number, heavy = false): void {
    const g = this.scene.add.graphics().setPosition(x, y - 24).setDepth(this.depthOf(x, y) + 60);
    const a = Math.atan2(y - fromY, x - fromX), r = heavy ? 20 : 14;
    g.lineStyle(heavy ? 5 : 3, heavy ? 0xffc55c : 0xfff1c4, 1);
    g.beginPath();
    g.arc(0, 0, r, a - 0.85, a + 0.85);
    g.strokePath();
    g.lineStyle(2, 0xffffff, 0.9);
    for (const side of [-1, 1]) {
      const px = Math.cos(a + side * 1.2) * 5, py = Math.sin(a + side * 1.2) * 5;
      g.lineBetween(px, py, px * 2.2, py * 2.2);
    }
    this.scene.tweens.add({ targets: g, alpha: 0, scale: 1.35, duration: heavy ? 240 : 170, onComplete: () => g.destroy() });
  }

  /** Короткая вспышка на месте погибшего, чтобы потеря не терялась в плотном строю. */
  death(x: number, y: number, player: boolean): void {
    const color = player ? 0xffd84a : 0xff725e;
    const g = this.scene.add.graphics().setPosition(x, y - 18).setDepth(this.depthOf(x, y) + 70);
    g.lineStyle(3, color, 1).strokeCircle(0, 0, 10);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineBetween(Math.cos(a) * 13, Math.sin(a) * 13, Math.cos(a) * 20, Math.sin(a) * 20);
    }
    this.scene.tweens.add({ targets: g, alpha: 0, scale: 1.5, duration: 340, onComplete: () => g.destroy() });
  }

  damageNumber(x: number, y: number, amount: number, color = '#ffffff'): void {
    if (!settings.showDamageNumbers) return;
    const t = this.scene.add.text(x, y, String(Math.round(amount)), {
      fontFamily: 'monospace', fontSize: '14px', color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(DEPTH.ui - 5);
    this.scene.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  /** Металлический «дзынь» при блоке щитом — короткая искра кодом. */
  block(x: number, y: number): void {
    const g = this.scene.add.graphics().setDepth(this.depthOf(x, y) + 50);
    g.lineStyle(2, 0xfff2a0, 1);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.lineBetween(x + Math.cos(a) * 3, y + Math.sin(a) * 3, x + Math.cos(a) * 9, y + Math.sin(a) * 9);
    }
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 250, onComplete: () => g.destroy() });
  }
}
