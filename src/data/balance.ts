// Все игровые числа. Меняем баланс только здесь.

/** Генерация острова. Размеры — в клетках 64×64. */
export const ISLAND = {
  width: 34,
  height: 25,
  /** зоны отрядов — квадраты 2×2 клетки (mapgen/zones.ts → packSquares); обрезки закрываются декором */
  /** клеток воды по краю карты (там появляются лодки) */
  borderWater: 3,
  /** радиус эллипса-маски относительно размера карты */
  radiusX: 0.36,
  radiusY: 0.34,
  /** случайный сдвиг центра острова, доля от размера */
  centerJitter: 0.05,
  noiseFreq: 0.12,
  noiseOctaves: 3,
  noiseAmp: 0.55,
  landThreshold: 0.08,
  smoothPasses: 2,
  minLandCells: 240,
  maxLandCells: 470,

  /** остров как в Bad North: почти вдоль всего берега — низина уровня 1 (к ней пристают лодки),
   *  середина — плато уровня 2, на нём террасы уровня 3 */
  rockBase: true,
  /** глубина низины от воды, клеток (на юге на клетку больше — там под плато ряд скалы) */
  lowlandDepth: 2,
  /** местами на юге плато обрывается прямо в море — шум по парам столбцов (выше порога — обрыв) */
  southCliffFreq: 0.35,
  southCliffThreshold: 0.3,
  /** плато меньше этого (клеток) — попытка бракуется */
  plateauMinCells: 40,
  /** подъёмов с низины на плато: stairsPerPlateau плюс один на каждые столько клеток низины */
  stairRegionCells: 40,
  /** казарма рыцарей — среднее здание на два квадрата (4×2 клетки), даёт больше монет; шанс на острове */
  barracksChance: 0.7,

  /** возвышенности (при rockBase — террасы уровня 3 на основе острова) */
  plateauFreq: 0.16,
  plateauThreshold: -0.15,
  plateauCoastDist: 2, // мин. расстояние до воды
  plateauMinSize: 6,
  plateauMaxCount: 4,
  level3Chance: 0.5,
  level3Threshold: 0.3,
  level3MinSize: 4,
  stairsPerPlateau: [1, 2] as [number, number],
  /** холмы уровня 2 в низине — там, где берег достаточно широкий (блок 2×2 с лестницей) */
  lowlandHillMax: 2,
  /** вероятность, что в нижнюю область с плато ведёт боковой склон (слева/справа), а не только ступени в обрыве */
  sideRampChance: 0.65,

  /** точки высадки */
  landingMin: 3,
  landingMax: 6,
  landingClearance: 3, // клеток чистой воды перед берегом
  landingMinSpacing: 5,

  /** дома */
  housesMin: 2,
  housesMax: 5,
  /** дома (и казарма) не ближе этого друг к другу, клеток */
  houseSpacing: 6,
  /** максимальное суммарное удлинение маршрута от высадки из-за домов и рощ, клеток */
  houseMaxDetour: 8,
  houseCoastDist: 2,
  houseLandingDist: 4,

  /** декор */
  /** рощи у берега: сколько квадратов целиком под лес */
  forestClusters: 3,
  /** обрезки земли вне квадратов закрываются: доля деревьев (остальное — кусты и камни) */
  fillerTree: 0.75,
  bushDensity: 0.03,
  rockDensity: 0.008,
  sheepMin: 2,
  sheepMax: 4,
  waterRockChance: 0.025,

  /** попыток генерации на один сид, прежде чем сдаться */
  maxAttempts: 160,
} as const;

// ======================================================================
// Время
// ======================================================================
export const TIME = {
  /** замедление, пока выбран отряд (по умолчанию; игрок выбирает в настройках из MENU.slowMoOptions) */
  slowMo: 0.2,
  /** секунд реального времени на плавный переход в замедление и обратно */
  slowMoBlend: 0.15,
  /** множитель кнопки ускорения */
  fast: 2,
} as const;

