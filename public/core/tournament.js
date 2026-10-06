import { makeRandom } from './engine.js';

function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function makeSchedule(players, count, masterSeed) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('测试局数需要是1～1000的整数');
  if (players.length < 2 || players.length > 10 || new Set(players.map(p => p.id)).size !== players.length) throw new Error('需要2～10名不同选手');
  const random = makeRandom(masterSeed);
  const schedule = [];
  const n = players.length;
  for (let cycle = 1; schedule.length < count; cycle++) {
    const order = shuffle(players.map(p => p.id), random);
    const rotations = shuffle(Array.from({ length: n }, (_, i) => i), random);
    const seed = `${String(masterSeed).slice(0, 40)}-S${cycle}-${Math.floor(random() * 4294967296).toString(16).padStart(8, '0')}`;
    for (const rotation of rotations) {
      if (schedule.length === count) break;
      schedule.push({ round: schedule.length + 1, cycle, seed, rotation, order: [...order] });
    }
  }
  return schedule;
}

export function filterGames(games, query = '', winner = '') {
  const search = query.trim().toLowerCase();
  return games.filter(g => {
    const winners = g.results.filter(s => s.rank === 1);
    if (winner && !winners.some(s => String(s.id) === String(winner))) return false;
    if (!search) return true;
    if (/^\d+$/.test(search)) return g.round === Number(search);
    return g.seed.toLowerCase().includes(search) || winners.some(s => s.name.toLowerCase().includes(search));
  });
}

export function tournamentMetadata(session) {
  return { id: session.id, name: session.name || session.masterSeed || '未命名赛程', createdAt: session.createdAt,
    startedAt: session.startedAt || null,
    rankPlan: session.rankPlan || null, rankingRevision: session.rankingRevision ?? null, contestants: session.contestants || null, masterSeed: session.masterSeed,
    total: session.total, completed: session.completed, config: session.config, stats: session.stats,
    games: session.games, status: session.completed === session.total ? 'completed' : session.running ? 'running'
      : session.status === 'draft' && !session.startedAt && !session.completed ? 'draft' : session.error ? 'interrupted' : 'stopped' };
}
