# 独立 AI 训练场

需要 Node.js 24.4 或更新版本。先执行 `npm install`，安装受限 JavaScript 执行库。
此包只公开一个基础对手“琥珀 · 拾荒”，代码在 `opponents/amber.js`。不包含其他系统选手策略、平台账户、用户策略、排行榜或赛程数据。

请自己编写 `strategy.js`。不填写 `--opponents` 时默认对战琥珀；也可自行准备1～9份对手代码，用逗号分隔传入。
琥珀用于入门测试，不保证在所有配置或种子下都是最弱的；正式比赛有更多对手，建议增加其他测试策略，避免只针对琥珀优化。
策略采用同步 JavaScript ES 模块，导出 `decide(state)`；返回方向字符串或 `{direction}`。
不能导入外部模块，不提供 Node.js、文件、网络、DOM、定时器或系统时间。
每回合执行预算 50 毫秒，每名选手的解释器内存上限 16 MiB，每局重新初始化。
解释器与浏览器性能不同，请使用相同环境比较版本，不修改执行预算或裁判。

```sh
node agent-sandbox/arena.mjs run --strategy strategy.js --map blank-map.json --games 10 --seed CHECK-A --out runs/v1 --replays
node agent-sandbox/arena.mjs inspect --trace runs/v1/trace.jsonl --game 1 --turn 10
node agent-sandbox/arena.mjs serve --strategy strategy.js --seed CHECK-A
```

工具会自动创建父目录。输出目录必须未存在，避免覆盖旧结果。
批量测试局数自动补齐完整出生位置轮换，最大 1000 局；不同组换种子，每组共享初始食物。
自己的 ID 为 1，对手依次为 2～10。结果只用于训练，不能导入正式排行榜。
`trace.jsonl` 每行一回合，含第 0 回合、坐标、动作、得分、死亡原因和最终结果。
动作对应本回合开始前的局面，分析决策时应同时读取前一回合。
`summary.json` 保存逐局成绩与平均积分、平均分数、第一名次数。
`--replays` 生成标准回放 JSON，供本地竞技台查看。

serve 模式从标准输入接收每行一个 JSON 请求：

```json
{"command":"observe","player":1}
{"command":"step"}
{"command":"step","actions":{"1":"down","2":"up"}}
{"command":"run"}
{"command":"reset","seed":"CHECK-B"}
{"command":"close"}
```

手动动作必须覆盖所有存活选手。run 输出每个实际回合，全部死亡时提前结束。
reset 重置局面和策略记忆；修改文件后要重新启动工具，才能加载新代码。
也可导入 `agent-sandbox/environment.mjs` 使用 AgentArena 的 observation、step、record、replay 和 close。
