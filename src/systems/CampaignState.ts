import { CAMPAIGN, ECONOMY, type PlayerClass } from '../data/balance';
import type { ItemId, SquadDef } from '../entities/Squad';
import { generateCampaignMap, type IslandNode } from '../mapgen/campaignMap';
import { mulberry32 } from '../mapgen/rng';
import type { BattleResult } from '../scenes/BattleScene';

const NAMES = ['Бьорн', 'Аса', 'Ульф', 'Хельга', 'Сигрид', 'Эйрик', 'Торвальд', 'Ингрид', 'Гуннар', 'Астрид',
  'Свен', 'Фрея', 'Хальвдан', 'Кнуд', 'Ловиса', 'Ивар', 'Ранвейг', 'Стейн'];

export interface CampaignStats {
  islands: number;
  housesSaved: number;
  housesLost: number;
  coinsEarned: number;
  squadsLost: number;
}

export interface CampaignData {
  seed: number;
  coins: number;
  squads: SquadDef[];
  /** отряды, которые воевали в прошлом ходу — отдыхают */
  resting: number[];
  /** предметы на складе (не надетые) */
  items: ItemId[];
  nodes: IslandNode[];
  /** остров, где игрок сейчас (null — у стартовой гавани) */
  current: number | null;
  turn: number;
  stormCol: number;
  nextSquadId: number;
  outcome: 'playing' | 'won' | 'lost';
  stats: CampaignStats;
}

const SAVE_KEY = 'island-defense:campaign';

/** Модель кампании: остров за островом, отряды, монеты, шторм. Сохраняется в localStorage. */
export class Campaign {
  constructor(public data: CampaignData) {}

  static create(seed = (Math.random() * 1e9) >>> 0): Campaign {
    const nodes = generateCampaignMap(seed);
    const c = new Campaign({
      seed, coins: ECONOMY.startCoins, squads: [], resting: [], items: [], nodes, current: null, turn: 0, stormCol: 0,
      nextSquadId: 1, outcome: 'playing',
      stats: { islands: 0, housesSaved: 0, housesLost: 0, coinsEarned: 0, squadsLost: 0 },
    });
    for (let i = 0; i < CAMPAIGN.startSquads; i++) c.addSquad();
    return c;
  }

