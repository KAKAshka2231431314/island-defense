import Phaser from 'phaser';
import { ECONOMY, ITEMS, PLAYER_UNITS, SQUAD, type PlayerClass } from '../data/balance';
import { CLASS_NAMES } from '../data/units';
import type { SquadDef } from '../entities/Squad';
import { Campaign, ITEM_NAMES } from '../systems/CampaignState';
import { itemTexture } from './BattleHudScene';
import { COLOR, label, makeButton, paper, restartOnResize, ribbonTitle } from './ui';

export const ABILITY_NAMES: Record<PlayerClass, string> = {
  militia: '—',
  infantry: 'Щитовой рывок',
  archer: 'Залп стрел',
  pike: 'Круговой удар',
};

export const ABILITY_DESC: Record<PlayerClass, string> = {
  militia: '',
  infantry: 'бросок на врагов с отбрасыванием',
  archer: 'три волны стрел по скоплению врагов',
  pike: 'удар во все стороны, раскидывает врагов',
};

const CLASS_ROLES: Record<PlayerClass, string> = {
  militia: 'Пехота — щиты. Лучники — дальний бой. Копейщики — строй и лестницы.',
  infantry: 'Щиты защищают от стрел. Подходит для удержания берега.',
  archer: 'Дальний бой. На высоте стреляет дальше и бьёт сильнее.',
  pike: 'Удерживает лестницы и узкие проходы, силён в плотном строю.',
};

const CARD_H = 300;

/** Улучшения между боями: класс, уровень, способность, предмет командира. */
export class UpgradeScene extends Phaser.Scene {
  private campaign!: Campaign;

  constructor() {
    super('Upgrade');
  }

  create(): void {
    const c = this.registry.get('campaign') as Campaign | undefined;
    if (!c) {
      this.scene.start('Menu');
      return;
    }
    this.campaign = c;
    restartOnResize(this);
    const { width, height } = this.scale;
    const compact = width < 620;
    const headerH = compact ? 112 : 78;
    this.add.tileSprite(0, 0, width, height, 'water_bg').setOrigin(0).setScrollFactor(0);
    const inHeader = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      const fixed = obj as unknown as { setScrollFactor(x: number, y?: number): unknown; setDepth(value: number): unknown };
      fixed.setScrollFactor(0);
      fixed.setDepth(1000);
      return obj;
    };
    inHeader(paper(this, 12, 10, width - 24, headerH));
    inHeader(compact
      ? label(this, width / 2, 24, 'Отряды', 26, COLOR.dark, false).setOrigin(0.5, 0).setFontStyle('bold')
      : ribbonTitle(this, width / 2, 43, Math.min(330, width - 48), 'Отряды', 'blue', 26));
    const coinY = compact ? 84 : 43;
    inHeader(this.add.image(34, coinY, 'icon_03').setScale(0.38));
    inHeader(label(this, 56, coinY - 12, `${c.data.coins} монет`, 18, COLOR.dark, false).setFontStyle('bold'));
    inHeader(makeButton(this, width - 174, compact ? 63 : 23, 150, 42, '← К карте', () => this.scene.start('Campaign'), 15).root);

