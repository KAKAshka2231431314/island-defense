// Технические константы отрисовки и управления (не баланс — баланс в balance.ts).

export const TILE = 64;

/** Слои глубины. Объекты на карте сортируются по Y: DEPTH.objects + y. */
export const DEPTH = {
  water: 0,
  waterDeco: 1,
  foam: 2,
  flat: 3,
  /** уровень L рисуется на levelBase + L * levelStep (+0 тень, +1 тайлы) */
  levelBase: 4,
  levelStep: 2,
  objects: 100,
  ui: 100000,
} as const;

/** Тайлсет для каждого уровня высоты (1 — плоская земля). */
export const TILESET_BY_LEVEL: Record<number, string> = {
  1: 'tiles_flat',
  2: 'tiles_high',
  3: 'tiles_l3',
};

export const CAMERA = {
  zoomLevels: [0.35, 0.5, 1, 2],
  panSpeed: 700, // px/с при зуме 1
  edgePad: 6144, // запас за краем мира (видно подплывающие лодки и вода покрывает широкие экраны)
} as const;

export const WATER_COLOR = 0x47aba9;
