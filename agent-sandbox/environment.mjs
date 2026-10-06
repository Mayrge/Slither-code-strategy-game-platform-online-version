import { SnakeGame } from '../public/core/engine.js';
import { scoreRound,makeReplay } from '../public/core/replay.js';
import { StrategyVM } from '../server/sandbox.mjs';
export class AgentArena {
  constructor(players,{seed='TRAINING',rotation=0,recordReplay=true}={}) {
    this.players=players;this.game=new SnakeGame(players,{seed,rotation,foodTarget:60});this.vms=new Map();this.errors=new Map();this.frames=recordReplay?[this.game.snapshot()]:null;
  }
  async initialize(){for(const p of this.players){try{this.vms.set(p.id,await StrategyVM.create(p.source,this.game.seed+':'+p.id));}catch{this.errors.set(p.id,'代码加载失败或初始化超时');}}return this;}
  observation(id=1){return this.game.observation(id);}
  record(game=1,actions=null){const frame=this.game.snapshot(),coord=cell=>[cell%30,Math.floor(cell/30)];return {game,turn:frame.turn,seed:this.game.seed,done:frame.done,actions,state:{...frame,food:frame.food.map(coord),snakes:frame.snakes.map(s=>({...s,body:s.body.map(coord)}))},results:frame.done?scoreRound(this.game.snakes).map(({id,name,score,rank,points,alive,deathReason,deathTurn})=>({id,name,score,rank,points,alive,deathReason,deathTurn})):null};}
  step(manual=null){
    if(this.game.done)return this.record();
    const alive=this.game.snakes.filter(s=>s.alive);
    if(manual&&alive.some(s=>!['up','right','down','left'].includes(typeof manual[s.id]==='string'?manual[s.id]:manual[s.id]?.direction)))throw Error('手动动作必须覆盖所有存活蛇并使用合法方向');
    const actions=manual?new Map(alive.map(s=>[s.id,manual[s.id]])):new Map(alive.map(s=>[s.id,this.errors.has(s.id)?{error:this.errors.get(s.id)}:this.vms.get(s.id).decide(this.observation(s.id))]));
    const frame=this.game.step(actions);this.frames?.push(frame);
    for(const s of this.game.snakes.filter(s=>!s.alive)){this.vms.get(s.id)?.dispose();this.vms.delete(s.id);}
    return this.record(1,Object.fromEntries(actions));
  }
  replay(){if(!this.frames)throw Error('未启用回放记录');return makeReplay(this.game.config,this.game.seed,this.frames);}
  close(){for(const vm of this.vms.values())vm.dispose();this.vms.clear();}
}
