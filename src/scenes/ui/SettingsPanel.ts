import Phaser from 'phaser';
import { MENU } from '../../data/balance';
import { saveSettings, settings } from '../../data/settings';
import { Campaign } from '../../systems/CampaignState';
import { sfx } from '../../systems/Sound';
import { slice9 } from './base';
import { ConfirmBox } from './ConfirmBox';
import { COLOR, label, navKey, pointer } from './theme';

/** Ширина панели, высота строки и время выезда, мс. */
const PANEL_W = 400;
const ROW_H = 44;
const SLIDE_MS = 280;
/** Шаг громкости с клавиатуры. */
const VOLUME_STEP = 0.1;

interface Row {
  label: string;
  value: () => string;
  /** Enter / клик */
  activate: () => void;
  /** ← / → */
  adjust?: (dir: number) => void;
  enabled?: () => boolean;
  text?: Phaser.GameObjects.Text;
  valueText?: Phaser.GameObjects.Text;
  ptr?: Phaser.GameObjects.Image;
}

export interface SettingsPanelOptions {
  k: number;
  depth?: number;
  /** с какой строки начать (после перестройки экрана) */
  row?: number;
  animate?: boolean;
  /** пункт «Сбросить сохранение» (только в главном меню) */
  allowResetSave?: boolean;
  /** сохранение удалено — экрану нужно перестроиться */
  onSaveReset?: () => void;
  onClose: () => void;
}

/**
 * Панель настроек на бумаге, выезжает справа: громкость (тонкая полоса пака), числа урона, замедление,
 * подсказки, полный экран, [сброс сохранения], «Закрыть». Общая для главного меню и паузы.
 */