// ======================================================================
// Движение и физика
// ======================================================================
export const MOVE = {
  arriveDist: 5,
  /** радиус расталкивания юнитов, px */
  separationRadius: 24,
  separationStrength: 140, // px/с при полном перекрытии
  /** как часто юнит перепроверяет прямую видимость цели, с */
  losRecheck: 0.25,
  /** затухание отбрасывания, 1/с (путь отлёта ≈ скорость / затухание) */
  knockbackDamping: 6,
  /** ниже этой скорости отбрасывание гасится полностью, px/с */
  knockbackStop: 12,
  /** урон от падения с уступа */
  fallDamage: 6,
  /** скорость падения спрайта с уступа, px/с */
  fallSpeed: 380,
  /** видимый подъём спрайта от подножия бокового склона к плато, px */
  sideStairRise: 18,
  /** сколько тонет юнит, с */
  drownTime: 0.7,
  /** оглушение после сильного удара, с */
  heavyHitStun: 0.35,
  /** сбросить в воду или с уступа может только удар с отлётом не слабее этого, px/с
   *  (пехота, копья, тролль, динамит — да; факел, гарпун, нож — нет) */
  edgeKnockMin: 120,
} as const;

// ======================================================================
// Юниты
// ======================================================================
export type PlayerClass = 'militia' | 'infantry' | 'archer' | 'pike';
export type EnemyType = 'goblin_torch' | 'harpoon_fish' | 'troll' | 'goblin_tnt' | 'goblin_barrel' | 'skull' | 'shaman' | 'minotaur';
export type ProjectileKind = 'arrow' | 'harpoon' | 'dynamite' | 'shaman_orb';

export interface UnitStats {
  hp: number;
  /** px/с */
  speed: number;
  damage: number;
  /** дистанция атаки, px (для стрелков — дальность выстрела) */
  range: number;
  /** пауза между атаками, с */
  cooldown: number;
  /** время от начала замаха до удара/выстрела, с */
  windup: number;
  /** начальная скорость отбрасывания цели, px/с */
  knockback: number;
  /** 0..1 — насколько юнит гасит чужое отбрасывание */
  knockResist: number;
  /** радиус, в котором юнит сам начинает бой, px */
  aggro: number;
  /** радиус поражения по площади (0 — одиночная цель) */
  splash?: number;
  projectile?: ProjectileKind;
  /** множитель урона стрелка по цели вплотную */
  closePenalty?: number;
  /** держит щит: блокирует снаряды спереди, пока не атакует */
  blocksFront?: boolean;
  /** оглушение цели при попадании, с */
  stun?: number;
}

const T = 64; // клетка, px

/** cooldown стрелков (лучники, гарпунщики, динамит, шаман) увеличен: стреляют реже — каждый выстрел весомее */
export const PLAYER_UNITS: Record<PlayerClass, UnitStats> = {
  militia: { hp: 20, speed: 95, damage: 3.5, range: 34, cooldown: 1.0, windup: 0.25, knockback: 70, knockResist: 0, aggro: 3 * T },
  infantry: { hp: 50, speed: 88, damage: 10, range: 38, cooldown: 0.9, windup: 0.2, knockback: 140, knockResist: 0.25, aggro: 3 * T, blocksFront: true },
  archer: {
    hp: 24, speed: 95, damage: 7, range: 6 * T, cooldown: 2.5, windup: 0.42, knockback: 30, knockResist: 0, aggro: 6 * T,
    projectile: 'arrow', closePenalty: 0.35,
  },
  pike: { hp: 40, speed: 82, damage: 9, range: 80, cooldown: 1.05, windup: 0.12, knockback: 220, knockResist: 0.3, aggro: 2.6 * T, stun: 0.5 },
};

export const ENEMY_UNITS: Record<EnemyType, UnitStats> = {
  goblin_torch: { hp: 24, speed: 90, damage: 11, range: 36, cooldown: 1.1, windup: 0.3, knockback: 90, knockResist: 0, aggro: 3 * T },
  harpoon_fish: {
    hp: 18, speed: 85, damage: 5, range: 4.5 * T, cooldown: 3.6, windup: 0.25, knockback: 50, knockResist: 0, aggro: 4.5 * T,
    projectile: 'harpoon', closePenalty: 0.6,
  },
  troll: { hp: 750, speed: 52, damage: 38, range: 72, cooldown: 3.4, windup: 0.75, knockback: 420, knockResist: 0.85, aggro: 3 * T, splash: 56 },
  goblin_tnt: {
    hp: 20, speed: 80, damage: 9, range: 4.5 * T, cooldown: 5.2, windup: 0.33, knockback: 160, knockResist: 0, aggro: 4.5 * T,
    projectile: 'dynamite', splash: 44,
  },
  goblin_barrel: { hp: 30, speed: 105, damage: 18, range: 40, cooldown: 1, windup: 1.0, knockback: 300, knockResist: 0.2, aggro: 8 * T, splash: 60 },
  skull: { hp: 40, speed: 80, damage: 8, range: 36, cooldown: 1.0, windup: 0.3, knockback: 100, knockResist: 0.2, aggro: 3 * T, blocksFront: true },
  shaman: {
    hp: 26, speed: 80, damage: 8, range: 5 * T, cooldown: 4.2, windup: 0.5, knockback: 120, knockResist: 0, aggro: 5 * T,
    projectile: 'shaman_orb', splash: 40,
  },
  minotaur: { hp: 650, speed: 62, damage: 32, range: 84, cooldown: 2.6, windup: 0.55, knockback: 480, knockResist: 0.95, aggro: 4 * T, splash: 80 },
};

