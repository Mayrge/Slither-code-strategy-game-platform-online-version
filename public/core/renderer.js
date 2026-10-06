export class BoardRenderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.focus = null; }

  draw(frame, config) {
    const ctx = this.ctx, size = this.canvas.width;
    const cw = size / config.width, ch = size / config.height;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#111c15'; ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < config.height; y++) for (let x = 0; x < config.width; x++) {
      if ((Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0) {
        ctx.fillStyle = '#152019'; ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
    ctx.strokeStyle = '#263329'; ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i <= config.width; i++) { ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, size); }
    for (let i = 0; i <= config.height; i++) { ctx.moveTo(0, i * ch); ctx.lineTo(size, i * ch); }
    ctx.stroke();
    for (const cell of frame.food) {
      const x = (cell % config.width + 0.5) * cw, y = (Math.floor(cell / config.width) + 0.5) * ch;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.shadowColor = '#fb897d'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#fb897d'; ctx.beginPath(); ctx.roundRect(-cw * .14, -ch * .14, cw * .28, ch * .28, 2); ctx.fill();
      ctx.restore();
    }
    for (const snake of frame.snakes.filter(s => s.alive)) {
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
  }
}
