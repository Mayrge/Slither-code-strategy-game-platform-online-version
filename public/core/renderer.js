export class BoardRenderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.focus = null; this.showNames = true; }

  draw(frame, config) {
    const ctx = this.ctx, size = this.canvas.width;
    const cw = size / config.width, ch = size / config.height;
    const key = `${size}:${config.width}:${config.height}`;
    if (this.backgroundKey !== key) {
    this.background = this.canvas.ownerDocument.createElement('canvas');
    this.background.width = size; this.background.height = size;
    const background = this.background.getContext('2d');
    background.fillStyle = '#111c15'; background.fillRect(0, 0, size, size);
    for (let y = 0; y < config.height; y++) for (let x = 0; x < config.width; x++) {
      if ((Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0) {
        background.fillStyle = '#152019'; background.fillRect(x * cw, y * ch, cw, ch);
      }
    }
    background.strokeStyle = '#263329'; background.lineWidth = 0.6;
    background.beginPath();
    for (let i = 0; i <= config.width; i++) { background.moveTo(i * cw, 0); background.lineTo(i * cw, size); }
    for (let i = 0; i <= config.height; i++) { background.moveTo(0, i * ch); background.lineTo(size, i * ch); }
    background.stroke(); this.backgroundKey = key;
    }
    ctx.drawImage(this.background, 0, 0);
    for (const cell of frame.food) {
      const x = (cell % config.width + 0.5) * cw, y = (Math.floor(cell / config.width) + 0.5) * ch;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.shadowColor = '#fb897d'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#fb897d'; ctx.beginPath(); ctx.roundRect(-cw * .14, -ch * .14, cw * .28, ch * .28, 2); ctx.fill();
      ctx.restore();
    }
    const alive = frame.snakes.filter(s => s.alive);
    for (const snake of alive) {
      ctx.save();
      ctx.globalAlpha = this.focus !== null && this.focus !== snake.id ? .22 : .85;
      const unique = new Set(snake.body.slice(1));
      ctx.fillStyle = snake.color;
      for (const cell of unique) {
        const x = cell % config.width * cw, y = Math.floor(cell / config.width) * ch;
        ctx.beginPath(); ctx.roundRect(x + 2.5, y + 2.5, cw - 5, ch - 5, 5); ctx.fill();
      }
      ctx.globalAlpha = this.focus !== null && this.focus !== snake.id ? .3 : 1;
      const head = snake.body[0];
      const x = head % config.width * cw, y = Math.floor(head / config.width) * ch;
      ctx.shadowColor = snake.color; ctx.shadowBlur = 11;
      ctx.fillStyle = snake.color; ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, cw - 3, ch - 3, 6); ctx.fill(); ctx.shadowBlur = 0;
      ctx.save(); ctx.translate(x + cw / 2, y + ch / 2);
      ctx.rotate(({ up: -Math.PI / 2, right: 0, down: Math.PI / 2, left: Math.PI })[snake.direction]);
      ctx.fillStyle = '#142016';
      for (const eye of [-1, 1]) { ctx.beginPath(); ctx.arc(cw * .19, eye * ch * .18, cw * .055, 0, 2 * Math.PI); ctx.fill(); }
      ctx.restore(); ctx.restore();
    }
    // Draw endpoints after all bodies so a later snake cannot obscure a tail marker.
    for (const snake of alive) {
      const tail = snake.body.at(-1), overlapsHead = tail === snake.body[0];
      const x = (tail % config.width + (overlapsHead ? .77 : .5)) * cw;
      const y = (Math.floor(tail / config.width) + (overlapsHead ? .77 : .5)) * ch;
      const radius = Math.min(cw, ch) * (overlapsHead ? .12 : .2);
      ctx.save(); ctx.globalAlpha = this.focus !== null && this.focus !== snake.id ? .3 : 1;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#101713'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y-radius); ctx.lineTo(x+radius, y);
      ctx.lineTo(x, y+radius); ctx.lineTo(x-radius, y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (this.showNames) this.drawNames(alive, config, cw, ch);
  }

  drawNames(snakes, config, cw, ch) {
    const ctx = this.ctx, size = this.canvas.width, placed = [];
    const heads = snakes.map(s => ({x:s.body[0]%config.width*cw,y:Math.floor(s.body[0]/config.width)*ch,w:cw,h:ch}));
    const overlap = (a,b) => Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    ctx.save(); ctx.font = '600 12px "Microsoft YaHei", sans-serif'; ctx.textBaseline = 'middle';
    snakes.forEach((snake,index) => {
      const head = heads[index], cx = head.x+cw/2, cy = head.y+ch/2;
      const name = String(snake.name || '选手 #'+snake.id), w = Math.min(size-8,ctx.measureText(name).width+16), h = 20;
      const candidates = [[cx-w/2,head.y-h-4],[cx-w/2,head.y+ch+4],[head.x+cw+4,cy-h/2],[head.x-w-4,cy-h/2]];
      const boxes = candidates.map(([x,y]) => ({x:Math.max(4,Math.min(size-w-4,x)),y:Math.max(4,Math.min(size-h-4,y)),w,h}));
      const score = box => placed.reduce((sum,b)=>sum+overlap(box,b),0)+heads.reduce((sum,b)=>sum+overlap(box,b)*2,0);
      const box = boxes.reduce((best,b)=>score(b)<score(best)?b:best); placed.push(box);
      ctx.globalAlpha = this.focus !== null && this.focus !== snake.id ? .3 : 1;
      ctx.strokeStyle = snake.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(Math.max(box.x,Math.min(box.x+w,cx)),Math.max(box.y,Math.min(box.y+h,cy))); ctx.stroke();
      ctx.fillStyle = '#101713ee'; ctx.beginPath(); ctx.roundRect(box.x,box.y,w,h,5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f5faef'; ctx.fillText(name,box.x+8,box.y+h/2,w-16);
    });
    ctx.restore();
  }
}
