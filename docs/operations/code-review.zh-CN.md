# T3 Code 代码 Review 指南（中文版）

本指南用于审查 T3 Code 的代码变更：先确定变更涉及哪些边界，再验证正确性、兼容性、性能和测试证据。适用于人工与通用代码评审；专门的自动检查仍遵守各自的检查范围。

这是一份按项目结构组织的评审手册，不是一次全仓库缺陷审计，也不替代现有规范。遇到差异，以当前 [AGENTS.md](../../AGENTS.md)、[贡献政策](../../CONTRIBUTING.md)及对应领域规范为准。本文的严重程度和报告模板是评审建议，不是新增的自动审批规则。

## 1. 理解项目与所有权

T3 Code 是一个多端编码 agent GUI。拥有工作区的环境运行 Node 服务端、provider 进程、终端和 Git；客户端通过经过认证的 RPC 控制它。桌面端虽然捆绑服务端，渲染进程仍是客户端。远程客户端不能用自己机器上的路径、凭证或进程状态替代目标环境的资源。

### 1.1 目录与评审职责

| 目录                                                      | 职责                                                                  | Review 优先关注                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| `apps/server`                                             | WebSocket/HTTP/MCP、领域服务、编排、持久化、provider 集成、checkpoint | 权限、事务、幂等、并发、恢复、资源生命周期           |
| `apps/web`                                                | React/Vite 客户端；公共站点和本地服务使用的 Web UI                    | 入口一致性、权限可用性、状态、交互、渲染成本         |
| `apps/desktop`                                            | Electron 壳、平台集成、IPC、内置服务端启动与更新                      | 主进程边界、跨平台行为、启动顺序、子进程清理         |
| `apps/mobile`                                             | React Native/Expo 客户端及原生模块                                    | 独立导航、前后台恢复、键盘、列表、原生依赖兼容       |
| `apps/marketing`                                          | 对外网站                                                              | 发布内容、页面行为、资源体积；不与核心客户端混为一谈 |
| `packages/contracts`                                      | RPC、Schema 和跨端协议；少量派生辅助逻辑                              | 独立版本兼容、输入输出校验、权限声明、历史解码       |
| `packages/client-runtime`                                 | Web/桌面渲染端/移动端共享的连接、授权、状态与操作                     | 环境隔离、会话替换、订阅、缓存、重连与命令路由       |
| `packages/shared`                                         | 共享运行时工具，按子路径导出                                          | 通用性、依赖方向、无多余 barrel、资源释放            |
| `packages/provider-*`                                     | provider 核心边界、具体实现和测试工具                                 | 协议归一化、能力声明、取消与恢复；部分集成仍在服务端 |
| `packages/effect-acp`、`packages/effect-codex-app-server` | 对应 provider 协议的 Effect 集成                                      | 消息顺序、请求响应关联、流与进程生命周期             |
| `packages/source-control-*`                               | forge/source-control 核心、实现、定义与测试工具                       | 仓库身份、主机与组织范围、CLI/API 兼容、PR 状态      |
| `packages/secret-provider-*`                              | secret provider 定义与实现                                            | 凭证作用域、读取授权、泄漏与持久化边界               |
| `packages/ssh`、`packages/tailscale`                      | 远程连接相关集成                                                      | 目标解析、失败恢复、子进程与连接清理                 |
| `infra/relay`、`infra/task-cache`                         | 中继及任务缓存基础设施                                                | 身份边界、连接路由、部署配置、缓存隔离               |
| `native`                                                  | 资源监控、浏览器 secret、终端及平台截图等原生组件                     | 平台差异、构建产物、崩溃隔离、内存和线程安全         |
| `scripts`、`.github/workflows`                            | 开发、校验、构建、发布与 CI                                           | 实际执行范围、密钥、产物、失败退出和可重复性         |
| `oxlint-plugin-t3code`                                    | 项目静态检查规则                                                      | 报错范围、误报、规则测试和规范一致性                 |
| `evals`                                                   | 真实模型行为评测                                                      | 提示文本与工具行为回归、样本来源、评分和成本         |
| `.repos`                                                  | 只读上游参考                                                          | 可参考，不编辑、不导入                               |
| `docs`                                                    | 用户指南、架构约束、运维流程                                          | 放置位置、事实准确性、是否重复代码或过时约束         |

