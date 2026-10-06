import { getQuickJS } from 'quickjs-emscripten';
import { makeRandom } from '../public/core/engine.js';

// No host callbacks, filesystem, network or Node objects are exposed to strategies.
export class StrategyVM {
  static async create(source, seed, budget = 50) {
    const engine = await getQuickJS();
    const runtime = engine.newRuntime();
    runtime.setMemoryLimit(16 * 1024 * 1024);
    runtime.setMaxStackSize(256 * 1024);
    const vm = runtime.newContext();
    const instance = new StrategyVM(runtime, vm, budget);
    runtime.setInterruptHandler(() => performance.now() > instance.deadline);
    runtime.setModuleLoader(name => {
      if (name !== 'strategy') throw new Error('不允许导入外部模块');
      return source;
    });
    try {
      instance.evaluate(`Math.random = (${makeRandom.toString()})(__seed);`, {
        __seed: String(seed)
      }, `const hashSeed = ${String((await import('../public/core/engine.js')).hashSeed)};`);
      instance.evaluate('globalThis.console = Object.freeze({log(){},warn(){},error(){},info(){},debug(){}}); globalThis.Date = undefined;');
      instance.deadline = performance.now() + budget;
      const loaded = vm.evalCode('import * as bot from "strategy"; globalThis.__strategy = bot.default || bot.decide; if (typeof __strategy !== "function") throw Error("missing decide");', 'entry.js', { type: 'module' });
      instance.finish(loaded, '代码加载失败或初始化超时');
      if (performance.now() > instance.deadline) throw new Error('初始化超时');
      instance.evaluate('if (typeof globalThis.__strategy !== "function") throw Error("仅支持同步模块");');
      return instance;
    } catch (error) { instance.dispose(); throw error; }
  }
  constructor(runtime, vm, budget) { this.runtime = runtime; this.vm = vm; this.budget = budget; this.deadline = 0; this.disposed = false; }
  finish(result, message) {
    if (result.error) { result.error.dispose(); throw new Error(message); }
    result.value.dispose();
  }
  evaluate(code, values = {}, prefix = '') {
    this.deadline = performance.now() + this.budget;
    for (const [key, value] of Object.entries(values)) {
      const handle = this.vm.newString(value); this.vm.setProp(this.vm.global, key, handle); handle.dispose();
    }
    this.finish(this.vm.evalCode(prefix + code), '策略异常或决策超时');
  }
  decide(state) {
    try {
      this.evaluate(`(() => { globalThis.__answer = undefined; const answer = __strategy(JSON.parse(__state)); if (answer && typeof answer.then === 'function') throw Error('仅支持同步策略'); const direction = typeof answer === 'string' ? answer : answer?.direction; if (!['up','right','down','left'].includes(direction)) throw Error('无效方向'); globalThis.__answer = direction; })();`, { __state: JSON.stringify(state) });
      if (performance.now() > this.deadline) return { error:'决策超时' };
      const handle = this.vm.getProp(this.vm.global, '__answer');
      const direction = this.vm.getString(handle); handle.dispose();
      return { direction };
    } catch { return { error: performance.now() > this.deadline ? '决策超时' : '策略异常或输出无效' }; }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    try { this.vm.dispose(); } finally { this.runtime.dispose(); }
  }
}

export async function validateStrategy(source) {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 100000) throw new Error('策略需要是100KB以内的JavaScript代码');
  const vm = await StrategyVM.create(source, 'VALIDATION'); vm.dispose();
}
