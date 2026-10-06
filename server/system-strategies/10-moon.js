// 月白 · 采集 · 食物优先
// 在受限解释器中使用最多48个格子的空间搜索，保持50毫秒预算。
const PROFILE = {
  "name": "月白 · 采集",
  "role": "食物优先",
  "food": 17,
  "safety": 75,
  "space": 0.09,
  "hunt": 0,
  "center": 0.04
};

export default function builtinDecide(state) {
  const me = state.snakes.find(s => s.id === state.you);
  const { width: w, height: h } = state;
  const moves = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
  const opposite = { up: 'down', right: 'left', down: 'up', left: 'right' };
  const key = (x, y) => y * w + x;
  const enemies = state.snakes.filter(s => s.alive && s.id !== me.id);
  const blocked = new Set(enemies.flatMap(s => s.body.map(([x, y]) => key(x, y))));
  const foods = new Set(state.food.map(([x, y]) => key(x, y)));
  const danger = new Set();
  for (const enemy of enemies) {
    const [x, y] = enemy.body[0];
    for (const [name, [dx, dy]] of Object.entries(moves)) {
      if (name === opposite[enemy.direction]) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) danger.add(key(nx, ny));
    }
  }
  function explore(sx, sy) {
    const queue = [[sx, sy, 0]];
    const seen = new Set([key(sx, sy)]);
    let distance = w + h;
    for (const [fx, fy] of state.food) distance = Math.min(distance, Math.abs(fx - sx) + Math.abs(fy - sy));
    for (let i = 0; i < queue.length && i < 48; i++) {
      const [x, y, d] = queue[i];
      if (foods.has(key(x, y))) distance = Math.min(distance, d);
      for (const [dx, dy] of Object.values(moves)) {
        const nx = x + dx, ny = y + dy, cell = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || blocked.has(cell) || seen.has(cell)) continue;
        seen.add(cell); queue.push([nx, ny, d + 1]);
      }
    }
    return { distance, space: Math.min(seen.size, 48) };
  }
  const [hx, hy] = me.body[0];
  let best = -Infinity, choice = me.direction;
  for (const [name, [dx, dy]] of Object.entries(moves)) {
    if (name === opposite[me.direction]) continue;
    const x = hx + dx, y = hy + dy, cell = key(x, y);
    if (x < 0 || y < 0 || x >= w || y >= h || blocked.has(cell)) continue;
    const result = explore(x, y);
    const nearest = enemies.length ? Math.min(...enemies.map(s => Math.abs(s.body[0][0] - x) + Math.abs(s.body[0][1] - y))) : w + h;
    const centerDistance = Math.abs(x - (w - 1) / 2) + Math.abs(y - (h - 1) / 2);
    const score = -result.distance * PROFILE.food + result.space * PROFILE.space
      - (danger.has(cell) ? PROFILE.safety : 0) - nearest * PROFILE.hunt
      - centerDistance * PROFILE.center + (foods.has(cell) ? PROFILE.food * 2 : 0)
      + (name === me.direction ? 0.3 : 0) + Math.random() * 0.2;
    if (score > best) { best = score; choice = name; }
  }
  return { direction: choice };
}
