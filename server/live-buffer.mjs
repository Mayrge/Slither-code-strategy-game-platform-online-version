// A bounded transient buffer. Complete replays are stored separately.
export class LiveBuffer {
  constructor(limit=120) { this.limit=limit; this.sequence=0; this.frames=[]; this.config=null; }
  push(round, frames, config) {
    this.config=config;
    for (const frame of frames) this.frames.push({seq:++this.sequence,round,frame});
    this.frames=this.frames.slice(-this.limit);
  }
  since(after=0) {
    const frames=this.frames.filter(item=>item.seq>after).slice(0,60);
    return {config:this.config,frames,sequence:frames.at(-1)?.seq ?? after};
  }
}