目录用于确定责任边界，不代表可以仅凭文件夹判断影响范围。共享协议或连接逻辑的一个改动可能同时影响所有客户端。

### 1.2 核心执行链路

按以下顺序追踪一次操作：

1. 客户端入口构造操作，明确目标环境、项目、线程和输入。
2. 共享客户端命令处理可用性、权限及执行时路由。
3. RPC/HTTP/MCP 传输层解码、调用领域服务、映射错误。
4. 编排器串行处理命令，纯粹决定事件，不执行外部 I/O。
5. EventSink 在同一事务中提交事件、持久化投影、命令回执和 outbox 副作用；提交后发布。
6. effect worker 执行 provider、文件系统、checkpoint 等副作用，再以命令反馈结果。
7. 客户端通过快照和事件订阅更新共享状态，UI 展示结果。

**命令已确认表示意图已提交，不表示副作用完成。** provider 回合结束、checkpoint 完成、run finalization 和线程 settlement 也是不同里程碑。Review 必须指出所验证的是哪一个。

阅读入口：[架构概览](../internals/overview.md)、[Orchestrator](../../apps/server/src/orchestration-v2/Orchestrator.ts)、[EventSink](../../apps/server/src/orchestration-v2/EventSink.ts)、[EffectWorker](../../apps/server/src/orchestration-v2/EffectWorker.ts)、[术语表](../internals/glossary.md)。

## 2. 一次 Review 的操作顺序

### 2.1 明确基线与问题

记录比较基线和被审查的提交；区分本次 diff 与工作区已有变更。先读变更目标、复现步骤及期望结果，再看实现。不要默认 `origin` 就是 GitHub，也不要把其他人的未提交文件纳入修复。

确认这是一个问题所需的完整修改，而不是把独立清理、重构和新功能放在一起。外部贡献的可接收范围由 [CONTRIBUTING.md](../../CONTRIBUTING.md) 决定；技术正确不等于贡献一定可接收。团队请求的例外应有对应请求链接。仅审查代码不代表获准关 PR、发评论、推送或合并。

### 2.2 建立影响矩阵

每项写“涉及 / 不涉及及原因 / 未验证”，不要用一个“全部通过”概括。

| 维度     | 应检查的范围                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 入口     | 聊天视图、Settings、命令面板、快捷键、深链接；适用时包括 CLI                                             |
| 客户端   | 公共 Web、本地 Web、桌面渲染端及 Electron 壳、iOS、Android                                               |
| 执行入口 | 用户 RPC、agent MCP、定时任务是否到达同一个服务方法                                                      |
| provider | Codex、Claude、Cursor、Grok、OpenCode、Antigravity、Kiro、Pi、Muse Code、fx、ACP Registry 逐项决定适用性 |
| 连接     | 本地、LAN/远程、relay/tunnel、多设备、多环境                                                             |
| 状态     | 初次加载、正常执行、失败、取消、重试、断线、恢复、旧缓存                                                 |
| 反向操作 | 进入、退出、查看当前状态；例如 snooze/unsnooze、关闭/重开                                                |
| 兼容     | 新旧客户端与服务端组合、历史持久化数据、能力未加载/不支持                                                |

### 2.3 沿调用链审查

优先使用项目知识图谱：`search_graph` 定位符号，`trace_path` 看调用关系，`get_code_snippet` 读实现；复杂关系用 `query_graph`，整体结构用 `get_architecture`。未索引时先 `index_repository`。图谱结果不足或不新鲜时再核对源码；字符串、配置和非代码文件可以用 `rg`。

每个关键修改至少看调用方、实现、错误出口、数据消费者和邻近测试。新增字段还要追踪写入、持久化、投影、编码和读取方。不要仅因某个函数名或单条图谱边就推断实际运行行为。

### 2.4 从高风险到低风险

先查错误环境执行、数据损坏、越权、命令重复与恢复，再查协议和多端遗漏，最后查性能、可维护性和样式。对每个疑点构造具体触发条件，核实已有 guard、上游校验和兼容路径后再报告。

### 2.5 验证并给出结论

运行与改动相关的最小检查，记录命令、结果及未覆盖范围。修复后复查原始触发条件和相邻失败路径。Review 结论应区分“静态阅读未发现问题”“聚焦测试通过”和“真实客户端已验证”，三者不能相互替代。

