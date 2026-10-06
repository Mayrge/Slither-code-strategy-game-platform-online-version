import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { contestantPrompt } from '../public/core/contestant-prompt.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const files = [], central = []; let offset = 0;
  for (const [path, data] of entries) {
    const name = Buffer.from('snake-agent-kit/' + path), content = Buffer.isBuffer(data) ? data : Buffer.from(data), packed = deflateRawSync(content);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc32(content), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc32(content), 16); record.writeUInt32LE(packed.length, 20); record.writeUInt32LE(content.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    files.push(header, name, packed); central.push(record, name); offset += header.length + name.length + packed.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, index, end]);
}
export function agentPrompt() {
  return '# AI 策略迭代任务\n\n你的目标是获得尽可能高的分数和名次。先阅读README.md、RULES.md、CONTESTANT-PROMPT.md。\n\n1. 在strategy.js实现同步JavaScript策略，默认导出decide(state)。\n2. 从资料包内置的琥珀·拾荒对手开始测试；可自行增加其他对手代码，其他系统选手策略不提供。\n3. npm install后按README运行10局，读取summary.json和trace.jsonl。\n4. 检查死亡回合及前一回合，修改策略，用相同种子和对手比较，再更换种子验证。\n5. 最终至少测试50局，交付strategy.js及REPORT.md，记录种子、对手、平均分数和平均积分。\n\n不得修改裁判、执行预算或计分规则来提高成绩。策略不依赖Node、DOM、网络或外部库。每轮50毫秒，解释器内存16MiB。训练结果不计入正式榜单。所有实际回合可以查询，也可用serve接口单步推进。\n';
}
export async function createAgentKit() {
  const paths=['agent-sandbox/arena.mjs','agent-sandbox/environment.mjs','server/sandbox.mjs','public/core/engine.js','public/core/replay.js','public/core/tournament.js','RULES.md'];
  const entries=await Promise.all(paths.map(async path=>[path,await readFile(resolve(repository,path))]));
  entries.push(['opponents/amber.js',await readFile(resolve(repository,'server/system-strategies/05-amber.js'))],['README.md',await readFile(resolve(repository,'agent-sandbox/README.md'))],['PROMPT.md',agentPrompt()],['CONTESTANT-PROMPT.md',contestantPrompt(60)+'\n仅支持同步策略，不能导入外部模块、访问文件或网络。'],['blank-map.json',await readFile(resolve(repository,'agent-sandbox/blank-map.json'))],['strategy.js','export default function decide(state) {\n  // 请在这里实现你的策略\n  const you = state.snakes.find(s => s.id === state.you);\n  return { direction: you.direction };\n}\n'],['package.json',JSON.stringify({name:'snake-agent-kit',private:true,type:'module',engines:{node:'>=24.4'},dependencies:{'quickjs-emscripten':'0.31.0'}},null,2)]);
  return zip(entries);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const output=resolve(repository,'exports/snake-agent-kit.zip');await mkdir(dirname(output),{recursive:true});await writeFile(output,await createAgentKit());console.log(output);
}
