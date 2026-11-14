import { islandConditions, type MissionKind, type WeatherKind } from '../src/data/conditions';
import { Campaign } from '../src/systems/CampaignState';

const weather = new Set<WeatherKind>();
const missions = new Set<MissionKind>();
for (let seed = 1; seed <= 300; seed++) {
  for (let difficulty = 0; difficulty <= 6; difficulty++) {
    const c = islandConditions(seed, difficulty, false);
    const again = islandConditions(seed, difficulty, false);
    if (c.weather !== again.weather || c.mission !== again.mission) throw new Error(`Условия не детерминированы: ${seed}/${difficulty}`);
    if (difficulty === 0 && c.mission !== 'defense') throw new Error(`Особое задание на первом острове: сид ${seed}`);
    if (islandConditions(seed, difficulty, true).mission !== 'defense') throw new Error(`Особое задание в финале: сид ${seed}`);
    weather.add(c.weather);
    missions.add(c.mission);
  }
}
if (weather.size !== 4 || missions.size !== 3) throw new Error('Не все виды погоды и заданий встретились на 300 сидах');

function victoriousCampaign(): { campaign: Campaign; nodeId: number } {
  const campaign = Campaign.create(12345);
  const node = campaign.data.nodes[0];
  campaign.applyResult(node.id, {
    won: true, seed: node.seed, housesSaved: 2, housesTotal: 2, coinsEarned: 6,
    usedSquadIds: campaign.data.squads.map((s) => s.id), lostSquadIds: [],
  });
  if (campaign.data.resting.length !== campaign.data.squads.length) throw new Error('Участники победы не отправлены на отдых');
  return { campaign, nodeId: node.id };
}

victoriousCampaign();

console.log(`Погода и задания: 300 сидов, варианты ${[...weather].join('/')}, ${[...missions].join('/')}; отдых после победы работает`);
