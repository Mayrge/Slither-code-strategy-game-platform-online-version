import { parentPort, workerData } from 'node:worker_threads';
import { SnakeGame } from '../public/core/engine.js';
import { makeReplay,scoreRound } from '../public/core/replay.js';
import { StrategyVM } from './sandbox.mjs';

try {
  for(const round of workerData.schedule) {
    const players=round.order.map(id=>workerData.players.find(p=>p.id===id));
    const game=new SnakeGame(players,{seed:round.seed,rotation:round.rotation,foodTarget:60});
    const vms=new Map(),errors=new Map(),frames=[game.snapshot()];
    try {
      for(const p of players) {
        try { vms.set(p.id,await StrategyVM.create(p.source,round.seed+':'+p.id)); }
        catch { errors.set(p.id,'代码加载失败或初始化超时'); }
      }
      let pending=[frames[0]];
      const flush=()=>{parentPort.postMessage({type:'frames',round:round.round,frames:pending,config:game.config});pending=[];};
      flush();
      while(!game.done) {
        const actions=new Map(game.snakes.filter(s=>s.alive).map(s=>[s.id,errors.has(s.id)?{error:errors.get(s.id)}:vms.get(s.id).decide(game.observation(s.id))]));
        const frame=game.step(actions); frames.push(frame);
        pending.push(frame);
        for(const s of game.snakes.filter(s=>!s.alive)) { vms.get(s.id)?.dispose(); vms.delete(s.id); }
        if(game.turn%10===0 || game.done) flush();
      }
      parentPort.postMessage({type:'game',round:round.round,seed:round.seed,results:scoreRound(game.snakes).map(({id,name,color,score,rank,points,alive,deathTurn,deathReason})=>({id,name,color,score,rank,points,alive,deathTurn,deathReason})),replay:makeReplay(game.config,game.seed,frames)});
    } finally { for(const vm of vms.values()) vm.dispose(); }
  }
  parentPort.postMessage({type:'done'});
} catch { parentPort.postMessage({type:'failed',error:'比赛运行异常，请联系管理员'}); }