/** spread — случайный разброс точки прицеливания, px (больше — чаще промахи) */
/**
 * Снаряды летят в точку, а не «в цель»: стрелок целится туда, где враг стоит в момент выстрела, с разбросом
 * scatterBase + scatterPerPx × дальность (по вертикали ×scatterYMult — вид сверху под углом). Попадание — если
 * в точке падения есть враг: ближе hitRadius + bodyRadius × bodyHitMult. Иначе снаряд втыкается в землю / тонет.
 * spread — разброс залпа способности лучников.
 */
export const PROJECTILES: Record<ProjectileKind, { speed: number; arc: number; hitRadius: number; spread: number; scatterBase: number; scatterPerPx: number }> = {
  arrow: { speed: 520, arc: 0.35, hitRadius: 7, spread: 12, scatterBase: 8, scatterPerPx: 0.11 },
  harpoon: { speed: 460, arc: 0.18, hitRadius: 10, spread: 22, scatterBase: 6, scatterPerPx: 0.065 },
  dynamite: { speed: 300, arc: 0.55, hitRadius: 0, spread: 22, scatterBase: 8, scatterPerPx: 0.06 },
  shaman_orb: { speed: 280, arc: 0.1, hitRadius: 0, spread: 14, scatterBase: 6, scatterPerPx: 0.04 },
};
export const PROJECTILE_HIT = {
  scatterYMult: 0.7,
  bodyHitMult: 0.8,
  /** острые снаряды (стрела, гарпун) убивают бойца без щита с одного попадания — и у игрока, и у врагов
   *  (у врага — с базовым здоровьем не больше oneShotMaxHp: тролль и минотавр держат); щитоносцы (пехота, скелеты)
   *  получают обычный урон; динамит и шар шамана бьют взрывом по площади */
  oneShotKinds: ['arrow', 'harpoon'] as ProjectileKind[],
  oneShotMaxHp: 50,
  /** промах и отскок от щита: снаряд торчит в земле столько секунд, последние stuckFadeSec — тает */
  stuckSec: 7,
  stuckFadeSec: 1.2,
  /** попадание в щит: боец вздрагивает (дрожь jolt* — затухающие колебания) и чуть отъезжает назад */
  shieldJoltSec: 0.28,
  shieldJoltPx: 3,
  shieldJoltHz: 26,
  shieldArrowKnock: 45,
};

// ======================================================================
// Отряды игрока
// ======================================================================
export const SQUAD = {
  /** солдат (без командира) по уровню отряда 0..3 — всегда 8: отряд = 9 бойцов, квадрат 3×3 */
  soldiersByLevel: [8, 8, 8, 8],
  commanderHpMult: 2,
  /** командира труднее сбить с ног (прибавка к сопротивлению отбрасыванию, не выше 0.9) */
  commanderKnockResist: 0.45,
  commanderDamageMult: 1.3,
  /** множители урона/HP по уровню 0..3 */
  levelHpMult: [1, 1.15, 1.35, 1.6],
  levelDamageMult: [1, 1.15, 1.3, 1.5],
  /** шаг квадратного строя, px (по Y меньше — вид сверху под углом) */
  spacingX: 36,
  spacingY: 30,
  /** место строя не дальше этого (в клетках пути) от центра — иначе переносится */
  formationMaxDetour: 3,
  /** солдат в одной клетке запасных мест строя */
  perCell: 3,
  slotOffset: 16,
  /** командир держится в строю: его «поводок» — эта доля поводка отряда */
  commanderLeashMult: 0.35,
  /** командир получает только эту долю урона по площади (его прикрывают солдаты) */
  commanderSplashMult: 0.5,
  /** насколько далеко пехота/ополчение отходит от точки стояния ради боя, px */
  leash: 3.5 * T,
  /** копейщики держат строй */
  pikeLeash: 0.6 * T,
  /** стрелки не бегут за целью */
  archerLeash: 0.3 * T,
  maxSquads: 4,
} as const;