## 3. 服务端、Effect 与编排

### 3.1 服务和传输边界

- 领域能力放在已有服务的方法上；只有没有合适所有者时才建新服务。
- WebSocket、HTTP、MCP handler 只解码、调用一个服务方法并映射错误。多步骤流程、Git、文件系统、重试和回滚不堆在 handler。
- 检查 MCP、定时任务与 CLI 是否需要同一能力，避免用户入口可用、agent 入口缺失。
- 服务依赖通过 Effect 环境获取，不能藏在全局单例、构造参数或绕过 Layer 的运行时里。
- `ManagedRuntime.make`、`runPromise` 等留在应用或框架边界；领域服务保持可组合、可取消。
- 资源在对应 scope 中获取和释放；检查失败、中断、重连及关闭时的订阅、fiber、进程、文件句柄和锁。

按 [Effect services](../internals/effect-services.md) 核对模块形态、namespace 子路径导入及错误约定。复用操作使用稳定名称的 `Effect.fn("Service.operation")`；高频路径使用 `fnUntraced` 应有原因。保留已有 span 语义，handler 不重复添加组级 instrumentation 已有的 tracing。

### 3.2 事务、幂等与并发

- 编排决策中是否混入 I/O？是否把可能慢或失败的外部操作放进数据库事务？
- 事件、投影、命令回执和 outbox 是否原子提交？订阅者是否可能先看到未提交结果？
- 同一 command id 重发是否只产生一次意图？网络失败后的自动重试会不会重复启动 agent 或执行 Git？
- 异步结果返回时，是否核对 thread/run/attempt 等关联身份，防止旧 run 覆盖新 run？
- 停止、重启、排队、追加输入与后台工作并发时，是否基于服务端权威状态做决定？
- 中断是否可能发生在“状态已写入、清理尚未安排”的间隙？释放操作是否覆盖失败出口？
- 进程丢失后的副作用能否安全重放？不能重放的工作是否在恢复阶段正确终止或退役？

不要用“客户端按钮已经禁用”证明服务端不需要并发或权限保护。自动化、旧客户端和多个设备都可以发起请求。

### 3.3 历史、投影与迁移

当前事件日志会清理旧事件，**不能假设保留了完整历史，也不能假设投影总能从日志重建**。检查点包括：

- Schema 修改是否仍能解码保留事件和旧数据；新旧写入路径是否都正确。
- 迁移是否对空库、实际旧库和异常数据采取明确策略，失败是否保留可恢复状态。
- 回执保留的去重语义是否与事件保留期分离；旧请求重试时事件已清理是否仍正确。
- 游标落入清理范围是否走快照恢复；空闲线程是否被不必要地强制全量刷新。
- 分页读取、查询索引与事务范围是否有界；不能为找候选线程就加载所有完整历史。
- 某线程不在 shell 快照中，可能只是被分页或 family 策略省略，不能直接视为已删除并清理工作区。

### 3.4 checkpoint 与状态完成

checkpoint 使用隐藏 Git ref，不应向用户分支添加提交。回滚既涉及文件系统，也涉及 provider 会话：不支持会话回滚的 provider 应在改文件前拒绝。检查延迟 checkpoint、diff 或 PR 查询是否错误延长 provider 工作时长，或覆盖更新 run 的状态。线程 settlement 由服务端持久化决定，客户端不能用自己的时钟和 PR 缓存重新推导。

## 4. 协议、授权与环境隔离

### 4.1 跨版本协议

以 [contracts RPC](../../packages/contracts/src/rpc.ts) 为边界，检查输入、成功值、失败值、订阅消息和 capability 是否同步更新。类型正确只说明当前源码一致，不能证明旧客户端和历史记录能读。

至少推演：新客户端配旧服务端、新服务端配旧客户端、能力尚未加载、能力明确不支持、旧事件重放。区分字段缺省、空数组、空权限集合和显式 `false`，不能用错误的默认值扩大权限或启用未支持功能。保留有明确兼容职责的旧字段，不因当前客户端不用就删除。

### 4.2 权限链路

