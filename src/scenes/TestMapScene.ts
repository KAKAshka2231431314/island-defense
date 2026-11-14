import Phaser from 'phaser';
import { type AnimState } from '../data/assetManifest';
import { DEPTH, TILE } from '../data/config';
import { UnitView } from '../entities/UnitView';
import { IslandGrid } from '../mapgen/IslandGrid';
import { mulberry32 } from '../mapgen/rng';
import { TEST_MAP } from '../mapgen/testMap';
import { fxKey } from '../systems/AnimationRegistry';
import { CameraController } from '../systems/CameraController';
import { TerrainRenderer } from '../systems/TerrainRenderer';

const PLAYER_ROW = ['warrior_blue', 'archer_blue', 'lancer_blue', 'warrior_yellow', 'archer_yellow', 'lancer_yellow'];
const ENEMY_ROW = ['goblin_torch', 'harpoon_fish', 'goblin_tnt', 'goblin_barrel', 'skull', 'shaman', 'troll', 'minotaur'];
const BIG = new Set(['troll', 'minotaur', 'lancer_blue', 'lancer_yellow']);

/** Итерация 1: тестовая карта + витрина всех юнитов и анимаций из манифеста. */
export class TestMapScene extends Phaser.Scene {
  private cameraCtl!: CameraController;
  private units: UnitView[] = [];
  private state: AnimState = 'idle';

  constructor() {
    super('TestMap');
  }

  create(): void {
    const grid = IslandGrid.fromAscii(TEST_MAP);
    const terrain = new TerrainRenderer(this, grid, mulberry32(1234));
    terrain.render();
    this.cameraCtl = new CameraController(this, { grid });

    this.placeDecor();
    this.placeRow(PLAYER_ROW, 5, 10);
    this.placeRow(ENEMY_ROW, 5.5, 12.4);

    const kb = this.input.keyboard!;
    const states: Record<string, AnimState> = { ONE: 'idle', TWO: 'run', THREE: 'attack', FOUR: 'death', FIVE: 'guard' };
    for (const [k, st] of Object.entries(states)) kb.on(`keydown-${k}`, () => this.setState(st));
    kb.on('keydown-F', () => this.units.forEach((u) => u.setFlipX(!u.flipX)));

    kb.on('keydown-B', () => { this.scene.stop('DebugHud'); this.scene.start('Menu'); });

    if (!this.scene.isActive('DebugHud')) this.scene.launch('DebugHud');
    this.registry.set('hudText', this.helpText());
  }

  update(_t: number, dtMs: number): void {
    this.cameraCtl.update(dtMs / 1000);
  }

  private helpText(): string {
    const errors: string[] = this.registry.get('loadErrors') ?? [];
    return [
      'Итерация 1 — тестовая карта',
      'WASD / стрелки / ПКМ-перетаскивание — камера, колесо — зум, Home — весь остров',
      '1 idle  2 run  3 attack  4 death  5 guard/windup/fuse   F — развернуть   B — к острову',
      `Состояние: ${this.state}`,
      errors.length ? `⚠ Ошибки ассетов (${errors.length}):\n${errors.slice(0, 8).join('\n')}` : 'Ассеты: все загружены ✓',
    ].join('\n');
  }

  private setState(state: AnimState): void {
    this.state = state;
    const alt: AnimState[] = ['guard', 'windup', 'fuse', 'popup'];
    for (const u of this.units) {
      if (state === 'guard') {
        const found = alt.find((s) => u.hasState(s));
        u.playState(found ?? 'idle', false);
      } else if (!u.playState(state, false)) {
        u.playState('idle', false);
      }
    }
    this.registry.set('hudText', this.helpText());
  }

  private placeRow(keys: string[], startCol: number, row: number): void {
    let x = startCol * TILE;
    const y = row * TILE;
    for (const key of keys) {
      const big = BIG.has(key);
      if (big) x += 32;
      const u = new UnitView(this, x, y, key);
      this.units.push(u);
      this.add.text(x, y + 14, key, { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5, 0).setDepth(DEPTH.ui);
      x += big ? 160 : 96;
    }
  }

  private placeDecor(): void {
    const at = (c: number, r: number) => ({ x: (c + 0.5) * TILE, y: (r + 1) * TILE });
    const obj = (o: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, y: number) => o.setDepth(DEPTH.objects + y);

    // дома: низ спрайта — низ клетки
    [['house1', 20, 4], ['house2', 7, 4], ['house3', 13, 5]].forEach(([k, c, r]) => {
      const p = at(c as number, r as number);
      obj(this.add.image(p.x, p.y, k as string).setOrigin(0.5, 1), p.y);
    });
    const ruined = at(22, 8);
    obj(this.add.image(ruined.x, ruined.y, 'house_destroyed').setOrigin(0.5, 1), ruined.y);
    const fire = this.add.sprite(ruined.x, ruined.y - 40, 'fx_fire2').setOrigin(0.5, 1);
    obj(fire.play(fxKey('fire2')), ruined.y + 1);

    // деревья (кадры 192×256 / 192×192, ствол у низа)
    [['tree1', 9, 2], ['tree2', 18, 3], ['tree3', 5, 8], ['tree4', 24, 10]].forEach(([k, c, r], i) => {
      const p = at(c as number, r as number);
      const s = this.add.sprite(p.x, p.y, k as string).setOrigin(0.5, 0.9);
      obj(s.play({ key: fxKey(k as string), startFrame: i }), p.y);
    });
    [['bush1', 19, 9], ['bush2', 6, 12]].forEach(([k, c, r]) => {
      const p = at(c as number, r as number);
      obj(this.add.sprite(p.x, p.y, k as string).setOrigin(0.5, 0.75).play(fxKey(k as string)), p.y);
    });
    [['sheep_idle', 21, 9], ['sheep_grass', 23, 8]].forEach(([k, c, r]) => {
      const p = at(c as number, r as number);
      obj(this.add.sprite(p.x, p.y, k as string).setOrigin(0.5, 0.7).play(fxKey(k as string)), p.y);
    });
    const rock = at(9, 12);
    obj(this.add.image(rock.x, rock.y, 'rock2').setOrigin(0.5, 0.8), rock.y);

    // лодка в воде
    const boat = at(28, 11);
    obj(this.add.sprite(boat.x, boat.y, 'boat').setOrigin(0.5, 0.6).play(fxKey('boat')), boat.y);
  }
}