export class SettingsPanel {
  readonly root: Phaser.GameObjects.Container;
  private readonly rows: Row[];
  private sel = 0;
  private confirm: ConfirmBox | null = null;
  private volumeBar: { fill: Phaser.GameObjects.Image; x: number; w: number; s: number } | null = null;
  private closed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly o: SettingsPanelOptions) {
    const { width, height } = scene.scale;
    const k = o.k;
    const pw = Math.min(Math.round(PANEL_W * k), width - 24);
    const rowH = Math.round(ROW_H * k);
    this.rows = this.makeRows();
    const ph = Math.round(86 * k + this.rows.length * rowH + 30 * k);
    const x = width - pw - Math.round(24 * k), y = Math.max(12, Math.round((height - ph) / 2));
    this.root = scene.add.container(x, y).setDepth(o.depth ?? 500);
    this.root.add(slice9(scene, 'paper', 0, 0, pw, ph));
    // клики мимо пунктов не проходят сквозь панель
    this.root.add(scene.add.zone(0, 0, pw, ph).setOrigin(0).setInteractive());
    this.root.add(label(scene, pw / 2, Math.round(18 * k), 'Настройки', 26 * k, COLOR.dark, false).setOrigin(0.5, 0).setFontStyle('bold'));
    const left = Math.round(40 * k), right = pw - Math.round(28 * k);
    this.rows.forEach((r, i) => {
      const ry = Math.round(86 * k + i * rowH + rowH / 2);
      r.ptr = pointer(scene, left - Math.round(18 * k), ry, 0.6 * k).setAlpha(0);
      r.text = label(scene, left, ry, r.label, 19 * k, COLOR.dark, false).setOrigin(0, 0.5);
      r.valueText = label(scene, right, ry, r.value(), 19 * k, COLOR.dark, false).setOrigin(1, 0.5);
      const zone = scene.add.zone(0, ry - rowH / 2, pw, rowH).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => { if (!this.confirm) this.select(i); });
      // pointerup — чтобы полноэкранный режим включался из действия пользователя
      zone.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (this.confirm || p.button !== 0) return;
        this.select(i, false);
        if (i === 0 && this.volumeBar) this.setVolumeFromPointer(p.x);
        else this.activateRow();
      });
      this.root.add([r.ptr, r.text, r.valueText, zone]);
      if (i === 0) this.buildVolumeBar(Math.round(pw * 0.42), ry, Math.round(pw * 0.36));
    });
    this.root.add(label(scene, pw / 2, ph - Math.round(16 * k), 'Esc — закрыть', 13 * k, COLOR.darkSoft, false).setOrigin(0.5, 1));
    this.select(Phaser.Math.Clamp(o.row ?? 0, 0, this.rows.length - 1), false);
    if (o.animate !== false) {
      this.root.x = width + 10;
      scene.tweens.add({ targets: this.root, x, duration: SLIDE_MS, ease: 'Cubic.easeOut' });
    }
  }

  get row(): number {
    return this.sel;
  }

  private makeRows(): Row[] {
    const onOff = (v: boolean) => (v ? 'вкл' : 'выкл');
    const save = () => { saveSettings(); this.refresh(); };
    const opts = MENU.slowMoOptions as readonly number[];
    const cycleSlow = (dir: number) => {
      const i = opts.findIndex((o) => Math.abs(o - settings.slowMo) < 1e-3);
      settings.slowMo = opts[(Math.max(0, i) + dir + opts.length) % opts.length];
      save();
    };
    const toggleDamage = () => { settings.showDamageNumbers = !settings.showDamageNumbers; save(); };
    const toggleHints = () => {
      settings.hints = !settings.hints;
      if (settings.hints) settings.hintBattles = 0; // включили снова — подсказки покажутся в следующих боях
      save();
    };
    const toggleFs = () => {
      if (this.scene.scale.isFullscreen) this.scene.scale.stopFullscreen();
      else this.scene.scale.startFullscreen();
    };
    const rows: Row[] = [
      {
        label: 'Громкость', value: () => `${Math.round(settings.volume * 100)}%`,
        activate: () => this.adjust(1),
        adjust: (d) => this.setVolume(Math.round((settings.volume + d * VOLUME_STEP) * 10) / 10),
      },
      { label: 'Числа урона', value: () => onOff(settings.showDamageNumbers), activate: toggleDamage, adjust: toggleDamage },
      { label: 'Замедление', value: () => `‹ ×${settings.slowMo} ›`, activate: () => cycleSlow(1), adjust: (d) => cycleSlow(d) },
      { label: 'Подсказки', value: () => onOff(settings.hints), activate: toggleHints, adjust: toggleHints },
      { label: 'Полный экран', value: () => onOff(this.scene.scale.isFullscreen), activate: toggleFs, adjust: toggleFs },
    ];
    if (this.o.allowResetSave) {
      rows.push({
        label: 'Сбросить сохранение', value: () => (Campaign.load() ? '' : 'нет'),
        enabled: () => !!Campaign.load(),
        activate: () => {
          if (!Campaign.load()) return;
          this.openConfirm('Удалить сохранённую кампанию?\nЭто нельзя отменить.', (yes) => {
            if (!yes) return;
            Campaign.clear();
            this.o.onSaveReset?.();
          });
        },
      });
    }
    rows.push({ label: 'Закрыть', value: () => '', activate: () => this.close() });
    return rows;
  }

  private openConfirm(q: string, then: (yes: boolean) => void): void {
    this.confirm = new ConfirmBox(this.scene, q, (yes) => { this.confirm = null; then(yes); }, this.o.k, (this.o.depth ?? 500) + 100);
  }

  /** Ползунок громкости из тонкой полосы пака (SmallBar): рамка 3-slice и светлая заливка. */
  private buildVolumeBar(x: number, y: number, w: number): void {
    const s = Math.max(1, Math.round(this.o.k * 1.5) / 1.5);
    const base = this.scene.add.nineslice(x - 59 * s, y - 32 * s, 'sbar_base', undefined, w / s + 118, 64, 64, 64, 0, 0).setOrigin(0).setScale(s);
    const fill = this.scene.add.image(x, y - 1.5 * s, 'sbar_fill').setOrigin(0, 0).setScale(1, s).setTint(0xf2c14e);
    this.root.add([base, fill]);
    this.volumeBar = { fill, x, w, s };
    this.updateVolumeBar();
    const zone = this.scene.add.zone(x - 8, y - 16 * s, w + 16, 32 * s).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => { if (!this.confirm) { this.select(0, false); this.setVolumeFromPointer(p.x); } });
    zone.on('pointermove', (p: Phaser.Input.Pointer) => { if (!this.confirm && p.isDown) this.setVolumeFromPointer(p.x); });
    this.root.add(zone);
  }

  private setVolumeFromPointer(screenX: number): void {
    const b = this.volumeBar;
    if (b) this.setVolume((screenX - this.root.x - b.x) / b.w);
  }

  private setVolume(v: number): void {
    settings.volume = Phaser.Math.Clamp(Math.round(v * 20) / 20, 0, 1);
    settings.sound = settings.volume > 0;
    saveSettings();
    sfx.applyVolume();
    this.updateVolumeBar();
    this.refresh();
  }

  private updateVolumeBar(): void {
    const b = this.volumeBar;
    if (b) b.fill.setVisible(settings.volume > 0).setScale(Math.max(0.001, (b.w * settings.volume) / 64), b.s);
  }

  private refresh(): void {
    for (const r of this.rows) {
      r.valueText?.setText(r.value());
      r.text?.setAlpha(r.enabled?.() ?? true ? 1 : 0.45);
    }
  }

  private select(i: number, sound = true): void {
    if (sound && i !== this.sel) sfx.play('click', 0.5);
    this.sel = i;
    this.rows.forEach((r, j) => {
      const on = j === i;
      r.ptr?.setAlpha(on ? 1 : 0);
      r.text?.setColor(on ? COLOR.darkSel : COLOR.dark).setX(Math.round((40 + (on ? 8 : 0)) * this.o.k));
    });
    this.refresh();
  }

  private adjust(dir: number): void {
    const r = this.rows[this.sel];
    if (!r || (r.enabled && !r.enabled())) return;
    sfx.play('click', 0.5);
    r.adjust?.(dir);
    this.refresh();
  }

  private activateRow(): void {
    const r = this.rows[this.sel];
    if (!r || (r.enabled && !r.enabled())) return;
    sfx.play('click', 0.5);
    r.activate();
    this.refresh();
  }

  /** Клавиши панели (пока она открыта, весь ввод — её): ↑/↓, ←/→, Enter, Esc — закрыть. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.confirm) return this.confirm.handleKey(e);
    const n = this.rows.length;
    switch (navKey(e)) {
      case 'up': this.select((this.sel + n - 1) % n); break;
      case 'down': this.select((this.sel + 1) % n); break;
      case 'left': this.adjust(-1); break;
      case 'right': this.adjust(1); break;
      case 'enter': this.activateRow(); break;
      case 'esc': this.close(); break;
      default: break;
    }
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.confirm?.destroy();
    const root = this.root;
    this.scene.tweens.add({ targets: root, x: this.scene.scale.width + 10, duration: SLIDE_MS, ease: 'Cubic.easeIn', onComplete: () => root.destroy() });
    this.o.onClose();
  }

  /** Убрать сразу, без анимации (при перестройке экрана). */
  destroy(): void {
    this.closed = true;
    this.confirm?.destroy();
    this.root.destroy();
  }
}
