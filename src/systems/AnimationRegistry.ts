import Phaser from 'phaser';
import { FX_ANIMS, UNIT_ANIMS, type AnimDef, type AnimState } from '../data/assetManifest';

export const animKey = (unit: string, state: AnimState): string => `${unit}:${state}`;
export const fxKey = (name: string): string => `fx:${name}`;

export function hasAnim(scene: Phaser.Scene, unit: string, state: AnimState): boolean {
  return scene.anims.exists(animKey(unit, state));
}

function create(scene: Phaser.Scene, key: string, def: AnimDef): void {
  if (scene.anims.exists(key) || !scene.textures.exists(def.sheet)) return;
  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNumbers(def.sheet, { start: def.start, end: def.end }),
    frameRate: def.frameRate,
    repeat: def.repeat,
  });
}

/** Создаёт все анимации из манифеста. Вызывается один раз после загрузки. */
export function registerAnimations(scene: Phaser.Scene): void {
  for (const [unit, set] of Object.entries(UNIT_ANIMS)) {
    for (const [state, def] of Object.entries(set.anims)) {
      if (def) create(scene, animKey(unit, state as AnimState), def);
    }
  }
  for (const [name, def] of Object.entries(FX_ANIMS)) create(scene, fxKey(name), def);
}
