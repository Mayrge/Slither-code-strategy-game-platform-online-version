import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { createAgentKit } from '../agent-sandbox/package-kit.mjs';
import { readFile } from 'node:fs/promises';
test('download bundle exposes only the requested Amber baseline and no private data or other system strategies',async()=>{
 const zip=await createAgentKit(),files=new Map();let at=0;
 while(zip.readUInt32LE(at)===0x04034b50){const size=zip.readUInt32LE(at+18),nameLength=zip.readUInt16LE(at+26),extra=zip.readUInt16LE(at+28),name=zip.subarray(at+30,at+30+nameLength).toString(),start=at+30+nameLength+extra;files.set(name,inflateRawSync(zip.subarray(start,start+size)).toString());at=start+size;}
 for(const name of ['PROMPT.md','README.md','CONTESTANT-PROMPT.md','blank-map.json','strategy.js','server/sandbox.mjs','agent-sandbox/arena.mjs','public/core/engine.js','package.json'])assert.ok(files.has('snake-agent-kit/'+name),name);
 assert.ok([...files.keys()].every(name=>!name.includes('system-strategies')&&!name.includes('/data/')&&!name.includes('database')));
 assert.equal(files.get('snake-agent-kit/opponents/amber.js'),await readFile(new URL('../server/system-strategies/05-amber.js',import.meta.url),'utf8'));
 assert.equal([...files.keys()].filter(name=>name.startsWith('snake-agent-kit/opponents/')).length,1);
 const map=JSON.parse(files.get('snake-agent-kit/blank-map.json'));assert.equal(map.width,30);assert.equal(map.maxTurns,500);assert.equal(map.snakes.length,0);assert.equal(map.food.length,0);
 assert.ok(files.get('snake-agent-kit/CONTESTANT-PROMPT.md').includes('16 MiB'));
});