  static load(): Campaign | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as CampaignData;
      return data.outcome === 'playing' ? new Campaign(data) : null;
    } catch {
      return null;
    }
  }

  /** Удалить сохранение (сброс из настроек). */
  static clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* нечего удалять */
    }
  }

  save(): void {
    try {
      if (this.data.outcome === 'playing') localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      else localStorage.removeItem(SAVE_KEY);
    } catch {
      /* без сохранения */
    }
  }

  node(id: number): IslandNode {
    return this.data.nodes.find((n) => n.id === id)!;
  }

  get finalNode(): IslandNode {
    return this.data.nodes.find((n) => n.isFinal)!;
  }

  /** Острова, на которые можно отправиться в этот ход. */
  available(): IslandNode[] {
    const d = this.data;
    const visited = d.nodes.filter((n) => n.state === 'done');
    const open = d.nodes.filter((n) => {
      if (n.state !== 'open') return false;
      if (!visited.length) return n.col === 0;
      // связь от пройденного острова или сосед по колонке с пройденным
      return visited.some((v) => v.links.includes(n.id) || (v.col === n.col && Math.abs(v.row - n.row) === 1));
    });
    if (!open.length && this.finalNode.state === 'open') return [this.finalNode];
    return open;
  }

  /** Отряды, которые можно взять в бой (не отдыхают). */
  readySquads(): SquadDef[] {
    const ready = this.data.squads.filter((s) => !this.data.resting.includes(s.id));
    return ready.length ? ready : this.data.squads; // если отдыхают все — отдых отменяется
  }

  addSquad(): SquadDef {
    const d = this.data;
    const used = new Set(d.squads.map((s) => s.name));
    const rng = mulberry32(d.seed + d.nextSquadId * 7919);
    const free = NAMES.filter((n) => !used.has(n));
    const name = free.length ? free[Math.floor(rng() * free.length)] : `Отряд ${d.nextSquadId}`;
    const avatarsUsed = new Set(d.squads.map((s) => s.avatar));
    let avatar = 1 + Math.floor(rng() * 25);
    for (let i = 0; i < 25 && avatarsUsed.has(avatar); i++) avatar = (avatar % 25) + 1;
    const sq: SquadDef = { id: d.nextSquadId++, name, cls: 'militia', level: 0, avatar, item: null, ability: 0 };
    d.squads.push(sq);
    return sq;
  }

  canHire(): boolean {
    return this.data.coins >= ECONOMY.hireCost && this.data.squads.length < ECONOMY.maxRoster;
  }

  hire(): SquadDef | null {
    if (!this.canHire()) return null;
    this.data.coins -= ECONOMY.hireCost;
    const sq = this.addSquad();
    this.save();
    return sq;
  }

  // ------------------------------------------------------------- апгрейды

  upgradeCost(sq: SquadDef): number | null {
    if (sq.level === 0) return ECONOMY.classCost;
    if (sq.level >= ECONOMY.maxLevel) return null;
    return ECONOMY.levelCost[sq.level];
  }

  /** Выбор класса (с уровня 0) или повышение уровня. */
  upgrade(sq: SquadDef, cls?: PlayerClass): boolean {
    const cost = this.upgradeCost(sq);
    if (cost === null || this.data.coins < cost) return false;
    if (sq.level === 0) {
      if (!cls || cls === 'militia') return false;
      sq.cls = cls;
    }
    sq.level++;
    this.data.coins -= cost;
    this.save();
    return true;
  }

  abilityCost(sq: SquadDef): number | null {
    if (sq.level === 0 || sq.ability >= ECONOMY.abilityCost.length) return null;
    return ECONOMY.abilityCost[sq.ability];
  }

  buyAbility(sq: SquadDef): boolean {
    const cost = this.abilityCost(sq);
    if (cost === null || this.data.coins < cost) return false;
    sq.ability++;
    this.data.coins -= cost;
    this.save();
    return true;
  }

  /** Надеть предмет со склада на командира (старый уходит на склад). */
  equip(sq: SquadDef, item: ItemId): void {
    const i = this.data.items.indexOf(item);
    if (i < 0) return;
    this.data.items.splice(i, 1);
    if (sq.item) this.data.items.push(sq.item);
    sq.item = item;
    this.save();
  }

  unequip(sq: SquadDef): void {
    if (!sq.item) return;
    this.data.items.push(sq.item);
    sq.item = null;
    this.save();
  }

  // ------------------------------------------------------------- ход

  rest(): void {
    const d = this.data;
    d.resting = [];
    d.turn++;
    if (d.turn > CAMPAIGN.stormGrace) d.stormCol = Math.min(CAMPAIGN.columns - 1, d.stormCol + CAMPAIGN.stormSpeed);
    for (const n of d.nodes) if (n.state === 'open' && n.col < Math.floor(d.stormCol) && !n.isFinal) n.state = 'stormed';
    this.save();
  }

  /** Применить итог боя на острове nodeId. Возвращает текст наград для экрана итогов. */
  applyResult(nodeId: number, r: BattleResult): string[] {
    const d = this.data;
    const node = this.node(nodeId);
    const notes: string[] = [];
    // permadeath: потерянные отряды уходят навсегда вместе с предметами
    for (const id of r.lostSquadIds) {
      const sq = d.squads.find((s) => s.id === id);
      if (sq) notes.push(`Отряд «${sq.name}» потерян навсегда`);
    }
    d.squads = d.squads.filter((s) => !r.lostSquadIds.includes(s.id));
    d.stats.squadsLost += r.lostSquadIds.length;
    d.resting = r.usedSquadIds.filter((id) => d.squads.some((s) => s.id === id));

    if (r.won) {
      node.state = 'done';
      d.current = node.id;
      d.coins += r.coinsEarned;
      d.stats.islands++;
      d.stats.coinsEarned += r.coinsEarned;
      d.stats.housesSaved += r.housesSaved;
      d.stats.housesLost += r.housesTotal - r.housesSaved;
      notes.unshift(`Монеты за дома: +${r.coinsEarned}`);
      if (r.missionCoins) notes.push(`Задание выполнено: +${r.missionCoins} монет`);
      if (node.reward === 'item' && node.item) {
        d.items.push(node.item);
        notes.push(`Найден предмет: ${ITEM_NAMES[node.item]}`);
      }
      if (node.reward === 'recruit' && d.squads.length < ECONOMY.maxRoster) {
        const sq = this.addSquad();
        notes.push(`К вам присоединился отряд «${sq.name}»`);
      }
      if (node.isFinal) {
        d.outcome = 'won';
        this.save();
        return notes;
      }
    } else {
      node.state = 'stormed';
      d.stats.housesLost += r.housesTotal;
      notes.unshift(r.retreated ? 'Отряды отступили — остров потерян' : 'Остров потерян');
      if (r.missionFailed) notes.push('Задание провалено: ключевой дом загорелся');
      if (node.isFinal) {
        d.outcome = 'lost';
        notes.push('Финальная битва проиграна');
        this.save();
        return notes;
      }
    }
    d.turn++;
    if (d.turn > CAMPAIGN.stormGrace) d.stormCol = Math.min(CAMPAIGN.columns - 1, d.stormCol + CAMPAIGN.stormSpeed);
    for (const n of d.nodes) if (n.state === 'open' && n.col < Math.floor(d.stormCol) && !n.isFinal) n.state = 'stormed';
    if (!d.squads.length && d.coins < ECONOMY.hireCost) {
      d.outcome = 'lost';
      notes.push('Не осталось ни одного отряда');
    }
    this.save();
    return notes;
  }

}

export const ITEM_NAMES: Record<ItemId, string> = { bomb: 'Бомба', horn: 'Рог', shield: 'Щит' };
