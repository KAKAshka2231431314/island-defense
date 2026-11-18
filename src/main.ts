import Phaser from 'phaser';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import { WATER_COLOR } from './data/config';
import { installDevSim } from './systems/devSim';
import { sfx } from './systems/Sound';
import { BattleHudScene } from './scenes/BattleHudScene';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { CampaignScene } from './scenes/CampaignScene';
import { IslandPreviewScene } from './scenes/IslandPreviewScene';
import { DebugHudScene } from './scenes/DebugHudScene';
import { MenuScene, MenuUiScene } from './scenes/MenuScene';
import { ResultsScene } from './scenes/ResultsScene';
import { TestMapScene } from './scenes/TestMapScene';
import { UpgradeScene } from './scenes/UpgradeScene';

function createGame(): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: WATER_COLOR,
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    // все файлы стартуют сразу: очередь загрузчика иначе двигается только по кадрам (в фоне — очень медленно)
    loader: { maxParallelDownloads: 256 },
    scene: [BootScene, MenuScene, MenuUiScene, CampaignScene, IslandPreviewScene, UpgradeScene, BattleScene, BattleHudScene, ResultsScene, TestMapScene, DebugHudScene],
  });
}

/** Пиксельный шрифт меню должен успеть загрузиться до создания текстов (иначе Phaser нарисует запасным). */
async function loadFonts(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('16px "Pixelify Sans"', 'Аа Яя Zz'), document.fonts.load('bold 16px "Pixelify Sans"', 'Аа Яя Zz')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* без шрифта — запасной monospace */
  }
}

/** Игра стартует, только когда у страницы есть размер: в фоновой вкладке он бывает 0, и WebGL не создаёт буфер кадра. */
function start(): void {
  const parent = document.getElementById('game');
  if (!window.innerWidth || !window.innerHeight || !parent || !parent.clientWidth || !parent.clientHeight) {
    setTimeout(start, 100);
    return;
  }
  const game = createGame();
  const fit = () => {
    const w = Math.max(1, parent.clientWidth || window.innerWidth);
    const h = Math.max(1, parent.clientHeight || window.innerHeight);
    game.scale.resize(w, h);
  };
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  // браузер может раскрыться уже после создания canvas — догоняем реальный размер несколькими проверками
  for (const delay of [0, 100, 400, 1000]) setTimeout(fit, delay);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    window.removeEventListener('resize', fit);
    window.removeEventListener('orientationchange', fit);
  });
  // для отладки из консоли браузера
  if (import.meta.env.DEV) {
    (window as unknown as { game: Phaser.Game }).game = game;
    installDevSim(game);
  }
}
void loadFonts().then(start);

// браузер разрешает звук только после действия пользователя
window.addEventListener('pointerdown', () => sfx.unlock());
window.addEventListener('keydown', () => sfx.unlock());
