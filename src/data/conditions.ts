import { mulberry32 } from '../mapgen/rng';

export type WeatherKind = 'clear' | 'rain' | 'wind' | 'mist';
export type MissionKind = 'defense' | 'keyHouse' | 'extraWave';

export const WEATHER = {
  clear: { name: 'Ясно', effect: '', rangeMult: 1, scatterMult: 1 },
  rain: { name: 'Дождь', effect: 'дальность −10% · разброс +20%', rangeMult: 0.9, scatterMult: 1.2 },
  wind: { name: 'Сильный ветер', effect: 'разброс стрельбы +45%', rangeMult: 1, scatterMult: 1.45 },
  mist: { name: 'Густой туман', effect: 'дальность −20% · разброс +10%', rangeMult: 0.8, scatterMult: 1.1 },
} as const;

export const MISSIONS = {
  defense: { name: 'Оборона', description: 'Отбейте все волны', bonus: 0 },
  keyHouse: { name: 'Ключевой дом', description: 'Не дайте отмеченному дому загореться', bonus: 3 },
  extraWave: { name: 'Последний рубеж', description: 'Отбейте дополнительную волну', bonus: 5 },
} as const;

export function islandConditions(seed: number, difficulty: number, isFinal: boolean): { weather: WeatherKind; mission: MissionKind } {
  const weatherRoll = mulberry32(seed ^ 0x73a4c291)();
  const weather: WeatherKind = weatherRoll < 0.45 ? 'clear' : weatherRoll < 0.67 ? 'rain' : weatherRoll < 0.85 ? 'wind' : 'mist';
  const missionRoll = mulberry32(seed ^ 0x19d8e357)();
  const mission: MissionKind = isFinal || difficulty === 0 ? 'defense' : missionRoll < 0.28 ? 'keyHouse' : missionRoll < 0.43 ? 'extraWave' : 'defense';
  return { weather, mission };
}