- 登录成功不等于每个 RPC 都获授权；服务端方法必须有相应权限检查。
- 客户端 mutation 使用 `createEnvironmentRpcCommand`，受保护方法登记到 `CLIENT_GUARDED_RPC_SCOPES`；UI 用命令的 `permissionAtom` 表达可用性。
- 执行时按实际目标环境重新校验；有重定向的操作不能只检查来源环境。
- 权限拒绝时，是否仍能被旧客户端解码，且不会误显示为断线或未知故障。
- relay/cloud 身份、环境 session、MCP audience、guest link 不能互相替代。
- 配对和 token exchange 可以收窄授权，不能扩大；吊销、过期及无效 DPoP 证明应明确失败。
- secret、token、签名 URL、用户文件和原始工具输出是否进入日志、错误 message、遥测、fixture 或产物。

检查具体路径的授权边界，不因涉及鉴权就要求与本次变更无关的全面重构。参考 [Environment auth](../internals/environment-auth.md) 和 [T3 Connect](../internals/t3-connect.md)。

### 4.3 远程资源归属

路径、cwd、附件、Git 和 provider 凭证必须属于执行环境。切换 Settings 目标后不可静默落回另一环境；目标不可用应显示真实状态。“All environments”是对当前已连接、已加载服务器的显式批量编辑，不意味着未来或离线环境会自动同步。

特别检查相同 project/thread 标识在不同环境中的缓存键、导航参数和操作参数；不能只用显示名称识别目标。附件在工作区之外，提示词中的路径不授予读取权限，不应通过复制到项目来绕过 provider sandbox。

## 5. 共享连接、缓存与订阅

按 [Connection runtime](../internals/connection-runtime.md) 评审，避免客户端分别实现新的重连循环。

- 每个环境有一个连接所有者，transport retry 由 supervisor 负责；endpoint 解析和打开 RPC session 是单次尝试。
- 离线、认证失败、transport 失败、订阅失败和数据未同步分开建模。一个订阅失败不能一律显示“正在重连”。
- HTTP 凭证续期不应无故替换健康 socket；执行请求时解析当前 session，长期订阅跟随 session 替换。
- 重连不代表自动重放 mutation；重试策略和幂等语义属于具体操作。
- 缓存可离线展示，但不能冒充实时数据；慢 HTTP 快照不能覆盖更新的 socket 数据。
- 数据和 replay cursor 一起保存；取消不能先推进 cursor，旧 scope 不能覆盖新 scope 的缓存。
- 区分订阅寿命与缓存寿命；最后消费者退出后释放流，保留策略不能变成永久订阅。
- 显式删除环境要清理其凭证、投影及草稿；临时断线保留注册与缓存。云账号变化不能误删直接配对环境。
- 测试前后台切换、网络改变、旧连接晚到事件、重复挂载消费者以及同时连接多个环境。

## 6. Provider 与外部集成

provider 差异留在 adapter 边界，编排和 UI 消费归一化的命令、事件与能力。不要仅检查自己常用的 provider。

- 对影响到的每个 adapter 明确支持、降级或不支持；capability 必须反映真实能力。
- 流式输出、工具开始/结束、权限请求、用户问题、取消和最终状态是否正确关联且只完成一次。
- 原生 permission/question option id 是否保留；显示标签不能替代 provider 接受的 reply id。
- provider 退出、stderr、无效帧、部分 JSON、重复或迟到事件是否走明确的错误路径。
- 恢复 session 是否使用正确 cwd、模型、配置与历史；不能把“文件可回滚”当成“会话可回滚”。
- 日志过滤是否在昂贵复制、遍历和序列化前发生；超大原生响应是否保持有界处理。
- forge/source-control 变更是否带上正确 host/repository 身份，避免将不同托管服务或仓库的 PR 混在一起。
- 外部进程是否正确引用参数、处理取消和退出码，并释放流和句柄。

参考 [Providers](../internals/providers.md)、[Adding a provider](../internals/adding-a-provider.md)。能力或 provider 列表以当前注册实现为准，不能把本文列表当成静态白名单。

## 7. Web、桌面与移动端

### 7.1 共同行为

检查成功、失败、空数据、加载、断线、无权限与能力不可用时的交互。失败后是否保留用户输入、允许重试并恢复按钮状态；切换线程后迟到结果是否污染新页面。入口之间应调用同一操作，而不是复制业务逻辑。

