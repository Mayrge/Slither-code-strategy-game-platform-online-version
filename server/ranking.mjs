import { randomUUID } from 'node:crypto';
import { makeSchedule } from '../public/core/tournament.js';
export const LEAGUES = ['华山论剑','凌云争锋','潜龙试剑'];
export const COOLDOWN = 12 * 3600000;
export const emptyRanking = () => ({ order:[], revision:0, history:[] });
export function chooseOpponents(state, players, candidate) {
  const byId = new Map(players.map(p => [p.id,p]));
  const existing = state.order.indexOf(candidate.id);
  const ordered = state.order.map(id => byId.get(id)).filter(p => p && p.status === 'registered' && p.id !== candidate.id && (p.system || p.owner !== candidate.owner));
  let preferences;
  if (existing < 0) {
    // Newcomers meet anchors across the board, including the champion.
    const anchors = Array.from({length:Math.min(9,ordered.length)}, (_,i) => ordered[Math.round(i * (ordered.length - 1) / Math.max(1,Math.min(9,ordered.length)-1))]);
    preferences = [...anchors,...ordered];
  } else preferences = [...ordered].sort((a,b) => Math.abs(state.order.indexOf(a.id)-existing)-Math.abs(state.order.indexOf(b.id)-existing));
  preferences.push(...players.filter(p => p.system && p.status === 'registered'));
  const selected = [], owners = new Set([candidate.owner]), ids = new Set([candidate.id]);
  for (const p of preferences) {
    if (ids.has(p.id) || (!p.system && owners.has(p.owner))) continue;
    selected.push(p); ids.add(p.id); if (!p.system) owners.add(p.owner);
    if (selected.length === 9) break;
  }
  if (!selected.length) throw new Error('暂时没有可参与排位的对手');
  return [candidate,...selected];
}
export function planJob(state, roster, candidate, kind) {
  return { revision:state.revision, candidate:candidate?.id ?? null, kind, members:roster.map(p=>p.id) };
}
export function scheduleJob(roster, count, seed = randomUUID()) { return makeSchedule(roster,count,seed); }
export function settleRanking(state, plan, games, now = Date.now()) {
  if (plan.revision !== state.revision) throw new Error('排名版本变化，无法结算');
  if (games.length !== 50) throw new Error('正式排位必须完整完成50局');
  const totals = new Map(plan.members.map(id=>[id,{points:0,score:0,games:0}]));
  for (const game of games) for (const result of game.results) {
    const t = totals.get(result.id); if (!t) throw new Error('未知参赛选手');
    t.points+=result.points; t.score+=result.score; t.games++;
  }
  for (const t of totals.values()) if (t.games!==50) throw new Error('参赛记录不完整');
  const averages = Object.fromEntries([...totals].map(([id,t])=>[id,{...t,average:t.points/t.games}]));
  const next = structuredClone(state), before=[...next.order]; let retired=null;
  if (plan.kind==='bootstrap') next.order=[...plan.members].sort((a,b)=>averages[b].average-averages[a].average || plan.members.indexOf(a)-plan.members.indexOf(b));
  else if (!next.order.includes(plan.candidate)) {
    // Conservative anchor placement: remain behind every tested anchor not beaten.
    const notBeaten=plan.members.filter(id=>id!==plan.candidate && next.order.includes(id) && averages[id].average>=averages[plan.candidate].average-1e-8);
    const position=notBeaten.length?Math.max(...notBeaten.map(id=>next.order.indexOf(id)))+1:0;
    next.order.splice(position,0,plan.candidate);
    if(next.order.length>30) retired=next.order.pop();
  } else {
    const played=plan.members.filter(id=>next.order.includes(id));
    const slots=played.map(id=>next.order.indexOf(id)).sort((a,b)=>a-b);
    const sorted=[...played].sort((a,b)=>averages[b].average-averages[a].average || before.indexOf(a)-before.indexOf(b));
    slots.forEach((slot,i)=>next.order[slot]=sorted[i]);
  }
  next.revision++;
  next.history.unshift({at:now,before,after:[...next.order],candidate:plan.candidate,kind:plan.kind});
  return { ranking:next,averages,retired };
}