// ======================================================================
// Дома
// ======================================================================
export const HOUSE = {
  /** наш отряд в этом радиусе от дома гасит поджог быстрее (AI.igniteDecayDefended), px */
  defendRadius: 2.2 * T,
  /** горит до разрушения, с */
  burnTime: 6,
  /** замок горит дольше дома, но его разрушение — поражение */
  castleBurnTime: 14,
  /** монет за уцелевший дом по варианту спрайта (House1..3) */
  coinsByVariant: [0, 3, 4, 5],
  /** монет за уцелевшую казарму рыцарей (среднее здание) */
  barracksCoins: 9,
  /** подойти к двери ближе этого, чтобы войти, px */
  enterRadius: 0.9 * T,
  /** задержка после входа, затем по солдату каждые healInterval, с */
  healEnterDelay: 1,
  healInterval: 2,
  /** доля HP, теряемая юнитами, если дом сгорел, пока они внутри */
  burnEjectDamage: 0.5,
} as const;

// ======================================================================
// Волны врагов
// ======================================================================
/** «Цена» врага в очках бюджета лодки. */
export const ENEMY_COST: Record<EnemyType, number> = {
  goblin_torch: 1, harpoon_fish: 1.5, skull: 1.5, goblin_tnt: 2.5, goblin_barrel: 2, shaman: 3, troll: 5, minotaur: 12,
};

/** С какой сложности острова появляется тип врага. */
export const ENEMY_UNLOCK: Record<EnemyType, number> = {
  goblin_torch: 0, harpoon_fish: 2, troll: 3, goblin_tnt: 3, skull: 3, goblin_barrel: 4, shaman: 4, minotaur: 99,
};

export const WAVES = {
  /** волн на острове: base + сложность × perDifficulty (округл. вниз), не больше max */
  countBase: 2,
  countPerDifficulty: 0.5,
  countMax: 4,
  /** лодок в волне: 1 + сложность × perDifficulty + номер волны × perWave */
  boatsPerDifficulty: 0.35,
  boatsPerWave: 0.5,
  boatsMax: 4,
  /** бюджет всей волны в очках (делится между лодками): base + сложность × perDifficulty + номер волны × perWave */
  waveBudgetBase: 3.5,
  waveBudgetPerDifficulty: 4.0,
  waveBudgetPerWave: 2,
  /** врагов в одном десанте к одному берегу (делится на лодки) */
  boatCapacity: 9,
  /** мест в одной лодке; крупные враги занимают больше */
  boatSeats: 4,
  seatCost: { troll: 4, minotaur: 4 } as Partial<Record<EnemyType, number>>,
  /** лодки к одному берегу подходят с задержкой друг за другом, с */
  boatStagger: 2.2,
  /** и разъезжаются вдоль берега на столько px */
  boatLateral: 56,
  /** финальный остров: доп. волна с боссом и множитель бюджета */
  finalBudgetMult: 1.0,
  /** пауза перед первой волной и между волнами, с */
  firstDelay: 8,
  minGap: 6,
  /** следующая волна приходит, когда врагов осталось ≤ этой доли или прошло maxWaveTime */
  nextWhenAliveFraction: 0.25,
  maxWaveTime: 50,
  boatSpeed: 80,
  unloadInterval: 0.3,
  /** отступающие не добежали до лодки за столько секунд — лодка уплывает без них (оставшиеся бьются до конца) */
  retreatWaitSec: 18,
  /** состав волны по ролям: основа (рядовые, щитоносцы), поддержка (стрелки, шаман), угроза (громила, подрывник, бочка);
   *  доли бюджета волны; роль, которой на острове ещё нет (ENEMY_UNLOCK), отдаёт долю основе */
  roleShare: { base: 0.6, support: 0.22, threat: 0.18 },
  /** лодка появляется за краем карты на столько клеток */
  spawnOffshore: 10,
} as const;