涉及 UI 时核对键盘焦点、Enter/Escape、快捷键冲突、可访问名称、触摸目标、滚动位置、长文本和主题。删除、关闭、snooze 等操作同时检查反向入口与状态展示。用户可见文本还应检查现有国际化流程，不能只改一个平台的字符串。

### 7.2 Web 与 React

- 控件优先用 `components/ui`；通过 variant/size 扩展外观，不在调用处覆盖基础高度、圆角、颜色和焦点样式。布局放在父元素。
- 与标准控件语义或几何不同的行、tab、resize handle、编辑器表面等可以用原始元素，不能机械判错。
- 样式放在拥有元素的组件中；静态值用 Tailwind，运行时计算才用 inline style；全局 CSS 留给组件类无法表达的场景。
- effect 用于与 React 外部系统同步；派生值在 render 算，用户动作在 handler 做。保留的 effect 按项目规则说明理由并负责清理。
- 所有 Web 组件与 hook 应可被 React Compiler 编译；不新增手工 `useMemo`、`useCallback` 或 `"use memo"` 规避问题。
- 长期挂载的大组件遵守 `useStableCallback` 的出口规则，避免闭包保留旧 render 的大量数据。
- 列表有稳定 identity、合理虚拟化和局部订阅；不能每个 token 都重建全局状态或滚动整页。

细节以 [Web UI](../internals/web-ui.md) 为准。

### 7.3 Electron

分别检查渲染端行为和主进程/IPC 行为。评估来源与参数校验、平台能力暴露、窗口生命周期、更新及协议唤起。平台初始化可能必须早于 Chromium，例如 Linux portal 身份；不能只因函数最终会调用就判断顺序正确。新的原生能力应隔离到有 deadline 的子进程，不能在主进程启动路径直接加载高风险 native module。

### 7.4 React Native

移动端有独立导航与原生模块，不能用桌面截图证明已覆盖。检查前后台恢复、键盘避让、返回手势、安全区域、窄屏和长列表。依赖变动核对 native fingerprint 与开发客户端；缺少客户端按 [移动测试技能](../../.agents/skills/test-t3-mobile/SKILL.md) 安装，不直接认定为无法验证。

