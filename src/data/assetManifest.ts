// Манифест ассетов. Все пути относительно `assets/` (Vite publicDir).
// Размеры кадров проверены по заголовкам PNG и визуально (см. docs/ASSETS.md).
// Все персонажи в паках смотрят вправо; влево — flipX.

const FP = 'tiny-swords/free-pack';
const LG = 'tiny-swords/legacy';
const EP = 'tiny-swords/enemy-pack/Enemies';

export interface SheetDef {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  /** кадров в ряду */
  cols: number;
  /** рядов (1 для горизонтальной ленты) */
  rows: number;
}

export interface ImageDef {
  key: string;
  path: string;
}

/** Анимация = диапазон кадров внутри одного листа. */
export interface AnimDef {
  sheet: string;
  start: number;
  end: number;
  frameRate: number;
  repeat: number; // -1 = зациклить
}

export type AnimState = 'idle' | 'run' | 'attack' | 'attack2' | 'guard' | 'death' | 'decay' | 'windup' | 'recover' | 'throw' | 'popup' | 'fuse'
  // направленные атаки (копейщик): вправо — обычная attack, влево — отражение
  | 'attack_up' | 'attack_upright' | 'attack_downright' | 'attack_down'
  // направленная стойка (копейщик опускает копьё)
  | 'guard_up' | 'guard_upright' | 'guard_downright' | 'guard_down';

export interface UnitAnimSet {
  /** во что превращается при смерти, если своей анимации нет */
  anims: Partial<Record<AnimState, AnimDef>>;
  /** вертикальное смещение «ног» внутри кадра (origin Y) */
  originY: number;
}

// ---------- helpers ----------
const strip = (key: string, path: string, size: number, frames: number, h = size): SheetDef => ({
  key, path, frameWidth: size, frameHeight: h, cols: frames, rows: 1,
});
const grid = (key: string, path: string, size: number, cols: number, rows: number): SheetDef => ({
  key, path, frameWidth: size, frameHeight: size, cols, rows,
});
const a = (sheet: string, start: number, end: number, frameRate = 10, repeat = -1): AnimDef => ({
  sheet, start, end, frameRate, repeat,
});

// ======================================================================
// Спрайт-листы
// ======================================================================

export const PLAYER_COLORS = ['Blue', 'Yellow'] as const; // Blue — солдаты, Yellow — командир

function playerSheets(color: string): SheetDef[] {
  const u = `${FP}/Units/${color} Units`;
  const c = color.toLowerCase();
  return [
    // Ополченец (Pawn с ножом) — отряд до выбора класса
    strip(`militia_${c}_idle`, `${u}/Pawn/Pawn_Idle Knife.png`, 192, 8),
    strip(`militia_${c}_run`, `${u}/Pawn/Pawn_Run Knife.png`, 192, 6),
    strip(`militia_${c}_attack`, `${u}/Pawn/Pawn_Interact Knife.png`, 192, 4),
    // Warrior 192×192
    strip(`warrior_${c}_idle`, `${u}/Warrior/Warrior_Idle.png`, 192, 8),
    strip(`warrior_${c}_run`, `${u}/Warrior/Warrior_Run.png`, 192, 6),
    strip(`warrior_${c}_attack1`, `${u}/Warrior/Warrior_Attack1.png`, 192, 4),
    strip(`warrior_${c}_attack2`, `${u}/Warrior/Warrior_Attack2.png`, 192, 4),
    strip(`warrior_${c}_guard`, `${u}/Warrior/Warrior_Guard.png`, 192, 6),
    // Archer 192×192
    strip(`archer_${c}_idle`, `${u}/Archer/Archer_Idle.png`, 192, 6),
    strip(`archer_${c}_run`, `${u}/Archer/Archer_Run.png`, 192, 4),
    strip(`archer_${c}_shoot`, `${u}/Archer/Archer_Shoot.png`, 192, 8),
    // Lancer 320×320 (атака/защита по 5 направлениям; влево — flipX)
    strip(`lancer_${c}_idle`, `${u}/Lancer/Lancer_Idle.png`, 320, 12),
    strip(`lancer_${c}_run`, `${u}/Lancer/Lancer_Run.png`, 320, 6),
    ...(['Right', 'Down', 'Up', 'DownRight', 'UpRight'] as const).flatMap((d) => [
      strip(`lancer_${c}_attack_${d.toLowerCase()}`, `${u}/Lancer/Lancer_${d}_Attack.png`, 320, 3),
      strip(`lancer_${c}_defence_${d.toLowerCase()}`, `${u}/Lancer/Lancer_${d}_Defence.png`, 320, 6),
    ]),
  ];
}

