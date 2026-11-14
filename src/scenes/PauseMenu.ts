import Phaser from 'phaser';
import { DEPTH } from '../data/config';
import { CLASS_NAMES } from '../data/units';
import type { Campaign } from '../systems/CampaignState';
import type { BattleScene } from './BattleScene';
import { COLOR, ConfirmBox, fadeToScene, label, MenuList, navKey, SettingsPanel, slice9, type MenuListItem } from './ui';

/** Затемнение острова под паузой и размеры панелей при масштабе ×1, px. */
const SHADE_ALPHA = 0.5;
const SUMMARY_W = 380;
const CONTROLS_W = 520;
const ROW_H = 30;

/** Таблица управления: клавиша / действие. */
const CONTROLS: [string, string][] = [
  ['ЛКМ по отряду, 1–4', 'выбрать отряд (время замедлится)'],
  ['ЛКМ по клетке', 'отряд встаёт в эту клетку'],
  ['ЛКМ по дому', 'войти и восстановить солдат'],
  ['Двойной клик по карточке', 'камера к отряду'],
  ['Q', 'способность выбранного отряда'],
  ['ПКМ, Esc', 'снять выбор'],
  ['Пробел', 'пауза'],
  ['F', 'ускорение ×2'],
  ['WASD, стрелки, ПКМ', 'двигать камеру'],
  ['Колесо мыши', 'приблизить / отдалить'],
  ['Home', 'показать весь остров'],
  ['Esc', 'меню паузы'],
];

type Sub = 'root' | 'settings' | 'controls';

/**
 * Меню паузы: остров виден за затемнением; слева — текстовый список (как в главном меню), справа — сводка боя
 * на бумаге. «Настройки» — общая панель, «Управление» — таблица клавиш, «Отступить» — с подтверждением.
 * Esc в подменю — назад, в корне — продолжить.
 */
export class PauseMenu {
  private readonly root: Phaser.GameObjects.Container;
  private readonly list: MenuList;
  private summary: Phaser.GameObjects.Container | null = null;
  private controls: Phaser.GameObjects.Container | null = null;
  private settings: SettingsPanel | null = null;
  private confirm: ConfirmBox | null = null;
  private sub: Sub = 'root';

  constructor(private readonly scene: Phaser.Scene, private readonly battle: BattleScene, private readonly k: number) {
    const { width, height } = scene.scale;
    this.root = scene.add.container(0, 0).setDepth(DEPTH.ui + 10);
    // затемнение + клики не проходят на остров
    this.root.add(scene.add.rectangle(0, 0, width, height, 0x000000, SHADE_ALPHA).setOrigin(0).setInteractive());

    const items: MenuListItem[] = [
      { label: 'Продолжить', run: () => this.resume() },
      { label: 'Настройки', run: () => this.openSettings() },
      { label: 'Управление', run: () => this.openControls() },
    ];
    if (battle.inCampaign) {
      items.push({ label: 'Отступить', run: () => this.askRetreat() });
      items.push({ label: 'Выйти в главное меню', run: () => this.askExit() });
    } else {
      items.push({ label: 'В главное меню', run: () => this.exitToMenu() });
    }
    const opts = { k, size: 28, gap: 44 };
    const listH = MenuList.height(items, opts);
    const x = Math.round(64 * k), y = Math.round(height / 2 - listH / 2 + 20 * k);
    this.root.add(label(scene, x - 8 * k, y - 70 * k, 'Пауза', 44 * k, COLOR.light).setFontStyle('bold').setOrigin(0, 0.5));
    this.list = new MenuList(scene, x, y, items, opts);
    this.root.add(this.list.root);
    this.buildSummary();
  }

  // ------------------------------------------------------------------ сводка боя

  private buildSummary(): void {
    const s = this.scene, b = this.battle, k = this.k;
    const { width, height } = s.scale;
    const w = Math.min(Math.round(SUMMARY_W * k), width - 24);
    const pad = Math.round(22 * k);
    const squads = b.world.squads;
    const h = Math.round(196 * k + squads.length * ROW_H * k);
    const x = width - w - Math.round(32 * k), y = Math.round((height - h) / 2);
    const c = s.add.container(x, y);
    c.add(slice9(s, 'paper', 0, 0, w, h));
    // остров
    const campaign = s.registry.get('campaign') as Campaign | undefined;
    const nodeId = s.registry.get('pendingNode') as number | null | undefined;
    const node = campaign && nodeId != null ? campaign.node(nodeId) : null;
    const title = node ? (node.isFinal ? 'Финальный остров' : `Остров · опасность ${node.difficulty + 1}`) : `Быстрый бой · опасность ${b.difficulty + 1}`;
    c.add(label(s, pad, pad, title, 20 * k, COLOR.dark, false).setFontStyle('bold'));
    if (campaign) c.add(label(s, pad, pad + 26 * k, `ход ${campaign.data.turn + 1}`, 14 * k, COLOR.darkSoft, false));
    // волны, дома, монеты
    const wv = b.waves;
    const houses = b.world.houses;
    const alive = houses.filter((o) => o.alive).length;
    const lines = [
      wv.waveIndex < 0 ? `До первой волны: ${Math.ceil(wv.countdown)} с` : `Волна ${wv.waveIndex + 1} из ${wv.totalWaves}`,
      `Дома: целы ${alive}, сгорели ${houses.length - alive}`,
    ];
    lines.forEach((t, i) => c.add(label(s, pad, pad + (56 + i * 24) * k, t, 16 * k, COLOR.dark, false)));
    const coinY = pad + 112 * k;
    c.add(s.add.image(pad + 10 * k, coinY + 9 * k, 'icon_03').setScale(0.38 * k));
    c.add(label(s, pad + 26 * k, coinY, `за остров: ${b.reward}`, 16 * k, COLOR.dark, false));
    // отряды
    let ry = pad + 150 * k;
    for (const sq of squads) {
      const av = s.add.image(pad + 12 * k, ry + 12 * k, `avatar_${String(sq.def.avatar).padStart(2, '0')}`).setScale((24 * k) / 256);
      if (sq.lost) av.setTint(0x777777).setAlpha(0.6);
      c.add(av);
      c.add(label(s, pad + 32 * k, ry + 2 * k, `${sq.def.name} — ${CLASS_NAMES[sq.cls]}`, 14 * k, sq.lost ? COLOR.darkSoft : COLOR.dark, false));
      const status = sq.lost ? 'потерян' : sq.inHouse || sq.entering ? 'в доме' : b.world.time - sq.lastFight < 1.5 ? 'в бою' : 'готов';
      const bw = 70 * k, bx = w - pad - bw, by = ry + 6 * k;
      const g = s.add.graphics();
      const f = sq.lost ? 0 : sq.hpFraction;
      g.fillStyle(0x3d2718, 0.35).fillRect(bx, by, bw, 6 * k);
      g.fillStyle(f > 0.5 ? 0x4caf50 : f > 0.25 ? 0xd9a520 : 0xc0392b, 1).fillRect(bx, by, bw * f, 6 * k);
      c.add(g);
      c.add(label(s, bx - 8 * k, ry + 2 * k, status, 13 * k, sq.lost ? '#a03020' : COLOR.darkSoft, false).setOrigin(1, 0));
      ry += ROW_H * k;
    }
    this.summary = c;
    this.root.add(c);
  }