// ======================================================================
// Способности и предметы
// ======================================================================
export const ABILITY = {
  /** перезарядка по классу, с (уменьшается с уровнем способности) */
  cooldown: { infantry: 18, archer: 20, pike: 16, militia: 0 } as Record<PlayerClass, number>,
  cooldownPerLevel: 0.12, // −12% за каждый уровень выше первого
  powerPerLevel: 0.3, // +30% силы за уровень выше первого
  maxLevel: 3,
  /** щитовой рывок пехоты: весь отряд бежит в одну точку (центр скопления врагов), сбивая всех на пути */
  charge: { speed: 330, duration: 0.55, damage: 12, knockback: 320, hitRadius: 30, searchRadius: 5 * T },
  /** залп лучников */
  /** delay — стрелы падают через столько секунд после команды (на земле видна метка области) */
  volley: { arrowsPerArcher: 3, interval: 0.18, spread: 46, damage: 9, hitRadius: 28, delay: 0.6 },
  /** круговой удар копейщиков */
  sweep: { radius: 96, damage: 14, knockback: 300 },
} as const;

export const ITEMS = {
  horn: { name: 'Рог', desc: '+20% скорость отряда', speedMult: 1.2 },
  shield: { name: 'Щит', desc: '+25% здоровья отряда', hpMult: 1.25 },
  bomb: { name: 'Бомба', desc: '+35% сила отбрасывания', knockMult: 1.35 },
} as const;

// ======================================================================
// Экономика
// ======================================================================
export const ECONOMY = {
  startCoins: 4,
  /** выбор класса (уровень 0 → 1) */
  classCost: 6,
  /** повышение уровня класса: с 1 на 2, с 2 на 3 */
  levelCost: [0, 10, 16],
  maxLevel: 3,
  /** способность: покупка (0 → 1) и улучшения (1 → 2, 2 → 3) */
  abilityCost: [6, 10, 14],
  /** наём нового отряда ополчения на карте кампании */
  hireCost: 10,
  maxRoster: 6,
  /** отрядов в одном бою */
  maxSquadsInBattle: 3,
} as const;

// ======================================================================
// Кампания
// ======================================================================
export const CAMPAIGN = {
  /** колонок островов до финала (финал — отдельная колонка в конце) */
  columns: 6,
  islandsPerColumn: [2, 3] as [number, number],
  /** сколько колонок за ход съедает шторм (0.6 → примерно 1 колонка за 2 хода) */
  stormSpeed: 0.6,
  /** первые ходы шторм не двигается */
  stormGrace: 1,
  /** шанс награды-предмета / нового отряда на острове */
  itemChance: 0.22,
  recruitChance: 0.2,
  startSquads: 2,
  finalDifficultyBonus: 1,
  /** архипелаг на карте кампании сжат к центру (доля поля по x и y) — острова ближе друг к другу */
  mapSpreadX: 0.9,
  mapSpreadY: 0.72,
  /** пикселей на клетку в миниатюре острова на карте (не больше) */
  mapCellMax: 4,
} as const;

// ======================================================================
// ИИ
// ======================================================================
/** Ощущение удара: hit-stop, отлёт тела, видимый замах тяжёлых. */
export const FEEL = {
  /** hit-stop: удар с отлётом сильнее hitStopKnock (px/с) замораживает бьющего и цель на hitStopSec */
  hitStopKnock: 170,
  hitStopSec: 0.06,
  /** тело отлетает по направлению последнего удара: доля скорости отлёта и затухание, 1/с */
  deathFling: 0.9,
  deathFlingDamping: 7,
  /** замах тяжёлых (устойчивость к отбрасыванию от telegraphKnockResist): дрожь и мигание красным */
  telegraphKnockResist: 0.8,
  telegraphShakePx: 2.5,
  telegraphShakeHz: 45,
  telegraphBlinkHz: 22,
  telegraphTint: 0xff8a7a,
} as const;