export const SHEETS: SheetDef[] = [
  ...PLAYER_COLORS.flatMap(playerSheets),

  // Смерть людей (своей death-анимации у юнитов free-pack нет): 128×128, 7×2
  //   ряд 0 — падение в череп (0–6), ряд 1 — череп исчезает (7–13)
  grid('dead', `${LG}/Factions/Knights/Troops/Dead/Dead.png`, 128, 7, 2),

  // ---- Враги: гоблины (legacy), сетки 192×192 ----
  // Torch 7×5: idle 0–6, run 7–12, attack→ 14–19, attack↓ 21–26, attack↑ 28–33
  grid('goblin_torch', `${LG}/Factions/Goblins/Troops/Torch/Red/Torch_Red.png`, 192, 7, 5),
  // TNT 7×3: idle 0–5, run 7–12, throw 14–20
  grid('goblin_tnt', `${LG}/Factions/Goblins/Troops/TNT/Red/TNT_Red.png`, 192, 7, 3),
  strip('dynamite', `${LG}/Factions/Goblins/Troops/TNT/Dynamite/Dynamite.png`, 64, 6),
  // Barrel 128×128, 6×6: 0 закрыта, 6–11 вылезает, 12 выглядывает, 18–23 бег, 24–26 прячется, 30–32 фитиль
  grid('goblin_barrel', `${LG}/Factions/Goblins/Troops/Barrel/Red/Barrel_Red.png`, 128, 6, 6),

  // ---- Враги: enemy pack ----
  // Гарпунщик (рыба) 192×192; гарпун 64×64 нарисован по диагонали ↗ (поворот −45°)
  strip('harpoon_idle', `${EP}/Harpoon Fish/HarpoonFish_Idle.png`, 192, 8),
  strip('harpoon_run', `${EP}/Harpoon Fish/HarpoonFish_Run.png`, 192, 6),
  strip('harpoon_throw', `${EP}/Harpoon Fish/HarpoonFish_Throw.png`, 192, 8),

  strip('skull_idle', `${EP}/Skull/Skull_Idle.png`, 192, 8),
  strip('skull_run', `${EP}/Skull/Skull_Run.png`, 192, 6),
  strip('skull_attack', `${EP}/Skull/Skull_Attack.png`, 192, 7),
  strip('skull_guard', `${EP}/Skull/Skull_Guard.png`, 192, 7),

  strip('troll_idle', `${EP}/Troll/Troll_Idle.png`, 384, 12),
  strip('troll_walk', `${EP}/Troll/Troll_Walk.png`, 384, 10),
  strip('troll_windup', `${EP}/Troll/Troll_Windup.png`, 384, 5),
  strip('troll_attack', `${EP}/Troll/Troll_Attack.png`, 384, 6),
  strip('troll_recovery', `${EP}/Troll/Troll_Recovery.png`, 384, 10),
  strip('troll_dead', `${EP}/Troll/Troll_Dead.png`, 384, 10),

  strip('shaman_idle', `${EP}/Shaman/Shaman_Idle.png`, 192, 8),
  strip('shaman_run', `${EP}/Shaman/Shaman_Run.png`, 192, 4),
  strip('shaman_attack', `${EP}/Shaman/Shaman_Attack.png`, 192, 10),
  strip('shaman_projectile', `${EP}/Shaman/Shaman_Projectile.png`, 128, 3),
  strip('shaman_explosion', `${EP}/Shaman/Shaman_Explosion.png`, 128, 9),

  strip('minotaur_idle', `${EP}/Minotaur/Minotaur_Idle.png`, 320, 16),
  strip('minotaur_walk', `${EP}/Minotaur/Minotaur_Walk.png`, 320, 8),
  strip('minotaur_attack', `${EP}/Minotaur/Minotaur_Attack.png`, 320, 12),
  strip('minotaur_guard', `${EP}/Minotaur/Minotaur_Guard.png`, 320, 11),

  // Лодка 256×256, 8 кадров покачивания
  strip('boat', `${EP}/Boat/Boat_Idle.png`, 256, 8),

  // ---- Террейн ----
  // Тайлсет 64×64, 9×6. См. TILE_IDX ниже.
  // уровни читаются по цвету: бухты-причалы — оливковые, основа острова — зелёная, верхние террасы — светлые
  grid('tiles_flat', `${FP}/Terrain/Tileset/Tilemap_color4.png`, 64, 9, 6),
  grid('tiles_high', `${FP}/Terrain/Tileset/Tilemap_color3.png`, 64, 9, 6),
  grid('tiles_l3', `${FP}/Terrain/Tileset/Tilemap_color1.png`, 64, 9, 6),
  // прямые ступени по склону (нижний ряд legacy-тайлсета возвышенностей)
  grid('tiles_elev_legacy', `${LG}/Terrain/Ground/Tilemap_Elevation.png`, 64, 4, 8),
  strip('water_foam', `${FP}/Terrain/Tileset/Water Foam.png`, 192, 16),
  strip('water_rocks1', `${FP}/Terrain/Decorations/Rocks in the Water/Water Rocks_01.png`, 64, 16),
  strip('water_rocks2', `${FP}/Terrain/Decorations/Rocks in the Water/Water Rocks_02.png`, 64, 16),

  // ---- Декор ----
  strip('tree1', `${FP}/Terrain/Resources/Wood/Trees/Tree1.png`, 192, 8, 256),
  strip('tree2', `${FP}/Terrain/Resources/Wood/Trees/Tree2.png`, 192, 8, 256),
  strip('tree3', `${FP}/Terrain/Resources/Wood/Trees/Tree3.png`, 192, 8),
  strip('tree4', `${FP}/Terrain/Resources/Wood/Trees/Tree4.png`, 192, 8),
  strip('bush1', `${FP}/Terrain/Decorations/Bushes/Bushe1.png`, 128, 8),
  strip('bush2', `${FP}/Terrain/Decorations/Bushes/Bushe2.png`, 128, 8),
  strip('sheep_idle', `${FP}/Terrain/Resources/Meat/Sheep/Sheep_Idle.png`, 128, 6),
  strip('sheep_move', `${FP}/Terrain/Resources/Meat/Sheep/Sheep_Move.png`, 128, 4),
  strip('sheep_grass', `${FP}/Terrain/Resources/Meat/Sheep/Sheep_Grass.png`, 128, 12),

  // ---- Эффекты ----
  strip('fx_fire1', `${FP}/Particle FX/Fire_01.png`, 64, 8),
  strip('fx_fire2', `${FP}/Particle FX/Fire_02.png`, 64, 10),
  strip('fx_fire3', `${FP}/Particle FX/Fire_03.png`, 64, 12),
  strip('fx_explosion1', `${FP}/Particle FX/Explosion_01.png`, 192, 8),
  strip('fx_explosion2', `${FP}/Particle FX/Explosion_02.png`, 192, 10),
  strip('fx_dust1', `${FP}/Particle FX/Dust_01.png`, 64, 8),
  strip('fx_dust2', `${FP}/Particle FX/Dust_02.png`, 64, 10),
  strip('fx_splash', `${FP}/Particle FX/Water Splash.png`, 192, 9),
  strip('fx_heal', `${FP}/Units/Blue Units/Monk/Heal_Effect.png`, 192, 11),
];

