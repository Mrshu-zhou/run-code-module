# 运行代码模块（run-code-module）

《网页上运行代码》运行链路的最小可运行实现，对应 W8 规格、W9 设计与契约卡、W10 测试用例卡与提交计划。

## 五个模块

| 模块 | 目录 | 职责 |
| --- | --- | --- |
| M1 编辑与呈现 | `src/editor/presenter.js` | 输出区、按钮态、错误行高亮 |
| M2 执行调度 | `src/scheduler/orchestrator.js` | 受理、运行号、编排、结果回传 |
| M3 沙箱执行 | `src/sandbox/runner.js` | 执行、采集、结束帧（Worker 强杀待补） |
| M4 输出处理 | `src/output/shaper.js` | 51200 字节截断、多字节回退、转义 |
| M5 会话与并发控制 | `src/session/admission.js` | 准入、单会话互斥、额度释放 |

## 跑测试

```bash
npm install
npm test
# 或 ./run-tests.cmd（Windows）/ ./run-tests（bash）
```

当前已落 14 条用例：TC-01/02/03、TC-06/07/08、TC-09/10/11、TC-17/24、TC-21/22/23。

## 已知边界

- M3 当前用 `new Function` + 参数遮蔽做最小执行，**不是真正的浏览器隔离**；Worker 隔离、10s 强杀、内存上限在下一批实现。
- 单元测试中的超时与并发用替身（`tests/helpers/fake-sandbox.js`）回放帧，不真等 10 秒。
- 其余 13 条用例与 8 项课后补按 W10 测试计划表推进。

## 文档

详见 `docs/README.md` 的上游文档索引。