    const introY = headerH + 22;
    const cols = Math.max(1, Math.floor((width - 12) / 372));
    const gap = 12;
    const rows = Math.ceil(c.data.squads.length / cols);
    const willScroll = introY + 42 + rows * (CARD_H + gap) + 20 > height;
    label(this, width / 2, introY, `Выбирай тактику отряда и готовь его к следующему острову${willScroll ? '\nКолесо — список' : ''}`, 14, COLOR.light)
      .setOrigin(0.5, 0).setWordWrapWidth(width - 32).setAlign('center');
    const cardW = Math.min(400, (width - 24 - (cols - 1) * gap) / cols);
    const gridW = cols * cardW + (cols - 1) * gap;
    const startX = (width - gridW) / 2;
    const startY = introY + (willScroll ? 62 : 42);
    c.data.squads.forEach((sq, i) => {
      const x = startX + (i % cols) * (cardW + gap);
      const y = startY + Math.floor(i / cols) * (CARD_H + gap);
      this.drawCard(sq, x, y, cardW);
    });
    if (!c.data.squads.length) label(this, 30, startY, 'Нет отрядов. Найми отряд на карте кампании.', 16);
    const contentH = Math.max(height, startY + rows * (CARD_H + gap) + 20);
    if (contentH > height) {
      this.cameras.main.setBounds(0, 0, width, contentH);
      this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        const cam = this.cameras.main;
        cam.scrollY = Phaser.Math.Clamp(cam.scrollY + dy * 0.7, 0, contentH - height);
      });
    }
  }

  private drawCard(sq: SquadDef, x: number, y: number, w: number): void {
    const c = this.campaign;
    const small = w < 360;
    paper(this, x, y, w, CARD_H);
    this.add.image(x + 14, y + 14, `avatar_${String(sq.avatar).padStart(2, '0')}`).setOrigin(0).setScale(58 / 256);
    label(this, x + 82, y + 13, sq.name, 18, COLOR.dark, false).setFontStyle('bold');
    label(this, x + 82, y + 38, `${CLASS_NAMES[sq.cls]}${sq.level ? ` • уровень ${sq.level}` : ''}`, 14, COLOR.darkSoft, false);
    label(this, x + 14, y + 77, CLASS_ROLES[sq.cls], small ? 11 : 12, COLOR.darkSoft, false).setWordWrapWidth(w - 28);

    const stats = this.statsAt(sq, sq.level);
    label(this, x + 14, y + 114, `Сейчас: ${stats.soldiers + 1} бойцов • ${stats.hp} HP • урон ${stats.dmg}`, 13, COLOR.dark, false);
    const cost = c.upgradeCost(sq);
    if (sq.level > 0 && cost !== null) {
      const next = this.statsAt(sq, sq.level + 1);
      label(this, x + 14, y + 134, `Новый уровень: ${next.soldiers + 1} бойцов • ${next.hp} HP • урон ${next.dmg}`, 12, '#287044', false);
    } else {
      label(this, x + 14, y + 134, sq.level > 0 ? 'Максимальный уровень отряда' : 'Класс откроет уровни и способность', 12, COLOR.darkSoft, false);
    }
    const ability = sq.level > 0
      ? `${ABILITY_NAMES[sq.cls]}${sq.ability ? ` • ур. ${sq.ability}` : ' • не куплена'}: ${ABILITY_DESC[sq.cls]}`
      : 'Выбери класс, чтобы открыть специализацию отряда.';
    label(this, x + 14, y + 155, ability, 12, COLOR.darkSoft, false).setWordWrapWidth(w - 28);

    const restart = () => this.scene.restart();
    const coins = c.data.coins;
    let reason = '';
    if (sq.level === 0) {
      const classes: PlayerClass[] = ['infantry', 'archer', 'pike'];
      const bw = (w - 28 - (classes.length - 1) * 6) / classes.length;
      classes.forEach((cls, i) => {
        makeButton(this, x + 14 + i * (bw + 6), y + 194, bw, 38, CLASS_NAMES[cls], () => { if (c.upgrade(sq, cls)) restart(); }, small ? 11 : 12)
          .setEnabled(coins >= ECONOMY.classCost);
      });
      reason = coins < ECONOMY.classCost
        ? `Не хватает ${ECONOMY.classCost - coins} монет. Класс станет доступен после первого острова.`
        : `Выбор класса стоит ${ECONOMY.classCost} монет.`;
    } else {
      const ac = c.abilityCost(sq);
      const bw = (w - 34) / 2;
      makeButton(this, x + 14, y + 194, bw, 38, cost === null ? 'Макс. уровень' : `Уровень ${sq.level + 1} — ${cost}`, () => { if (c.upgrade(sq)) restart(); }, 12)
        .setEnabled(cost !== null && coins >= cost);
      makeButton(this, x + 20 + bw, y + 194, bw, 38, ac === null ? 'Способность макс.' : `${sq.ability ? 'Усилить' : 'Купить'} способность — ${ac}`, () => { if (c.buyAbility(sq)) restart(); }, 11)
        .setEnabled(ac !== null && coins >= ac);
      const missing: string[] = [];
      if (cost !== null && coins < cost) missing.push(`на уровень — ${cost - coins}`);
      if (ac !== null && coins < ac) missing.push(`на способность — ${ac - coins}`);
      reason = missing.length ? `Не хватает монет: ${missing.join(', ')}.` : 'Улучшения доступны.';
    }
    label(this, x + 14, y + 237, reason, 11, coins < ECONOMY.classCost ? '#8b3f2d' : COLOR.darkSoft, false).setWordWrapWidth(w - 28);

    const iy = y + 264;
    if (sq.item) {
      this.add.image(x + 26, iy + 14, itemTexture(sq.item)).setScale(sq.item === 'bomb' ? 0.55 : 0.36);
      label(this, x + 46, iy, `${ITEM_NAMES[sq.item]}: ${ITEMS[sq.item].desc}`, 11, COLOR.darkSoft, false).setWordWrapWidth(w - 154);
      makeButton(this, x + w - 100, iy, 86, 32, 'Снять', () => { c.unequip(sq); restart(); }, 12);
    } else if (c.data.items.length) {
      const items = c.data.items.slice(0, 3);
      const bw = (w - 28 - (items.length - 1) * 6) / items.length;
      items.forEach((item, i) => {
        makeButton(this, x + 14 + i * (bw + 6), iy, bw, 32, ITEM_NAMES[item], () => { c.equip(sq, item); restart(); }, 12);
      });
    } else {
      label(this, x + 14, iy + 6, 'Предметов на складе пока нет', 12, COLOR.darkSoft, false);
    }
  }

  private statsAt(sq: SquadDef, level: number): { soldiers: number; hp: number; dmg: number } {
    const base = PLAYER_UNITS[sq.cls];
    const lvl = Math.min(level, SQUAD.levelHpMult.length - 1);
    return {
      soldiers: SQUAD.soldiersByLevel[Math.min(level, SQUAD.soldiersByLevel.length - 1)],
      hp: Math.round(base.hp * SQUAD.levelHpMult[lvl] * (sq.item === 'shield' ? ITEMS.shield.hpMult : 1)),
      dmg: Math.round(base.damage * SQUAD.levelDamageMult[lvl] * 10) / 10,
    };
  }
}
