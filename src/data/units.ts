// Связь игровых типов юнитов со спрайтами и визуальными параметрами (не баланс).
import type { EnemyType, PlayerClass } from './balance';

export type UnitType = PlayerClass | EnemyType;

const PLAYER_SPRITE: Record<PlayerClass, string> = {
  militia: 'militia',
  infantry: 'warrior',
  archer: 'archer',
  pike: 'lancer',
};

/** Ключ набора анимаций в UNIT_ANIMS. Командир — жёлтый, солдаты — синие. */
export function spriteKeyFor(type: UnitType, team: 'player' | 'enemy', commander = false): string {
  if (team === 'enemy') return type;
  return `${PLAYER_SPRITE[type as PlayerClass]}_${commander ? 'yellow' : 'blue'}`;
}

/** Высота полоски HP над «ногами» юнита, px. */
export const BAR_OFFSET: Record<string, number> = {
  militia: 58, warrior: 62, archer: 60, lancer: 60,
  goblin_torch: 58, harpoon_fish: 56, goblin_tnt: 56, goblin_barrel: 52, skull: 56, shaman: 66,
  troll: 150, minotaur: 120,
};

export function barOffsetFor(spriteKey: string): number {
  const base = spriteKey.replace(/_(blue|yellow)$/, '');
  return BAR_OFFSET[base] ?? 60;
}

export const CLASS_NAMES: Record<PlayerClass, string> = {
  militia: 'Ополчение',
  infantry: 'Пехота',
  archer: 'Лучники',
  pike: 'Копейщики',
};

/** Радиус «тела» для расталкивания, px. */
export const BODY_RADIUS: Record<string, number> = { troll: 30, minotaur: 34, goblin_barrel: 14 };
export const bodyRadius = (type: UnitType): number => BODY_RADIUS[type] ?? 12;

/** Цвет флажка отряда по его номеру (тот же — на карточке в интерфейсе). */
export const SQUAD_COLORS = [0xf2c14e, 0xe0483c, 0x63d66a, 0x9b6bd6, 0x4fb3e8, 0xf08a3c];
