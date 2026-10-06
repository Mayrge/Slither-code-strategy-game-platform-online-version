import { DIRECTIONS, rankSnakes } from './engine.js';

export function makeReplay(config, seed, frames) {
  return { format: 'snake-arena', version: 1, createdAt: new Date().toISOString(), config, seed, frames };
}

export function validateReplay(value) {
  if (!value || value.format !== 'snake-arena' || value.version !== 1) throw new Error('这不是有效的 Snake Arena 回放');
  const config = value.config;
  if (!config || config.width !== 30 || config.height !== 30 || config.maxTurns !== 500) throw new Error('回放需要使用30×30地图、500回合规则');
  const frames = value.frames;
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 501) throw new Error('回放帧数无效');
  const validCell = cell => Number.isInteger(cell) && cell >= 0 && cell < 900;
  const first = frames[0];
  if (!Array.isArray(first.snakes) || first.snakes.length < 2 || first.snakes.length > 10) throw new Error('回放玩家数无效');
  const ids = first.snakes.map(s => s.id);
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw new Error('回放玩家ID无效');
  const safeFrames = frames.map((frame, i) => {
    if (!frame || frame.turn !== i || typeof frame.done !== 'boolean' || !Array.isArray(frame.food) || frame.food.length > 900 || !frame.food.every(validCell) || new Set(frame.food).size !== frame.food.length || !Array.isArray(frame.snakes) || frame.snakes.length !== ids.length || frame.snakes.some((s, j) => s.id !== ids[j])) throw new Error(`第${i}帧数据无效`);
    if (!Array.isArray(frame.events) || frame.events.length > 50) throw new Error('回放事件数据无效');
    const snakes = frame.snakes.map(s => {
      if (typeof s.name !== 'string' || s.name.length > 64 || !/^#[0-9a-f]{6}$/i.test(s.color) || typeof s.alive !== 'boolean' || !Object.hasOwn(DIRECTIONS, s.direction) || !Number.isInteger(s.score) || s.score < 5 || s.score > 505 || !Array.isArray(s.body) || s.body.length > 505 || !s.body.every(validCell) || (s.alive ? s.body.length !== s.score : s.body.length !== 0) || (s.deathTurn !== null && (!Number.isInteger(s.deathTurn) || s.deathTurn < 1 || s.deathTurn > frame.turn))) throw new Error(`第${i}帧玩家数据无效`);
      return { id: s.id, name: s.name, color: s.color, alive: s.alive, direction: s.direction, score: s.score, body: [...s.body], deathTurn: s.deathTurn, deathReason: s.deathReason == null ? null : String(s.deathReason).slice(0, 100) };
    });
    const events = frame.events.map(e => {
      if (!e || !['death', 'eat', 'drop', 'finish'].includes(e.type)) throw new Error('回放事件类型无效');
      return { type: e.type, id: Number(e.id) || 0, name: String(e.name || '').slice(0, 64), reason: String(e.reason || '').slice(0, 100), score: Number(e.score) || 0, count: Number(e.count) || 0 };
    });
    return { turn: i, done: frame.done, food: [...frame.food], snakes, events };
  });
  return { format: 'snake-arena', version: 1, config: { ...config }, seed: String(value.seed || 'REPLAY').slice(0, 64), frames: safeFrames };
}

export function scoreRound(snakes) {
  const ranked = rankSnakes(snakes);
  return ranked.map(s => {
    const count = ranked.filter(other => other.score === s.score).length;
    const averageRank = s.rank + (count - 1) / 2;
    return { ...s, points: (ranked.length - averageRank) / (ranked.length - 1) * 100 };
  });
}