// ======================================================================
// Одиночные изображения
// ======================================================================

export const IMAGES: ImageDef[] = [
  { key: 'water_bg', path: `${FP}/Terrain/Tileset/Water Background color.png` },
  { key: 'shadow', path: `${FP}/Terrain/Tileset/Shadow.png` }, // 192×192, под каждой клеткой возвышенности
  { key: 'arrow', path: `${FP}/Units/Blue Units/Archer/Arrow.png` }, // 64×64
  { key: 'harpoon', path: `${EP}/Harpoon Fish/Harpoon.png` }, // 64×64, остриё ↗

  // Дома 128×192 (синие = игрок). Разрушенный дом — legacy.
  { key: 'house1', path: `${FP}/Buildings/Blue Buildings/House1.png` },
  { key: 'house2', path: `${FP}/Buildings/Blue Buildings/House2.png` },
  { key: 'house3', path: `${FP}/Buildings/Blue Buildings/House3.png` },
  { key: 'barracks', path: `${FP}/Buildings/Blue Buildings/Barracks.png` },
  { key: 'castle', path: `${FP}/Buildings/Blue Buildings/Castle.png` },
  { key: 'house_destroyed', path: `${LG}/Factions/Knights/Buildings/House/House_Destroyed.png` },
  { key: 'castle_destroyed', path: `${LG}/Factions/Knights/Buildings/Castle/Castle_Destroyed.png` },

  // Камни 64×64
  ...[1, 2, 3, 4].map((i) => ({ key: `rock${i}`, path: `${FP}/Terrain/Decorations/Rocks/Rock${i}.png` })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ key: `cloud${i}`, path: `${FP}/Terrain/Decorations/Clouds/Clouds_0${i}.png` })),

  // UI
  { key: 'ui_banner', path: `${FP}/UI Elements/UI Elements/Banners/Banner.png` }, // 448×448, 9-slice
  { key: 'ui_paper', path: `${FP}/UI Elements/UI Elements/Papers/RegularPaper.png` }, // 320×320, 9-slice
  { key: 'ui_paper_special', path: `${FP}/UI Elements/UI Elements/Papers/SpecialPaper.png` },
  { key: 'ui_wood', path: `${FP}/UI Elements/UI Elements/Wood Table/WoodTable.png` }, // 448×448, 9-slice
  { key: 'ui_bar_base', path: `${FP}/UI Elements/UI Elements/Bars/SmallBar_Base.png` }, // 320×64
  { key: 'ui_bar_fill', path: `${FP}/UI Elements/UI Elements/Bars/SmallBar_Fill.png` }, // 64×64
  { key: 'ui_btn_blue', path: `${FP}/UI Elements/UI Elements/Buttons/BigBlueButton_Regular.png` },
  { key: 'ui_btn_blue_p', path: `${FP}/UI Elements/UI Elements/Buttons/BigBlueButton_Pressed.png` },
  { key: 'ui_btn_red', path: `${FP}/UI Elements/UI Elements/Buttons/BigRedButton_Regular.png` },
  { key: 'ui_btn_red_p', path: `${FP}/UI Elements/UI Elements/Buttons/BigRedButton_Pressed.png` },
  { key: 'ui_btn_round', path: `${FP}/UI Elements/UI Elements/Buttons/SmallBlueRoundButton_Regular.png` },
  { key: 'ui_btn_round_p', path: `${FP}/UI Elements/UI Elements/Buttons/SmallBlueRoundButton_Pressed.png` },
  { key: 'ui_btn_sq', path: `${FP}/UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Regular.png` }, // 128×128
  { key: 'ui_btn_sq_p', path: `${FP}/UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Pressed.png` },
  { key: 'ui_bigbar_base', path: `${FP}/UI Elements/UI Elements/Bars/BigBar_Base.png` }, // 320×64, 3-slice
  { key: 'ui_bigbar_fill', path: `${FP}/UI Elements/UI Elements/Bars/BigBar_Fill.png` }, // 64×64, полоса в рядах 20–44
  { key: 'ui_slot', path: `${FP}/UI Elements/UI Elements/Banners/Banner_Slots.png` }, // 192×192, ячейка под портрет
  // ленты (3-slice по горизонтали): Big — 5 цветов по 128 px, Small — 10 рядов по 64 px
  { key: 'ui_ribbons_big', path: `${FP}/UI Elements/UI Elements/Ribbons/BigRibbons.png` },
  { key: 'ui_ribbons_small', path: `${FP}/UI Elements/UI Elements/Ribbons/SmallRibbons.png` },
  { key: 'ui_cursor', path: `${FP}/UI Elements/UI Elements/Cursors/Cursor_01.png` },
  // стрелка-указатель (legacy): смотрит вверх-влево, в меню повёрнута вправо
  { key: 'ui_pointer', path: `${LG}/UI/Pointers/01.png` },
  // кирка — значок ополчения на карточке отряда
  { key: 'tool_pickaxe', path: `${FP}/Terrain/Resources/Tools/Tool_04.png` },
  ...Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { key: `icon_${n}`, path: `${FP}/UI Elements/UI Elements/Icons/Icon_${n}.png` };
  }),
  // Портреты командиров 256×256
  ...Array.from({ length: 25 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { key: `avatar_${n}`, path: `${FP}/UI Elements/UI Elements/Human Avatars/Avatars_${n}.png` };
  }),
  // Портреты врагов 256×256 (16 шт.)
  ...Array.from({ length: 16 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { key: `enemy_avatar_${n}`, path: `tiny-swords/enemy-pack/Enemy Avatars/Enemy Avatars_${n}.png` };
  }),
];