export const AI = {
  /** как часто юнит принимает решения, с */
  thinkInterval: 0.15,
  /** враг бьёт здание или взрывается только у двери ближе этого расстояния, px */
  burnDoorDist: 52,
  /** доля поджога за удар по зданию в ближнем бою */
  torchIgnite: 0.25,
  firebombIgnite: 0.45,
  /** затухание поджога без попаданий (доля в секунду); если рядом наш отряд — быстрее */
  igniteDecay: 0.15,
  igniteDecayDefended: 0.5,
  /** у защищённого дома (наш отряд рядом) попадание поджигает слабее — защитники затаптывают огонь */
  defendedIgniteMult: 0.25,
  /** враг держит цель, пока она ближе aggro × это */
  enemyChaseMult: 1.4,
  /** солдат держит цель, пока она ближе aggro × это */
  playerChaseMult: 1.3,
  /** ближний бой: путь до цели не длиннее aggro × это */
  pathAggroMult: 1.8,
  /** удар засчитывается, если цель ближе range × это (+8 px) */
  meleeHitTolerance: 1.35,
  /** удар по площади наносится на этой доле дальности перед бойцом */
  splashReach: 0.7,
  /** отряд встаёт в стойку, когда враг ближе aggro × это */
  braceRadiusMult: 1.6,
  /** копейщик в стойке (копьё опущено) бьёт дальше на эту долю */
  pikeBraceReach: 0.25,
  /** копейщики над подъёмом (как в Bad North): врага на ступенях или склоне ниже себя отбрасывают вниз
   *  сильнее (× pikeStairKnockMult) и оглушают на pikeStairStun с — подняться под копьями почти невозможно */
  pikeStairKnockMult: 1.9,
  pikeStairStun: 0.75,
  /** по врагу на подъёме копьё достаёт дальше на эту долю (бьёт и второй ряд — поверх первого) */
  pikeStairReach: 0.6,
  /** удар по ступеням сбрасывает вниз и соседей цели на том же подъёме в этом радиусе, px */
  pikeStairSweep: 56,
  /** шанс щитоносца заблокировать удар ближнего боя спереди */
  meleeBlockChance: 0.5,
  /** при блоке противника отталкивает на эту долю силы удара */
  blockKnockMult: 0.4,
  /** щиты против стрелков: стрелок опасен на дальности своей атаки × shieldThreatMult; снаряд — если летит ближе shieldProjectileRadius */
  shieldThreatMult: 1.3,
  shieldProjectileRadius: 1.5 * T,
  /** щит блокирует снаряд, если тот летит в лицевую сторону: cos угла между полётом и взглядом меньше порога.
   *  Порог c закрывает стрелков в пределах arccos(−c) от взгляда: поднятый щит (−0.2) — ±78°, передняя половина;
   *  опущенный (−0.6) — ±53°, только спереди. Сбоку и со спины щит не спасает */
  shieldGuardCone: -0.2,
  shieldIdleCone: -0.6,
  /** стрелок выше цели (на плато) бьёт дальше на эту долю и точнее (разброс × highGroundScatterMult) */
  highGroundRangeBonus: 0.25,
  highGroundScatterMult: 0.7,
  /** выстрел в упор (ближе closeShotDist, px): урон × closePenalty стрелка, без убийства с одного попадания */
  closeShotDist: 90,
  /** лучники игрока целятся с упреждением: доля хода цели за время полёта стрелы */
  archerLead: 1,
  /** залп лучников делится между столькими ближайшими целями высшего приоритета */
  volleyTargets: 3,
  /** смена цели не чаще раза в столько секунд (нет «танца» на границе радиуса) */
  retargetSec: 0.5,
  /** лучники: враг ближе archerBackoffDist — отходят на клетку внутри своей зоны (не чаще раза в backoffSec) */
  archerBackoffDist: 46,
  archerBackoffSec: 1.2,
  /** копейщики: враг прорвался вплотную (ближе этой доли дальности копья, т. е. ближе обычного удара мечом) —
   *  урон слабее и перезарядка дольше, но близкий выпад сильно отбрасывает врага */
  pikeCloseFrac: 0.32,
  pikeCloseMult: 0.45,
  pikeCloseKnockMult: 1.8,
  pikeCloseCooldownMult: 1.6,
  /** копьё сбивает замах тяжёлого (тролль, минотавр) и оглушает его на pikeInterruptStun */
  pikeInterruptStun: 0.25,
  /** высадка: десант лодки собирается у берега и ждёт gatherSec после высадки последнего, потом идёт вместе */
  gatherSec: 1.2,
  /** отступление: от десанта волны осталось ≤ retreatFraction — выжившие бегут к своей лодке,
   *  если в retreatHouseDist (px) нет целого дома */
  retreatFraction: 0.2,
  retreatHouseDist: 3.5 * T,
  /** стрелки, подрывники, шаман держат дистанцию: боец ближнего боя ближе kiteDist — отходят (не чаще kiteSec) */
  kiteDist: 1.8 * T,
  kiteSec: 1.1,
  /** громила: удар по дуге перед собой (cos половины угла), радиус = дальность × heavyArcReach */
  heavyArcCos: 0.15,
  heavyArcReach: 1.35,
  /** минотавр: рывок по прямой на цель в 2–6 клетках, сбивает всех на пути */
  minoDash: { minDist: 2 * T, maxDist: 6 * T, speed: 340, duration: 0.6, cooldown: 7, damage: 20, knockback: 420 },
  /** бочка и подрывник целят в скопление: враги в этом радиусе от точки считаются вместе */
  clusterRadius: 70,
  /** после всех волн: столько секунд без урона и поджогов — оставшиеся враги отступают */
  stalemateTime: 30,
} as const;

