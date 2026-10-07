import test from 'node:test';
import assert from 'node:assert/strict';
import { tunnelUrl,configurePublicUrl } from '../scripts/quick-tunnel.mjs';

test('quick tunnel accepts only a Cloudflare temporary hostname',()=>{
  assert.equal(tunnelUrl('INF | https://snake-practice.trycloudflare.com |'),'https://snake-practice.trycloudflare.com');
  assert.equal(tunnelUrl('https://github.com/cloudflare/cloudflared'),null);
  assert.throws(()=>configurePublicUrl('','https://wrong.example.com'));
  assert.throws(()=>configurePublicUrl('','https://snake.trycloudflare.com/path'));
});
test('quick tunnel config preserves unrelated local settings and line endings',()=>{
  const text='# local settings\r\nPORT=3082\r\nPUBLIC_URL=https://old.example.com\r\nPRIVATE_SETTING=retain\r\n';
  assert.equal(configurePublicUrl(text,'https://snake.trycloudflare.com'),text.replace('https://old.example.com','https://snake.trycloudflare.com'));
  assert.equal(configurePublicUrl('PORT=3082','https://snake.trycloudflare.com'),'PORT=3082\nPUBLIC_URL=https://snake.trycloudflare.com\n');
});
