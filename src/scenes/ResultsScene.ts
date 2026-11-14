import Phaser from 'phaser';
import { ECONOMY } from '../data/balance';
import { CLASS_NAMES } from '../data/units';
import { Campaign, ITEM_NAMES } from '../systems/CampaignState';
import { sfx } from '../systems/Sound';
import type { BattleResult } from './BattleScene';
import { COLOR, fadeToScene, label, MenuList, plate, ribbonTitle, slice9, uiScale, type MenuListItem } from './ui';

/** Подсчёт монет: дома по одному через столько мс, после паузы на появление. */
const COUNT = { startMs: 700, stepMs: 450, popMs: 220, plusMs: 800 };
/** Ширина листа итогов при масштабе ×1, px. */
const PANEL_W = 560;
/** Дома на листе итогов: масштаб картинки, шаг, высота ряда при ×1. */
const HOUSE_ROW = { scale: 0.46, popScale: 0.52, step: 84, h: 136 };

/** Итоги боя (и кампании, если она закончилась): дома с монетами, отряды, находки, «Дальше». */
export class ResultsScene extends Phaser.Scene {
  private list: MenuList | null = null;

  constructor() {
    super('Results');
  }

  create(data: { result?: BattleResult }): void {
    const { width, height } = this.scale;
    const k = uiScale(this);
    this.list = null;
    this.add.tileSprite(0, 0, width, height, 'water_bg').setOrigin(0);
    this.add.rectangle(0, 0, width, height, 0x0b1a22, 0.45).setOrigin(0);
    this.cameras.main.fadeIn(400, 0, 0, 0);

    const campaign = this.registry.get('campaign') as Campaign | undefined;
    const nodeId = this.registry.get('pendingNode') as number | null | undefined;
    const r = data.result;
    let notes: string[] = [];
    const inCampaign = !!campaign && nodeId !== null && nodeId !== undefined;
    if (r && inCampaign) {
      notes = campaign!.applyResult(nodeId!, r).filter((n) => !n.startsWith('Монеты'));
      this.registry.set('pendingNode', null);
    }
    const outcome = campaign?.data.outcome ?? 'playing';

    // заголовок на ленте
    let title = r ? (r.won ? 'Остров отстоян' : r.retreated ? 'Отступление' : 'Остров пал') : 'Итоги';
    if (campaign && outcome === 'won') title = 'Кампания пройдена!';
    if (campaign && outcome === 'lost') title = 'Кампания проиграна';
    const good = (r?.won ?? false) || outcome === 'won';

    // лист итогов
    const houses = r?.houses ?? [];
    const squads = r?.squads ?? [];
    const w = Math.min(Math.round(PANEL_W * k), width - 24);
    const pad = Math.round(26 * k);
    const statsLines = campaign && outcome !== 'playing' ? 3 : 0;
    const h = Math.round((96 + (houses.length ? HOUSE_ROW.h + (r?.won ? 0 : 14) : 0) + (squads.length ? 34 + squads.length * 28 : 0) + (notes.length + statsLines) * 22 + 20) * k);
    const x = Math.round((width - w) / 2), y = Math.max(Math.round(70 * k), Math.round((height - h) / 2 - 40 * k));
    slice9(this, 'paper', x, y, w, h);
    ribbonTitle(this, width / 2, y + 4 * k, Math.min(w + 60 * k, width - 10), title, good ? 'blue' : 'red', 24 * k);

    let cy = y + Math.round(70 * k);
    // дома: по одному, уцелевший — монеты со звоном, сгоревший — тёмный
    if (houses.length) {
      label(this, x + pad, cy, 'Дома', 18 * k, COLOR.dark, false).setFontStyle('bold');
      const coinIcon = this.add.image(x + w - pad - 70 * k, cy + 10 * k, 'icon_03').setScale(0.42 * k);
      const total = label(this, coinIcon.x + 16 * k, cy, '0', 20 * k, COLOR.dark, false).setFontStyle('bold');
      let sum = 0;
      // казарма шире дома — занимает полтора места
      const slots = houses.reduce((n, o) => n + (o.kind === 'barracks' ? 1.5 : 1), 0);
      const step = Math.min(HOUSE_ROW.step * k, (w - pad * 2) / slots);
      let at = x + pad;
      houses.forEach((hs, i) => {
        const span = step * (hs.kind === 'barracks' ? 1.5 : 1);
        const hx = at + span / 2 + 12 * k, hy = cy + (HOUSE_ROW.h - 16) * k;
        at += span;
        const barracks = hs.kind === 'barracks';
        const img = this.add.image(hx, hy, barracks ? 'barracks' : hs.saved ? 'house1' : 'house_destroyed').setOrigin(0.5, 1).setScale(HOUSE_ROW.scale * k).setAlpha(0);
        if (barracks && !hs.saved) img.setTint(0x4a3c36);
        this.time.delayedCall(COUNT.startMs + i * COUNT.stepMs, () => {
          img.setAlpha(hs.saved ? 1 : 0.6).setScale(HOUSE_ROW.popScale * k);
          this.tweens.add({ targets: img, scale: HOUSE_ROW.scale * k, duration: COUNT.popMs, ease: 'Back.easeOut' });
          if (!hs.saved || !r?.won) return;
          sum += hs.value;
          total.setText(String(sum));
          sfx.play('coin', 0.8);
          const plus = label(this, hx, hy - 90 * k, `+${hs.value}`, 16 * k, '#b07a10', false).setOrigin(0.5).setFontStyle('bold');
          this.tweens.add({ targets: plus, y: plus.y - 20 * k, alpha: 0, duration: COUNT.plusMs, onComplete: () => plus.destroy() });
        });
      });
      if (!r?.won) label(this, x + pad, cy + (HOUSE_ROW.h - 10) * k, r?.retreated ? 'отступили — монеты не начислены' : 'остров потерян — монет нет', 13 * k, COLOR.darkSoft, false);
      cy += Math.round((HOUSE_ROW.h + (r?.won ? 0 : 14)) * k);
    }
    // отряды
    if (squads.length) {
      label(this, x + pad, cy, 'Отряды', 18 * k, COLOR.dark, false).setFontStyle('bold');
      cy += Math.round(30 * k);
      for (const sq of squads) {
        const av = this.add.image(x + pad + 12 * k, cy + 11 * k, `avatar_${String(sq.avatar).padStart(2, '0')}`).setScale((22 * k) / 256);
        if (sq.lost) av.setTint(0x777777).setAlpha(0.6);
        label(this, x + pad + 30 * k, cy + 2 * k, `${sq.name} — ${CLASS_NAMES[sq.cls]}`, 15 * k, sq.lost ? COLOR.darkSoft : COLOR.dark, false);
        const bw = 90 * k, bx = x + w - pad - bw, by = cy + 7 * k;
        if (sq.lost) {
          label(this, x + w - pad, cy + 2 * k, 'потерян', 14 * k, '#a03020', false).setOrigin(1, 0);
        } else {
          const g = this.add.graphics();
          g.fillStyle(0x3d2718, 0.35).fillRect(bx, by, bw, 7 * k);
          g.fillStyle(sq.hpFrac > 0.5 ? 0x4caf50 : sq.hpFrac > 0.25 ? 0xd9a520 : 0xc0392b, 1).fillRect(bx, by, bw * sq.hpFrac, 7 * k);
        }
        cy += Math.round(28 * k);
      }
      cy += Math.round(6 * k);
    }
    // находки и события кампании
    for (const n of notes) {
      label(this, x + pad, cy, `• ${n}`, 15 * k, n.includes('потерян') || n.includes('проиграна') ? '#a03020' : COLOR.dark, false);
      cy += Math.round(22 * k);
    }
    if (campaign && outcome !== 'playing') {
      const s = campaign.data.stats;
      for (const t of [`Островов отстояно: ${s.islands}`, `Домов спасено: ${s.housesSaved}, сожжено: ${s.housesLost}`, `Монет: ${s.coinsEarned}, отрядов потеряно: ${s.squadsLost}`]) {
        label(this, x + pad, cy, t, 15 * k, COLOR.dark, false);
        cy += Math.round(22 * k);
      }
    }

    // дальше или выбор дополнительной награды за победу
    const items: MenuListItem[] = [];
    const chooseReward = !!(campaign && r?.won && outcome === 'playing' && inCampaign);
    if (chooseReward) {
      const choose = (choice: 'coins' | 'ready' | 'item') => {
        if (this.list) this.list.enabled = false;
        campaign!.applyRewardChoice(nodeId!, choice);
        sfx.play('click', 0.8);
        fadeToScene(this, 'Campaign');
      };
      items.push({ label: `+${ECONOMY.victoryRewardCoins} монет`, sub: 'для улучшений и найма', run: () => choose('coins') });
      items.push({ label: 'Отряды готовы', sub: 'участники боя не будут отдыхать', run: () => choose('ready') });
      items.push({ label: `Предмет: ${ITEM_NAMES[campaign!.rewardItem(nodeId!)]}`, sub: 'добавить на склад', run: () => choose('item') });
    } else if (campaign && outcome === 'playing' && inCampaign) {
      items.push({ label: 'Дальше', run: () => fadeToScene(this, 'Campaign') });
      items.push({ label: 'Отряды', run: () => fadeToScene(this, 'Upgrade') });
      items.push({ label: 'Главное меню', run: () => fadeToScene(this, 'Menu') });
    } else if (campaign && outcome !== 'playing') {
      items.push({
        label: 'Новая кампания',
        run: () => {
          const c = Campaign.create();
          c.save();
          this.registry.set('campaign', c);
          fadeToScene(this, 'Campaign');
        },
      });
      items.push({ label: 'Главное меню', run: () => { this.registry.remove('campaign'); fadeToScene(this, 'Menu'); } });
    } else {
      items.push({ label: 'Ещё бой', run: () => fadeToScene(this, 'Battle', { returnTo: 'Results', difficulty: 1 }) });
      items.push({ label: 'Главное меню', run: () => fadeToScene(this, 'Menu') });
    }
    const opts = { k, size: chooseReward ? 22 : 26, gap: chooseReward ? 48 : 40, subSize: 13 };
    const listY = Math.min(height - MenuList.height(items, opts) - 30 * k, y + h + 40 * k);
    const backing = this.add.graphics();
    const listW = Math.round((chooseReward ? 320 : 260) * k);
    plate(backing, x, listY - 26 * k, listW, MenuList.height(items, opts) + 52 * k, 0.45);
    if (chooseReward) label(this, x + 22 * k, listY - 18 * k, 'Выберите награду:', 14 * k, COLOR.light, false);
    this.list = new MenuList(this, x + Math.round(36 * k), listY, items, opts);
    this.input.keyboard?.on('keydown', this.onKey, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.off('keydown', this.onKey, this));
  }

  private onKey(e: KeyboardEvent): void {
    sfx.unlock();
    this.list?.handleKey(e);
  }
}