// ======================================================================
// Тайлсет (индексы кадров в 'tiles_flat' / 'tiles_high', сетка 9×6)
// ======================================================================
//  Кол. 0–3: плоская земля. 3×3 автотайл (кол. 0–2, ряд 0–2),
//    вертикальная полоса кол. 3 (ряд 0–2), горизонтальная ряд 3 (кол. 0–2), одиночный (3,3).
//    Лестницы: (0,4)-(0,5) — левая, (3,4)-(3,5) — правая.
//  Кол. 5–8: возвышенность, та же раскладка трава 3×3 / полосы / одиночный,
//    ряд 4 — скала, обращённая к нижней земле; ряд 5 — скала, обращённая к воде.
const t = (col: number, row: number) => row * 9 + col;
export const TILE_IDX = {
  flat: {
    tl: t(0, 0), t: t(1, 0), tr: t(2, 0),
    l: t(0, 1), c: t(1, 1), r: t(2, 1),
    bl: t(0, 2), b: t(1, 2), br: t(2, 2),
    vTop: t(3, 0), vMid: t(3, 1), vBot: t(3, 2),
    hLeft: t(0, 3), hMid: t(1, 3), hRight: t(2, 3),
    single: t(3, 3),
    stairLeftTop: t(0, 4), stairLeftBot: t(0, 5),
    stairRightTop: t(3, 4), stairRightBot: t(3, 5),
  },
  high: {
    tl: t(5, 0), t: t(6, 0), tr: t(7, 0),
    l: t(5, 1), c: t(6, 1), r: t(7, 1),
    bl: t(5, 2), b: t(6, 2), br: t(7, 2),
    vTop: t(8, 0), vMid: t(8, 1), vBot: t(8, 2),
    hLeft: t(5, 3), hMid: t(6, 3), hRight: t(7, 3),
    single: t(8, 3),
    cliffLeft: t(5, 4), cliffMid: t(6, 4), cliffRight: t(7, 4), cliffSingle: t(8, 4),
    cliffWaterLeft: t(5, 5), cliffWaterMid: t(6, 5), cliffWaterRight: t(7, 5), cliffWaterSingle: t(8, 5),
  },
} as const;