// ======================================================================
// Туман над морем (визуальный)
// ======================================================================
export const FOG = {
  /** клеток за краем карты, которые тоже затягивает туман (покрывает широкие экраны) */
  margin: 100,
  /** до стольких клеток от суши — чисто, к fullDist — плотная дымка */
  clearDist: 1,
  fullDist: 6,
  maxAlpha: 0.9,
  color: 0xdce8ec,
  /** клочья тумана над водой */
  wisps: 9,
  wispAlpha: 0.45,
} as const;

// ======================================================================
// Главное меню (живой остров в стиле Bad North)
// ======================================================================
export const MENU = {
  /** фиксированный сид: меню всегда одинаковое (низина вдоль берега, плато с террасой, ступени и склоны, 3 дома, овцы) */
  seed: 332,
  /** остров меню поменьше боевого: при целом масштабе ×0.5 занимает около 45 % высоты экрана */
  island: {
    width: 22, height: 17, borderWater: 2,
    minLandCells: 150, maxLandCells: 220, plateauMinCells: 24,
    plateauMinSize: 5, plateauMaxCount: 2,
    landingMin: 1, landingMax: 3,
    housesMin: 3, housesMax: 3, houseSpacing: 4,
    sheepMin: 2, sheepMax: 3,
  },

  /** доля высоты экрана под остров; масштаб выбирается из целых шагов zoomSteps */
  islandScreenFrac: 0.45,
  zoomSteps: [0.5, 1, 2],
  /** «дыхание» камеры: дрейф (px мира) и период; зум не дышит — дробный масштаб ломает пиксели */
  driftX: 20, driftY: 12, driftPeriodMs: 26000,
  /** приглушение воды, виньетка, дымка */
  dimColor: 0x0b1a22, dimAlpha: 0.18,
  vignetteAlpha: 0.55,
  /** светлая дымка над дальним морем (цвет FOG.color) */
  hazeAlpha: 0.38,
  /** тени облаков над островом */
  cloudShadows: 3, cloudShadowAlpha: [0.08, 0.12] as [number, number], cloudShadowSpeed: 9,
  /** пустая лодка вдали: пауза между проходами и скорость, px/с */
  boatDelayMs: [9000, 18000] as [number, number], boatSpeed: 26,
  /** отряд рыцарей у дома */
  knights: 6,
  /** овцы бродят */
  sheepWalkRadius: 1.5, sheepPauseMs: [2500, 7000] as [number, number],
  /** появление: море, остров, название, пункты по одному */
  intro: { seaMs: 700, islandDelayMs: 500, islandMs: 900, titleDelayMs: 1200, titleMs: 700, itemsDelayMs: 1700, staggerMs: 80, itemMs: 320 },
  /** наведение на пункт: сдвиг вправо, альфа обычного/выбранного */
  hover: { shift: 8, ms: 140, idleAlpha: 0.72 },
  /** уход в кампанию: гаснет интерфейс, камера наезжает, затемнение */
  exit: { uiFadeMs: 250, zoomMs: 800, zoomMult: 1.5, blackMs: 350 },
  /** панель настроек справа */
  settings: { width: 400, slideMs: 280 },
  slowMoOptions: [0.2, 0.35, 0.5],
  version: 'v0.1.0',
} as const;
