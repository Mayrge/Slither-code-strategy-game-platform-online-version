export const COLORS = ['#b9fa74', '#7ac9ff', '#fb897d', '#c0a1ff', '#ffd56b', '#5cdec5', '#fc91c9', '#f3a960', '#8da6ff', '#d5e8e3'];
export const DIRECTIONS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const OPPOSITE = { up: 'down', right: 'left', down: 'up', left: 'right' };
export const DEFAULTS = Object.freeze({ width: 30, height: 30, maxTurns: 500, initialLength: 5, dropRatio: 0.3, decisionMs: 50 });

export function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0 || 1;
}

export function makeRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function rankSnakes(snakes) {
  const sorted = [...snakes].sort((a, b) => b.score - a.score || a.id - b.id);
  return sorted.map((snake, i) => ({ ...snake, rank: i > 0 && sorted[i - 1].score === snake.score ? sorted.findIndex(s => s.score === snake.score) + 1 : i + 1 }));
}

export class SnakeGame {
  constructor(players, options = {}) {
    if (players.length < 2 || players.length > 10) throw new Error('每场比赛需要2～10条蛇');
    this.config = { ...DEFAULTS, ...options, foodTarget: options.foodTarget ?? 20 + 4 * players.length };
    const { width, height, initialLength, maxTurns, dropRatio, foodTarget } = this.config;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 15 || height < 15 || width > 60 || height > 60) throw new Error('地图边长需要在15～60之间');
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 2000 || initialLength !== 5 || dropRatio < 0 || dropRatio > 1 || !Number.isInteger(foodTarget) || foodTarget < 0 || foodTarget > width * height) throw new Error('比赛参数无效');
    if (new Set(players.map(p => p.id)).size !== players.length) throw new Error('选手ID必须唯一');
    this.seed = String(options.seed ?? 'SNAKE-2026');
    this.random = makeRandom(this.seed);
    this.turn = 0;
    this.food = new Set();
    this.events = [];
    this.done = false;
    const cols = Math.ceil(players.length / 2);
    const rotation = options.rotation || 0;
    this.snakes = players.map((player, index) => {
      const slot = (index + rotation) % players.length;
      const top = slot < cols;
      const col = top ? slot : slot - cols;
      const x = cols === 1 ? Math.floor(width / 2) : 3 + Math.round(col * (width - 7) / (cols - 1));
      const y = top ? 6 : height - 7;
      const direction = top ? 'down' : 'up';
      const body = Array.from({ length: initialLength }, (_, i) => (y + (top ? -i : i)) * width + x);
      return { id: player.id, name: player.name, color: player.color || COLORS[index], body, direction, alive: true, score: initialLength, deathTurn: null, deathReason: null };
    });
    this.replenishFood();
  }

  occupied() { return new Set(this.snakes.filter(s => s.alive).flatMap(s => s.body)); }

  replenishFood() {
    const occupied = this.occupied();
    const free = [];
    for (let cell = 0; cell < this.config.width * this.config.height; cell++) {
      if (!occupied.has(cell) && !this.food.has(cell)) free.push(cell);
    }
    while (this.food.size < this.config.foodTarget && free.length) {
      const i = Math.floor(this.random() * free.length);
      this.food.add(free[i]);
      free[i] = free[free.length - 1]; free.pop();
    }
  }

  observation(you) {
    const { width, height, maxTurns } = this.config;
    const coordinate = cell => [cell % width, Math.floor(cell / width)];
    return {
      turn: this.turn, width, height, maxTurns, remainingTurns: maxTurns - this.turn, seed: this.seed, you,
      food: [...this.food].map(coordinate),
      snakes: this.snakes.map(s => ({ id: s.id, name: s.name, alive: s.alive, direction: s.direction, score: s.score, length: s.score, body: s.alive ? s.body.map(coordinate) : [], deathTurn: s.deathTurn }))
    };
  }

  snapshot() {
    return {
      turn: this.turn, done: this.done, food: [...this.food], events: this.events.map(e => ({ ...e })),
      snakes: this.snakes.map(s => ({ ...s, body: [...s.body] }))
    };
  }

  step(actions) {
    if (this.done) return this.snapshot();
    const { width, height, maxTurns, dropRatio } = this.config;
    this.turn++;
    this.events = [];
    const intents = new Map();
    for (const snake of this.snakes.filter(s => s.alive)) {
      const action = actions instanceof Map ? actions.get(snake.id) : actions[snake.id];
      const direction = typeof action === 'string' ? action : action?.direction;
      let reason = action?.error || null;
      if (!reason && !Object.hasOwn(DIRECTIONS, direction)) reason = '输出无效';
      if (!reason && direction === OPPOSITE[snake.direction]) reason = '反向移动';
      const [dx, dy] = DIRECTIONS[direction] || [0, 0];
      const x = snake.body[0] % width + dx;
      const y = Math.floor(snake.body[0] / width) + dy;
      if (!reason && (x < 0 || y < 0 || x >= width || y >= height)) reason = '撞到边界';
      const cell = y * width + x;
      intents.set(snake.id, { direction, cell, grow: !reason && this.food.has(cell), moving: !reason, reason });
    }
    // Every decision sees the same pre-turn board. Vacate the tails of legal,
    // non-growing moves before collision checks, even if the snake dies later.
    const bodies = new Map();
    for (const snake of this.snakes.filter(s => s.alive)) {
      const intent = intents.get(snake.id);
      bodies.set(snake.id, new Set(intent.moving && !intent.grow ? snake.body.slice(0, -1) : snake.body));
    }
    const destinations = new Map();
    for (const snake of this.snakes.filter(s => s.alive)) {
      const intent = intents.get(snake.id);
      if (!intent.moving) continue;
      if (!destinations.has(intent.cell)) destinations.set(intent.cell, []);
      destinations.get(intent.cell).push(snake.id);
    }
    for (const snake of this.snakes.filter(s => s.alive)) {
      const intent = intents.get(snake.id);
      if (!intent.moving) continue;
      if (destinations.get(intent.cell).length > 1) intent.reason = '蛇头相撞';
      for (const other of this.snakes.filter(s => s.alive && s.id !== snake.id)) {
        const otherIntent = intents.get(other.id);
        if (otherIntent.moving && intent.cell === other.body[0] && otherIntent.cell === snake.body[0]) intent.reason ||= '蛇头交换位置';
        if (bodies.get(other.id).has(intent.cell)) intent.reason ||= '撞到对手身体';
      }
    }
    const dead = [];
    for (const snake of this.snakes.filter(s => s.alive)) {
      const intent = intents.get(snake.id);
      if (intent.reason) {
        dead.push({ snake, body: [...snake.body] });
        snake.alive = false; snake.deathTurn = this.turn; snake.deathReason = intent.reason;
        this.events.push({ type: 'death', id: snake.id, name: snake.name, reason: intent.reason, score: snake.score });
        continue;
      }
      snake.body.unshift(intent.cell);
      snake.direction = intent.direction;
      if (intent.grow) {
        this.food.delete(intent.cell);
        snake.score++;
        this.events.push({ type: 'eat', id: snake.id, name: snake.name, cell: intent.cell });
      } else snake.body.pop();
    }
    const occupied = this.occupied();
    for (const { snake, body } of dead) {
      let remaining = Math.floor(snake.score * dropRatio);
      const target = remaining;
      // Preserve the length-based drop even when the body overlaps itself.
      const origin = body[0];
      const candidates = shuffled([...new Set(body)], this.random);
      const nearby = [];
      for (let cell = 0; cell < width * height; cell++) {
        if (!occupied.has(cell) && !this.food.has(cell)) nearby.push(cell);
      }
      const ox = origin % width, oy = Math.floor(origin / width);
      const distance = cell => Math.abs(cell % width - ox) + Math.abs(Math.floor(cell / width) - oy);
      nearby.sort((a, b) => distance(a) - distance(b) || a - b);
      for (const cell of [...candidates, ...nearby]) {
        if (!remaining) break;
        if (occupied.has(cell) || this.food.has(cell)) continue;
        this.food.add(cell); remaining--;
      }
      snake.body = [];
      this.events.push({ type: 'drop', id: snake.id, name: snake.name, count: target - remaining });
    }
    this.replenishFood();
    this.done = this.turn >= maxTurns || !this.snakes.some(s => s.alive);
    if (this.done) this.events.push({ type: 'finish', reason: this.turn >= maxTurns ? '达到回合上限' : '全部玩家死亡' });
    return this.snapshot();
  }
}