// ======================================================================
// Наборы анимаций юнитов (idle / run / attack / death ...)
// ======================================================================

/** Смерть для всех людей и гоблинов: общий лист 'dead'. */
const DEATH = a('dead', 0, 6, 10, 0);
const DECAY = a('dead', 7, 13, 6, 0);

function playerUnits(color: string): Record<string, UnitAnimSet> {
  const c = color.toLowerCase();
  return {
    [`militia_${c}`]: {
      originY: 0.62,
      anims: {
        idle: a(`militia_${c}_idle`, 0, 7, 8),
        run: a(`militia_${c}_run`, 0, 5, 12),
        attack: a(`militia_${c}_attack`, 0, 3, 10, 0),
        death: DEATH, decay: DECAY,
      },
    },
    [`warrior_${c}`]: {
      originY: 0.62,
      anims: {
        idle: a(`warrior_${c}_idle`, 0, 7, 8),
        run: a(`warrior_${c}_run`, 0, 5, 12),
        attack: a(`warrior_${c}_attack1`, 0, 3, 12, 0),
        attack2: a(`warrior_${c}_attack2`, 0, 3, 12, 0),
        guard: a(`warrior_${c}_guard`, 0, 5, 8),
        death: DEATH, decay: DECAY,
      },
    },
    [`archer_${c}`]: {
      originY: 0.62,
      anims: {
        idle: a(`archer_${c}_idle`, 0, 5, 8),
        run: a(`archer_${c}_run`, 0, 3, 10),
        attack: a(`archer_${c}_shoot`, 0, 7, 12, 0), // стрела вылетает на кадре 5
        death: DEATH, decay: DECAY,
      },
    },
    [`lancer_${c}`]: {
      originY: 0.58,
      anims: {
        idle: a(`lancer_${c}_idle`, 0, 11, 10),
        run: a(`lancer_${c}_run`, 0, 5, 12),
        attack: a(`lancer_${c}_attack_right`, 0, 2, 10, 0),
        attack_up: a(`lancer_${c}_attack_up`, 0, 2, 10, 0),
        attack_upright: a(`lancer_${c}_attack_upright`, 0, 2, 10, 0),
        attack_downright: a(`lancer_${c}_attack_downright`, 0, 2, 10, 0),
        attack_down: a(`lancer_${c}_attack_down`, 0, 2, 10, 0),
        guard_up: a(`lancer_${c}_defence_up`, 0, 5, 8),
        guard_upright: a(`lancer_${c}_defence_upright`, 0, 5, 8),
        guard_downright: a(`lancer_${c}_defence_downright`, 0, 5, 8),
        guard_down: a(`lancer_${c}_defence_down`, 0, 5, 8),
        guard: a(`lancer_${c}_defence_right`, 0, 5, 8),
        death: DEATH, decay: DECAY,
      },
    },
  };
}