  // ------------------------------------------------------------------ подменю

  private setSub(sub: Sub): void {
    this.sub = sub;
    this.list.enabled = sub === 'root' && !this.confirm;
    this.summary?.setVisible(sub === 'root');
  }

  private openSettings(): void {
    this.settings = new SettingsPanel(this.scene, {
      k: this.k, depth: DEPTH.ui + 20,
      onClose: () => { this.settings = null; this.setSub('root'); },
    });
    this.setSub('settings');
  }

  private openControls(): void {
    const s = this.scene, k = this.k;
    const { width, height } = s.scale;
    const w = Math.min(Math.round(CONTROLS_W * k), width - 24);
    const pad = Math.round(24 * k);
    const h = Math.round(pad * 2 + 44 * k + CONTROLS.length * 26 * k + 24 * k);
    const x = width - w - Math.round(32 * k), y = Math.max(12, Math.round((height - h) / 2));
    const c = s.add.container(x, y).setDepth(DEPTH.ui + 20);
    c.add(slice9(s, 'paper', 0, 0, w, h));
    c.add(label(s, w / 2, pad, 'Управление', 22 * k, COLOR.dark, false).setOrigin(0.5, 0).setFontStyle('bold'));
    const col = Math.round(w * 0.44);
    CONTROLS.forEach(([key, what], i) => {
      const ry = pad + 44 * k + i * 26 * k;
      if (i % 2 === 0) c.add(s.add.rectangle(pad - 6 * k, ry - 3 * k, w - pad * 2 + 12 * k, 24 * k, 0x3d2718, 0.07).setOrigin(0));
      c.add(label(s, col - 12 * k, ry, key, 15 * k, '#24527a', false).setOrigin(1, 0).setFontStyle('bold'));
      c.add(label(s, col + 4 * k, ry, what, 15 * k, COLOR.dark, false));
    });
    c.add(label(s, w / 2, h - 14 * k, 'Esc — назад', 13 * k, COLOR.darkSoft, false).setOrigin(0.5, 1));
    c.add(s.add.zone(0, 0, w, h).setOrigin(0).setInteractive());
    this.controls = c;
    this.setSub('controls');
  }

  private closeControls(): void {
    this.controls?.destroy();
    this.controls = null;
    this.setSub('root');
  }

  private ask(question: string, yes: () => void): void {
    this.list.enabled = false;
    this.confirm = new ConfirmBox(this.scene, question, (ok) => {
      this.confirm = null;
      this.setSub(this.sub);
      if (ok) yes();
    }, this.k, DEPTH.ui + 30);
  }

  // ------------------------------------------------------------------ действия

  private resume(): void {
    if (this.battle.paused) this.battle.togglePause();
  }

  /** Отступить: остров потерян, выжившие отряды уцелели. */
  private askRetreat(): void {
    this.ask('Остров будет потерян, выжившие отряды уцелеют.\nОтступить?', () => this.battle.forfeit());
  }

  private askExit(): void {
    this.ask('Выйти в главное меню?\nЭтот бой не будет засчитан.', () => this.exitToMenu());
  }

  private exitToMenu(): void {
    this.scene.registry.set('pendingNode', null);
    this.battle.paused = false;
    fadeToScene(this.battle, 'Menu');
  }

  /** Клавиши: подтверждение → настройки → управление → список; Esc в корне — продолжить. */
  handleKey(e: KeyboardEvent): void {
    if (this.confirm) { this.confirm.handleKey(e); return; }
    if (this.settings) { this.settings.handleKey(e); return; }
    if (this.controls) {
      const k = navKey(e);
      if (k === 'esc' || k === 'enter') this.closeControls();
      return;
    }
    if (navKey(e) === 'esc') { this.resume(); return; }
    this.list.handleKey(e);
  }

  destroy(): void {
    this.confirm?.destroy();
    this.settings?.destroy();
    this.controls?.destroy();
    this.list.destroy();
    this.root.destroy();
  }
}
