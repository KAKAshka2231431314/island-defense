import Phaser from 'phaser';
import { UNIT_ANIMS, type AnimState } from '../data/assetManifest';
import { DEPTH } from '../data/config';
import { animKey } from '../systems/AnimationRegistry';

/** Спрайт юнита с анимациями из манифеста: проигрывание состояний, разворот, сортировка по Y. */
export class UnitView extends Phaser.GameObjects.Sprite {
  private readonly baseOriginY: number;

  constructor(scene: Phaser.Scene, x: number, y: number, readonly unitKey: string) {
    const set = UNIT_ANIMS[unitKey];
    if (!set) throw new Error(`Неизвестный юнит: ${unitKey}`);
    const idle = set.anims.idle!;
    super(scene, x, y, idle.sheet, idle.start);
    this.baseOriginY = set.originY;
    this.setOrigin(0.5, set.originY);
    scene.add.existing(this);
    this.playState('idle');
    this.syncDepth();

    this.on(Phaser.Animations.Events.ANIMATION_COMPLETE, (anim: Phaser.Animations.Animation) => {
      if (anim.key === animKey(this.unitKey, 'death')) this.playState('decay');
    });
  }

  hasState(state: AnimState): boolean {
    return this.scene.anims.exists(animKey(this.unitKey, state));
  }

  /** Длительность анимации состояния в секундах (0 — нет такой). */
  duration(state: AnimState): number {
    const anim = this.scene.anims.get(animKey(this.unitKey, state));
    return anim ? anim.duration / 1000 : 0;
  }

  /** Проиграть состояние; false — если такой анимации у юнита нет. */
  playState(state: AnimState, ignoreIfPlaying = true): boolean {
    const key = animKey(this.unitKey, state);
    if (!this.scene.anims.exists(key)) return false;
    // общий лист смерти имеет другой размер кадра — у него «ноги» ниже
    const sheet = UNIT_ANIMS[this.unitKey].anims[state]?.sheet;
    this.setOrigin(0.5, sheet === 'dead' ? 0.7 : this.baseOriginY);
    this.play(key, ignoreIfPlaying);
    return true;
  }

  /** Направление (вверх / вверх-вбок / вбок / вниз-вбок / вниз) по вектору прицела; влево — через flipX. */
  private static dir(aimX: number, aimY: number): 'up' | 'upright' | '' | 'downright' | 'down' {
    const deg = (Math.atan2(aimY, Math.abs(aimX)) * 180) / Math.PI;
    return deg < -67.5 ? 'up' : deg < -22.5 ? 'upright' : deg <= 22.5 ? '' : deg <= 67.5 ? 'downright' : 'down';
  }

  /** Стойка (щит поднят / копьё опущено) лицом к (aimX, aimY). */
  playGuard(aimX = 1, aimY = 0): boolean {
    const d = UnitView.dir(aimX, aimY);
    if (d && this.hasState(`guard_${d}` as AnimState)) return this.playState(`guard_${d}` as AnimState);
    return this.playState('guard');
  }

  /** Анимация атаки (с замахом, если он есть) в сторону (aimX, aimY). Возвращает общую длительность, с. */
  playAttack(aimX = 1, aimY = 0): number {
    if (this.hasState('attack_up')) {
      // угол от горизонтали, левая сторона зеркалится через flipX
      const deg = (Math.atan2(aimY, Math.abs(aimX)) * 180) / Math.PI;
      const state: AnimState = deg < -67.5 ? 'attack_up' : deg < -22.5 ? 'attack_upright' : deg <= 22.5 ? 'attack' : deg <= 67.5 ? 'attack_downright' : 'attack_down';
      this.playState(state, false);
      return this.duration(state);
    }
    if (this.hasState('windup')) {
      this.playState('windup', false);
      this.chain(animKey(this.unitKey, 'attack'));
      return this.duration('windup') + this.duration('attack');
    }
    if (this.hasState('fuse')) {
      this.playState('fuse', false);
      return this.duration('fuse');
    }
    this.playState('attack', false);
    return this.duration('attack');
  }

  face(dirX: number): void {
    if (dirX !== 0) this.setFlipX(dirX < 0);
  }

  /** depth — из systems/depth (учитывает высоты); без него — просто по Y. */
  syncDepth(depth?: number): void {
    this.setDepth(depth ?? DEPTH.objects + this.y);
  }
}
