import Phaser from 'phaser';
import { DEPTH } from '../data/config';
import type { Squad } from '../entities/Squad';
import type { Point } from '../entities/Unit';
import type { BattleWorld } from './BattleWorld';

const KEY_NAMES = ['ONE', 'TWO', 'THREE', 'FOUR'];

/**
 * Управление отрядами: клик по отряду — выбрать, клик по земле — идти туда,
 * клик по дому — войти в него (восстановление). ПКМ без перетаскивания / Esc — снять выбор.
 */
export class SelectionController {
  private rightDown: Point | null = null;
  private abilitySquad: Squad | null = null;
  private lastPreviewCell = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: BattleWorld,
    private readonly isOverUi: (p: Phaser.Input.Pointer) => boolean,
    private readonly useAbilityAt: (sq: Squad, at: Point) => boolean,
    private readonly validAbilityTarget: (sq: Squad, at: Point) => boolean,
  ) {
    const input = scene.input;
    input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.rightDown && p.rightButtonReleased() && Math.hypot(p.x - this.rightDown.x, p.y - this.rightDown.y) < 6) this.select(null);
      this.rightDown = null;
    });
    input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.isOverUi(p)) { world.hovered = null; world.preview = null; return; }
      const wp = p.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2;
      if (this.abilitySquad) {
        world.hovered = null;
        this.updateAbilityPreview(wp.x, wp.y);
        return;
      }
      world.hovered = world.squadAt(wp.x, wp.y);
      this.updatePreview(wp.x, wp.y);
    });
    const kb = input.keyboard!;
    KEY_NAMES.forEach((k, i) => kb.on(`keydown-${k}`, () => this.toggleIndex(i)));
    kb.on('keydown-ESC', () => {
      if (this.world.selected) this.select(null);
      else scene.events.emit('escapeIdle');
    });
  }

  get targetingAbility(): boolean {
    return this.abilitySquad !== null;
  }

  startAbility(sq: Squad): void {
    this.select(sq);
    this.abilitySquad = sq;
  }

  /** Где встанет выбранный отряд, если кликнуть сюда (как в Bad North — контур строя под курсором). */
  private updatePreview(x: number, y: number): void {
    const w = this.world;
    const sq = w.selected;
    if (!sq || w.hovered === sq) { w.preview = null; this.lastPreviewCell = -1; return; }
    const house = w.houseAt(x, y);
    const px = house ? house.door.x : x, py = house ? house.door.y : y;
    const cell = w.cellIdx(px, py);
    if (cell === this.lastPreviewCell && w.preview) return;
    this.lastPreviewCell = cell;
    const needsHeal = sq.hpFraction < 0.999 || sq.aliveUnits.filter((u) => !u.isCommander).length < sq.soldiersMax;
    w.preview = house && needsHeal ? { zone: null, slots: [house.door] } : w.previewAt(sq, house ? house.door.x : x, house ? house.door.y + 40 : y);
  }

  private updateAbilityPreview(x: number, y: number): void {
    const w = this.world;
    const sq = this.abilitySquad!;
    const cell = w.cellIdx(x, y);
    if (cell === this.lastPreviewCell && w.preview) return;
    this.lastPreviewCell = cell;
    const zone = w.zoneAt(x, y);
    if (!zone) { w.preview = null; return; }
    const at = { x: zone.cx, y: zone.cy };
    w.preview = { zone, slots: [], ability: true, valid: this.validAbilityTarget(sq, at) };
  }

  select(sq: Squad | null): void {
    this.abilitySquad = null;
    this.world.preview = null;
    this.lastPreviewCell = -1;
    this.world.selected = sq && !sq.lost ? sq : null;
    this.scene.events.emit('selectionChanged', this.world.selected);
  }

  toggleIndex(i: number): void {
    const sq = this.world.squads.find((s) => s.index === i && !s.lost) ?? null;
    this.select(this.world.selected === sq ? null : sq);
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (p.rightButtonDown()) {
      this.rightDown = { x: p.x, y: p.y };
      return;
    }
    if (!p.leftButtonDown() || this.isOverUi(p)) return;
    const wp = p.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const w = this.world;
    if (this.abilitySquad) {
      const zone = w.zoneAt(wp.x, wp.y);
      if (zone) {
        const at = { x: zone.cx, y: zone.cy };
        if (this.validAbilityTarget(this.abilitySquad, at) && this.useAbilityAt(this.abilitySquad, at)) this.select(null);
      }
      return;
    }
    const clickedSquad = w.squadAt(wp.x, wp.y);
    const house = w.houseAt(wp.x, wp.y);

    if (!w.selected) {
      if (clickedSquad) this.select(clickedSquad);
      else if (house?.occupant) this.select(house.occupant);
      return;
    }
    if (clickedSquad && clickedSquad !== w.selected) {
      const at = clickedSquad.zone ? { x: clickedSquad.zone.cx, y: clickedSquad.zone.cy } : clickedSquad.center();
      const goal = w.orderSquad(w.selected, at.x, at.y);
      if (goal) {
        this.marker(goal, 0xffe14a);
        this.select(null);
      } else this.select(clickedSquad);
      return;
    }
    if (clickedSquad === w.selected) {
      this.select(null);
      return;
    }
    const sq = w.selected;
    // в дом заходит только потрёпанный отряд; целый просто встаёт у входа
    const needsHeal = sq.hpFraction < 0.999 || sq.aliveUnits.filter((u) => !u.isCommander).length < sq.soldiersMax;
    if (house && !needsHeal) {
      const goal = w.orderSquad(sq, house.door.x, house.door.y + 40);
      if (goal) this.marker(goal, 0xffe14a);
    } else if (house && house.state === 'intact' && (!house.occupant || house.occupant === sq) && w.orderEnterHouse(sq, house)) {
      this.marker(house.door, 0x7ad0ff);
    } else {
      const goal = w.orderSquad(sq, wp.x, wp.y);
      if (goal) this.marker(goal, 0xffe14a);
    }
    this.select(null);
  }

  private marker(at: Point, color: number): void {
    const g = this.scene.add.graphics().setDepth(DEPTH.ui - 30).setPosition(at.x, at.y);
    g.lineStyle(3, color, 1).strokeEllipse(0, 0, 44, 18);
    g.fillStyle(color, 1).fillTriangle(-2, -34, -2, -18, 12, -28).fillRect(-3, -34, 2, 34);
    this.scene.tweens.add({ targets: g, alpha: 0, scaleX: 1.3, scaleY: 1.3, duration: 900, onComplete: () => g.destroy() });
  }
}