export const UNIT_ANIMS: Record<string, UnitAnimSet> = {
  ...PLAYER_COLORS.reduce((acc, col) => ({ ...acc, ...playerUnits(col) }), {} as Record<string, UnitAnimSet>),

  // Враг-пехотинец + поджигатель домов
  goblin_torch: {
    originY: 0.62,
    anims: {
      idle: a('goblin_torch', 0, 6, 8),
      run: a('goblin_torch', 7, 12, 12),
      attack: a('goblin_torch', 14, 19, 12, 0),
      death: DEATH, decay: DECAY,
    },
  },
  // Враг-дальнобойщик: гарпунщик
  harpoon_fish: {
    originY: 0.62,
    anims: {
      idle: a('harpoon_idle', 0, 7, 8),
      run: a('harpoon_run', 0, 5, 12),
      attack: a('harpoon_throw', 0, 7, 12, 0), // гарпун вылетает на кадре 3
      death: DEATH, decay: DECAY,
    },
  },
  // Враг-громила (отбрасывание)
  troll: {
    originY: 0.7,
    anims: {
      idle: a('troll_idle', 0, 11, 8),
      run: a('troll_walk', 0, 9, 8),
      windup: a('troll_windup', 0, 4, 8, 0),
      attack: a('troll_attack', 0, 5, 12, 0),
      recover: a('troll_recovery', 0, 9, 10, 0),
      death: a('troll_dead', 0, 9, 10, 0),
    },
  },
  // Враг-взрывник (кидает динамит)
  goblin_tnt: {
    originY: 0.62,
    anims: {
      idle: a('goblin_tnt', 0, 5, 8),
      run: a('goblin_tnt', 7, 12, 12),
      attack: a('goblin_tnt', 14, 20, 12, 0), // динамит вылетает на кадре 18
      death: DEATH, decay: DECAY,
    },
  },
  // Враг-камикадзе (бочка): подбегает и взрывается
  goblin_barrel: {
    originY: 0.65,
    anims: {
      idle: a('goblin_barrel', 0, 0, 1),
      popup: a('goblin_barrel', 6, 11, 10, 0),
      run: a('goblin_barrel', 18, 23, 12),
      fuse: a('goblin_barrel', 30, 32, 10),
      death: DEATH, decay: DECAY,
    },
  },
  // Щитовик (поздние волны)
  skull: {
    originY: 0.62,
    anims: {
      idle: a('skull_idle', 0, 7, 8),
      run: a('skull_run', 0, 5, 12),
      attack: a('skull_attack', 0, 6, 12, 0),
      guard: a('skull_guard', 0, 6, 8),
      death: DEATH, decay: DECAY,
    },
  },
  // Маг (поздние волны)
  shaman: {
    originY: 0.62,
    anims: {
      idle: a('shaman_idle', 0, 7, 8),
      run: a('shaman_run', 0, 3, 10),
      attack: a('shaman_attack', 0, 9, 12, 0),
      death: DEATH, decay: DECAY,
    },
  },
  // Босс финального острова
  minotaur: {
    originY: 0.66,
    anims: {
      idle: a('minotaur_idle', 0, 15, 10),
      run: a('minotaur_walk', 0, 7, 10),
      attack: a('minotaur_attack', 0, 11, 12, 0),
      guard: a('minotaur_guard', 0, 10, 10),
      death: DEATH, decay: DECAY,
    },
  },
};

