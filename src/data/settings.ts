// Пользовательские настройки (хранятся в localStorage).
import { TIME } from './balance';

export interface Settings {
  showDamageNumbers: boolean;
  sound: boolean;
  /** громкость 0..1 */
  volume: number;
  /** замедление времени при выборе отряда */
  slowMo: number;
  /** подсказки управления в первых боях кампании */
  hints: boolean;
  /** сколько боёв уже показаны подсказки по управлению */
  hintBattles: number;
}

const KEY = 'island-defense:settings';
const DEFAULTS: Settings = { showDamageNumbers: true, sound: true, volume: 0.8, slowMo: TIME.slowMo, hints: true, hintBattles: 0 };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* приватный режим — настройки живут до перезагрузки */
  }
}