持续动画尤其要核对原生提交成本。当前 Reanimated 配置下，重内容旁的长期循环动画存在提交饥饿风险；参考 [性能约束](../internals/performance-regressions.md#mobile-looping-animations)，不要机械套用 Web 动画实现。

## 8. 性能与资源

T3 Code 的性能要求包含网络、数据库、服务端内存、客户端渲染与 GPU，不能只看一个函数运行时间。

| 场景          | 要追问的问题                                                        |
| ------------- | ------------------------------------------------------------------- |
| 打开长线程    | 是否只取有界近期窗口，还是先读完整历史再截断？                      |
| shell/sidebar | 是否混入 transcript body、归档历史或不需要的完整 thread？           |
| 重连          | 是否正确 replay/fallback，是否重复下载已有快照？                    |
| 命令输出      | 是否走独立按需订阅的 output hub，而不是把每个 delta 写成编排事件？  |
| 数据库        | 游标和候选查询是否走索引，JSON 解码与 ancestry 读取是否有界？       |
| React         | 一个 token 或配置刷新是否触发整棵列表更新，是否保留无意义的新对象？ |
| 缓存和队列    | 是否有大小、时间或所有者边界，取消后能否释放？                      |
| 动画          | 空闲时是否仍持续重绘，高刷新显示器和移动端是否受影响？              |
| 日志/遥测     | 是否阻塞事件循环，失败重试和缓冲是否有界，关闭时是否 drain？        |

涉及 projection、paging、shell 同步或 thread 状态时，按 [性能回归规范](../internals/performance-regressions.md) 运行 `vp run test:perf:v2-wire`。不要擅自提高预算来让检查通过；先说明工作负载和增加原因。编码后的 JSON 体积不等于压缩网络流量或进程 RSS，报告中要说清测量口径。

## 9. 测试与证据

### 9.1 选择最低有效层

| 变更                                         | 所需证据                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| 逻辑、状态、数据、协议 bug                   | 先有在基线因同一原因失败的聚焦测试，再有修复后通过的结果                            |
| 后端行为                                     | 服务或更低有效层的聚焦测试；无可见页面时补简短运行 transcript                       |
| 纯视觉问题                                   | 修改前后截图；不为间距、颜色等问题新增 UI 测试                                      |
| 动作、滚动、焦点、真实 worker 或 hook 集成   | 需要时用真实浏览器测试                                                              |
| Web 可复现 bug                               | 按 [Scenarios](./scenarios.md) 用 `vp run scenarios:prove` 证明基线失败、修复通过   |
| 用户可见前端变更                             | 集成完成后用真实客户端走一次涉及流程，并记录哪些端未验证                            |
| 模型可见指令、MCP schema/描述/结果、标题生成 | 阅读 [evals/README](../../evals/README.md)，运行对应评测；模型行为 bug 先加失败样例 |

优先扩展已有 case 或表格，在能捕获回归的最低层测试一次。不要为类型已保证的条件、常量、标签、静态 props、回调接线或 mock 调用镜像补测试。只有能抓住真实回归时才要求缺失测试；也应指出过重、重复或层级不合适的新增测试。

### 9.2 异步测试

等待具体里程碑：`OrchestrationEffectWorkerV2.drain`、持久化事件、回执、`Deferred` 或 `Queue`。队列为空不代表当前任务已结束。禁止靠 sleep、`yieldNow` 轮询、增加单测 timeout 或 retry 把竞态藏起来。

`it.effect` 使用 TestClock，需要显式推进测试时钟；`it.live` 用于子进程/网络 fixture。断言事件和次数，不断言 wall-clock 耗时。浏览器通过 `expect.element` 或 `vi.waitFor` 等断言机制等待，不等待动画帧或 transitionend。

Web 浏览器测试使用 `apps/web/test/render.tsx` 的 `await using screen = await render(...)`，保持资源释放顺序，不使用生命周期 hook 或模块级可变测试状态。详细规则见 [Testing](../internals/testing.md)，不要用本指南代替完整规则。

### 9.3 检查命令与真实客户端

从聚焦测试开始：`vp test run <具体测试文件>`，大文件可加 `-t "<用例名>"`。提交推送前运行 `vp run check:changed`，它按变更选择格式、lint、knip、受影响包及依赖者的 typecheck 和相关测试。类型检查使用项目的 `effect-tsgo tsrs --noEmit` 路径，不另装 TypeScript 来检查。

未经明确要求，不运行全仓检查、递归测试或递归 typecheck。自动检查通过也不能代替验证目标行为；报告实际运行命令与结果，不只写“tests pass”。

真实客户端操作按 [test-t3-app](../../.agents/skills/test-t3-app/SKILL.md) 或 [test-t3-mobile](../../.agents/skills/test-t3-mobile/SKILL.md) 进行。集成负责人在整合后执行一次，不让多个执行者分别起服务。通常使用免费的 Replay (dev)；只有验证依赖真实 provider 时才选其便宜模型。

## 10. 安全的本地验证

- 开发状态用工作区隔离的 `.t3`。`~/.t3/userdata` 是运行中的真实数据，只能读或从只读快照复制，不能启动服务指向它或以读写方式打开数据库。
- 需要数据时用开发 runner 的种子流程或在开发服务停止后运行 `vp run migrate-dev-db`；目标是 `statev2.sqlite`，不是旧 `state.sqlite`。只复制，不 symlink 回生产数据。
- 安装前检查 `.t3/setup-running` 是否仍有活进程；等待现有 setup，不重复安装。
- Dev 使用单一 origin 和 Vite proxy，不设置 `VITE_HTTP_URL`、`VITE_WS_URL`。
- 记录自己启动的进程与真实端口。禁止按名称或路径批量杀进程；只停止自己追踪的任务树或经规则确认的进程。
- 配对 URL、token、secret 和真实用户 fixture 不进入评审证据。使用场景需要的合成或已脱敏数据。

完整启动、共享与清理步骤见 [Development runbook](./development.md)。Review 不需要启动服务时，不为形式上的验证启动它。

## 11. 如何写有效发现

只报告本次变更引入或直接触发的问题。把无法确认的前提列为待核实问题；不要把可能发生的风险写成已确认缺陷，也不要要求顺便修复无关旧代码。

### 11.1 建议的严重程度

| 等级 | 典型影响                                                   | 处理建议                     |
| ---- | ---------------------------------------------------------- | ---------------------------- |
| P0   | 广泛的数据破坏、凭证泄漏或服务无法使用，需立即处理         | 停止相关发布/合并并定位影响  |
| P1   | 可明确触发的越权、错误环境执行、重要数据损坏、主流程不可用 | 修复后再接受变更             |
| P2   | 有具体条件的功能回归、竞态、协议不兼容或明显性能退化       | 按影响决定修复与跟踪         |
| P3   | 范围较小的缺陷或维护问题，有明确依据                       | 简短指出，不夸大影响         |
| 建议 | 风格偏好、可选整理或未经证实的改进                         | 标为非阻塞，通常不留逐行评论 |

级别取决于实际影响、触发频率和恢复成本，不能仅凭出现“auth”“race”或“performance”等词决定。产品默认值变更、新增或扩大静态检查抑制需人工 Review，这是 [.macroscope/approvability.md](../../.macroscope/approvability.md) 的既有要求。

### 11.2 单条发现模板

```text
[P1] 简短说明具体后果
位置：具体文件和最小相关行范围
触发：什么输入、状态、版本或并发顺序会到达这里
原因：本次修改如何突破已有边界；引用实际调用方或消费者
影响：用户会看到什么，数据或运行状态发生什么变化
证据：复现步骤、失败断言或可核实的静态调用链
修复方向：最小的行为修正；不强制无关重构
```

例如：“网络断开后重试创建操作时，此处生成新 command id；第一次请求已提交但响应丢失，因此第二次请求会再次创建资源。”这比“可能有幂等问题”更可操作。该例说明报告方式，不是对当前实现的缺陷断言。

### 11.3 评审结论模板

```text
范围：基线、被审查提交、涉及模块和目标行为
发现：按影响排序的已确认问题；没有就明确写未发现可确认缺陷
验证：实际执行的聚焦测试/检查/客户端流程及观察结果
未覆盖：未验证的平台、provider、版本组合和必要前提
结论：建议接受 / 修复后复查 / 证据不足需继续验证
```

专门的 UI consistency 或 test-signal 自动检查有更窄范围和固定输出要求，执行时读其 [.macroscope 配置](../../.macroscope/check-run-agents/)，不套用通用模板扩大检查职责。没有发现不等于没有风险，应如实保留验证边界。

## 12. 交付前核对

- [ ] 已确定基线、问题与本次修改的边界，没有混入独立需求。
- [ ] 已追踪服务、协议、持久化和消费者，关键疑点已核实上游保护。
- [ ] 入口、客户端、provider、agent 入口、连接模式和反向状态有明确适用性结论。
- [ ] 命令提交与副作用完成分开验证，重试、取消、恢复和迟到结果有依据。
- [ ] 新旧协议及保留数据仍可解码，权限按执行目标环境检查。
- [ ] 热路径的数据量、查询、订阅、日志及资源生命周期保持有界。
- [ ] 测试覆盖真实行为，证据匹配缺陷类型，未运行范围已写明。
- [ ] 相关格式与变更检查完成；没有为通过检查而无理由放宽规则或预算。
- [ ] 文档只更新必要内容：用户操作放 `docs/user`，跨组件约束放 `docs/internals`，维护流程放 `docs/operations`。
- [ ] 若任务包括 PR：遵守模板与贡献政策，UI 证据上传到 PR、不提交截图，说明实际验证并以模型和 harness 收尾；只有明确要求时才创建 PR。

## 参考规范

- [项目协作规则](../../AGENTS.md) · [贡献政策](../../CONTRIBUTING.md) · [PR 模板](../../.github/pull_request_template.md)
- [架构](../internals/overview.md) · [Effect services](../internals/effect-services.md) · [连接运行时](../internals/connection-runtime.md)
- [鉴权](../internals/environment-auth.md) · [远程环境](../internals/remote.md) · [Provider](../internals/providers.md)
- [Web UI](../internals/web-ui.md) · [移动端导航](../internals/mobile-navigation.md) · [性能回归](../internals/performance-regressions.md)
- [测试规则](../internals/testing.md) · [场景证明](./scenarios.md) · [开发流程](./development.md) · [模型评测](../../evals/README.md)