/** Декор и эффекты: ключ анимации → кадры. */
export const FX_ANIMS: Record<string, AnimDef> = {
  boat: a('boat', 0, 7, 6),
  water_foam: a('water_foam', 0, 15, 8),
  water_rocks1: a('water_rocks1', 0, 15, 6),
  water_rocks2: a('water_rocks2', 0, 15, 6),
  tree1: a('tree1', 0, 7, 6), tree2: a('tree2', 0, 7, 6),
  tree3: a('tree3', 0, 7, 6), tree4: a('tree4', 0, 7, 6),
  bush1: a('bush1', 0, 7, 6), bush2: a('bush2', 0, 7, 6),
  sheep_idle: a('sheep_idle', 0, 5, 6),
  sheep_move: a('sheep_move', 0, 3, 8),
  sheep_grass: a('sheep_grass', 0, 11, 8),
  fire1: a('fx_fire1', 0, 7, 10), fire2: a('fx_fire2', 0, 9, 10), fire3: a('fx_fire3', 0, 11, 10),
  explosion1: a('fx_explosion1', 0, 7, 14, 0),
  explosion2: a('fx_explosion2', 0, 9, 14, 0),
  dust1: a('fx_dust1', 0, 7, 14, 0), dust2: a('fx_dust2', 0, 9, 14, 0),
  splash: a('fx_splash', 0, 8, 14, 0),
  heal: a('fx_heal', 0, 10, 12, 0),
  dynamite: a('dynamite', 0, 5, 14),
  shaman_projectile: a('shaman_projectile', 0, 2, 12),
  shaman_explosion: a('shaman_explosion', 0, 8, 14, 0),
};

/** Ассеты, которых нет ни в одном паке → заглушки кодом (см. TODO.md). */
export const MISSING = {
  sounds: true, // ни в одном паке нет аудио
  stairsSideways: true, // лестницы есть только вертикальные (вход снизу); боковые склоны — генератор ставит только их
} as const;
