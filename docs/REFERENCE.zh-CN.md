# 技术参考

[English](REFERENCE.md) | [简体中文](REFERENCE.zh-CN.md)

安装及日常使用请看[项目首页](../README.zh-CN.md)。

## 工作原理与能力边界

```text
其他 AI 智能体 / MCP 客户端
             |
             | stdio MCP
             v
WorkBuddy Bridge
  七个工具 + 任务/会话管理 + SQLite 事件记录
             |
             | 原生工作进程管道中的 ACP JSON-RPC
             v
已安装的 WorkBuddy 原生工作进程
             |
             +--> 使用当前已登录账户调用所选模型
             +--> 调用本机已配置并选中的 MCP 服务
             +--> 加载选中的 SKILL.md 指令
```

不需要 WinUI、鼠标键盘模拟、屏幕识别，也不会修改已安装的 WorkBuddy 文件。由 MCP 客户端启动此服务，无需注册 Windows 服务。对外提供的是 stdio MCP，不是开放的 HTTP 远程控制接口。

### 请先理解这些限制

- 创建的是**本服务管理的专用原生 ACP 会话**，不接管桌面应用中已有的聊天。
- API 返回的 `session_id` 是本地工作进程的会话标识；WorkBuddy 的原生 ACP 会话标识是另一个值，保存在本地记录中。二者都不应直接当作已验证的桌面聊天历史 ID。
- 工作进程以 `--no-session-persistence` 启动。不要假定这些会话会出现在桌面侧栏、自动同步到聊天历史，或能作为普通桌面聊天恢复。
- 服务重启后，旧工作进程会话失效；已经记录的公开消息仍可读取，但未确认结果的任务标为 `unknown`，不会自动重发。
- 当前只支持文本输入；尚未实现附件、任意桌面聊天历史访问、远程 HTTP MCP、原生插件热加载等能力。

## 安装

需要准备：

1. Windows，以及合法安装的 WorkBuddy 桌面应用。
2. 在启动本服务的同一个 Windows 用户下，登录自己的 WorkBuddy 账户。
3. [Node.js](https://nodejs.org/) **24 或更高版本**，以及 Git。
4. 支持启动本地 stdio 服务的 MCP 客户端。

在 PowerShell 中执行：

```powershell
git clone https://github.com/P-PPPP/workbuddy-bridge.git
Set-Location workbuddy-bridge
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run smoke
```

单元测试和 smoke 测试不会调用模型，不需要 WorkBuddy 正在运行。实际执行任务时，才需要应用安装文件及有效的桌面登录状态。

项目目前通过 GitHub 分发，**没有发布到 npm**。请使用本地仓库，不要假定可以直接运行 `npx workbuddy-bridge`。

## 连接其他 MCP 客户端

生成适用于你自己电脑的绝对路径配置：

```powershell
node scripts/print-config.mjs --out mcp-client-config.local.json
```

把生成文件中的 `workbuddy-bridge` 条目合并到 MCP 客户端的设置中，保留已有服务，然后重启或重新连接客户端。正常情况下会发现 7 个工具。

如果之前配置过 `workbuddy-local-worker`，请用生成的 `workbuddy-bridge` 条目替换旧条目，不要同时保留两个。只要文件路径仍然有效，原配置依然可用；七个工具的名称和 `WORKBUDDY_LISTENER_*` 设置保持不变。

等价配置示例，请替换为实际安装位置：

```json
{
  "mcpServers": {
    "workbuddy-bridge": {
      "command":"node",
      "args":["C:/tools/workbuddy-bridge/src/server.mjs"]
    }
  }
}
```

不要再将本服务作为其自身工作进程选中的 MCP 服务，否则会形成递归调用。

也可以通过 `npm start` 或 `start-worker.cmd` 启动 stdio 入口。手动运行后等待输入是正常现象：它需要 MCP 客户端，不是交互式聊天终端。标准输出专用于 MCP 协议消息。

## 首次对话与模型选择

**发送可能消耗账户额度的任务前，应先明确模型选择。** 服务不会推断用户偏好。如果不主动选模型，原生运行时会使用自己的默认配置；在已验证安装中，该配置为 `auto`。Auto 可能把不同请求路由到不同的实际模型。

推荐流程：

1. 调用 `get_status`，参数为 `{}`，查看服务状态与 MCP/技能列表；此操作不发送模型请求。
2. 如需指定 MCP 或技能，先设置新会话默认选择。
3. 调用 `select_model`，参数为 `{}`，创建空闲原生会话并查询实际可用模型。保存返回的 `session_id`。这会加载本机账户和原生会话，但不提交提示词。
4. 请用户从可用模型中选择，再对同一个会话调用：

```json
{"session_id":"<返回的 session_id>","model_id":"<用户选择的实际模型 ID>"}
```

5. 将消息发到**同一个会话**：

```json
{
  "session_id":"<返回的 session_id>",
  "message":"请只回复 HELLO_WORKBUDDY，不要使用工具。",
  "request_id":"hello-example-001"
}
```

`send_message` 立即返回 `task_id`、`session_id` 和状态。随后用 `wait_for_message` 获取进展：

```json
{"task_id":"<返回的 task_id>","after_cursor":"0","timeout_seconds":30}
```

继续使用返回的 `next_cursor` 等待，直到任务结束或需要用户输入。如果 `has_more` 为 true，可用 `get_message` 读完剩余事件。任务结束时包含累计回复 `answer`。

继续对话时沿用同一个 `session_id`。不传 `session_id` 会创建新会话，并使用新工作进程的原生默认模型；其他会话中的模型选择不会自动继承。

## 七个工具的接口说明

工具将结构化 JSON 放入 `structuredContent`，同时提供 JSON 文本以兼容不同客户端。错误会设置 MCP `isError`，并返回 `error.code` 和 `error.message`。

### 1. `send_message`

提交新任务、继续空闲会话，或回答具体的权限/交互请求。

| 参数 | 说明 |
| --- | --- |
| `message` | 普通消息必须提供的文本，最多 500,000 字符。 |
| `session_id` | 已有本地会话标识；不传则创建新会话。 |
| `request_id` | 可选幂等键，最多 256 字符。 |
| `cwd` | 新会话工作目录；省略时使用配置的默认目录，不会改变已有会话目录。 |
| `reply_to_interruption_id` | 待回答的权限或交互请求 ID。 |
| `permission_option_id` | 原生请求给出的准确权限选项 ID。 |
| `elicitation_action` | `accept`、`decline` 或 `cancel`。 |
| `elicitation_content` | 支持的交互问题所需的结构化回答。 |

每个会话同时只允许一个活跃轮次；并发提交返回 `SESSION_BUSY`。不同会话可以独立运行。

相同 `request_id` 搭配相同消息、会话和工作目录会返回原任务；用相同 ID 提交不同内容会得到 `REQUEST_ID_CONFLICT`。任务结果为 `unknown` 时，不要简单换一个 ID 盲目重试，应先检查已经产生的外部效果。

### 2. `get_message`

立即读取已经记录的事件，不等待新消息。

| 参数 | 默认值 / 范围 |
| --- | --- |
| `task_id` | 必填。 |
| `after_cursor` | `"0"`；非负整数字符串。 |
| `limit` | 默认 100，范围 1–500。 |
| `include_partial` | 默认 true；false 隐藏流式文本增量。 |

返回事件、`next_cursor`、`has_more`、任务状态；结束任务还包含 `answer`。事件区分用户消息、公开回复增量/最终消息、工具活动、状态变化和交互请求。不会收集私有推理文本。

### 3. `select_model`

不传 `model_id` 时列出原生会话实际可用模型；提供准确 ID 时，通过 `session/set_model` 切换并等待原生确认。不传 `session_id` 时创建空闲会话。

模型配置只能在会话空闲时查询或变更。可用性取决于当前账户和运行时，不应把历史示例或显示名称当作固定模型 ID。任务的 `get_status` 会区分 `selected_model` 与原生元数据提供的实际 `response_model`。

### 4. `wait_for_message`

参数与 `get_message` 相同，并增加 `timeout_seconds`，默认 30 秒、范围 0–60 秒。

等待新的可见事件、任务结束、待回答输入或超时，额外返回 `timed_out`。**超时不会停止任务**。已经结束的任务会立即返回。

### 5. `get_status`

- `{}`：查看服务就绪状态、管理中的会话、默认选择和 MCP/技能列表。
- `{"session_id":"..."}`：查看连接状态、活跃任务、所选模型和配置。
- `{"task_id":"..."}`：查看任务状态、所选/实际模型、活动阶段、待回答输入和取消信息。

`ready` 仅表示 MCP 服务已经就绪，不代表账户仍然有效或模型调用一定成功。账户与模型权限会在原生执行时得到实际验证。

状态包括 `starting`、`running`、`waiting_for_user`、`cancelling`、`completed`、`cancelled`、`failed`、`unknown`。工作进程已连接不等于任务正在执行；没有新消息也不等于任务已完成。

### 6. `stop_task`

```json
{"task_id":"<task_id>","force":false}
```

请求原生取消，在确认结果前可能返回 `cancelling`。服务会重试取消以覆盖原生提示词刚启动时的时序问题。重复停止已结束任务是安全的。

`force:true` 可能在短暂等待后终止本服务拥有的工作进程及其子进程树，并通过 `forced_worker_termination:true` 与原生确认取消相区分。不会按应用名称终止用户的桌面 WorkBuddy。强制终止的会话不可继续。

停止不能回滚已完成的工具操作，也不能保证取消独立分离出去的后台作业。

### 7. `select_mcp_or_skills`

不传选择字段时列出已配置名称。设置**新会话**的默认选择，例如：

```json
{"mcp_servers":["origin"],"skills":[]}
```

`origin` 只是示例，需要预先存在于本机配置中。空数组明确禁用该类别；省略字段保留原选择。

忙碌会话不能变更配置。工作进程启动后，MCP/技能选择固定；修改会得到 `SESSION_ALREADY_STARTED`。请先设置默认选择，再创建新会话。

## 选择 MCP 服务和技能

MCP 服务从 `%USERPROFILE%\.workbuddy\mcp.json` 读取，并与可选的项目本地 `listener.config.json` 合并。同名本地条目只覆盖专用工作进程中的配置，不修改桌面全局设置。

需要覆盖时可先复制空示例：

```powershell
Copy-Item listener.config.example.json listener.config.json
```

以下是需修改绝对路径的本地配置示例：

```json
{
  "mcpServers": {
    "local-echo": {
      "type":"stdio",
      "command":"node",
      "args":["C:/tools/workbuddy-bridge/test/fixtures/echo-server.mjs"]
    }
  },
  "skills": {
    "echo-check":"./test/fixtures/sentinel-skill/SKILL.md"
  }
}
```

原生工作进程通过严格 MCP 配置加载所选服务。显式选择桌面配置中已禁用的条目，会在该专用工作进程中启用它。选择不会安装软件，也不保证第三方服务健康；它可能还需要自己的应用、账户、桥接器与权限。

技能来自用户 `.workbuddy/skills/<name>/SKILL.md`、已安装的 WorkBuddy 内置技能目录，以及本地显式映射。相对路径按配置文件目录解析，单个技能文件不超过 256 KB。

**技能激活方式是指令注入**：读取所选 `SKILL.md`，连同其来源目录追加到系统提示词。它不等于原生插件安装、热重载，或自动打包被引用的文件。相关资源保留原路径；脚本和外部工具仍遵循正常权限流程。

## 权限请求与交互问题

服务不会自动批准原生工具权限请求。任务需要决定时会进入 `waiting_for_user`。调用该任务的 `get_status`，检查 `pending_input` 中的工具、参数和可选答案。

对于 `session/request_permission`，仅批准用户已经授权的具体操作，然后调用 `send_message`：

```json
{
  "session_id":"<session_id>",
  "reply_to_interruption_id":"<pending_input.id>",
  "permission_option_id":"<请求给出的准确 optionId>"
}
```

不要自行编造权限 ID，也不要把某项任务的授权当作对无关操作的无限授权；适当时优先使用一次性权限。

`elicitation/create` 支持 `elicitation_action` 和可选的结构化 `elicitation_content`。其他交互方法会返回 `INTERACTION_UNSUPPORTED`。拒绝权限可能导致整个轮次被原生运行时取消，不能假定只会跳过某个工具。

## 配置项

环境变量在服务启动时读取。为兼容早期原型，保留 `WORKBUDDY_LISTENER_*` 命名。

| 环境变量 | 默认值 / 作用 |
| --- | --- |
| `WORKBUDDY_INSTALL_DIR` | `%USERPROFILE%/AppData/Local/Programs/WorkBuddy`，应用安装目录。 |
| `WORKBUDDY_LISTENER_DATA` | `<仓库>/data`，状态记录与隔离工作进程配置。 |
| `WORKBUDDY_LISTENER_WORKSPACE` | `<data>/workspace`，默认任务工作目录。 |
| `WORKBUDDY_LISTENER_CONFIG` | `<仓库>/listener.config.json`，可选本地覆盖配置。 |
| `WORKBUDDY_HOME` | `%USERPROFILE%/.workbuddy`，桌面 MCP/技能配置根目录。 |
| `WORKBUDDY_AUTH_FILE` | `%LOCALAPPDATA%/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info`，自己账户的桌面登录文件。 |
| `WORKBUDDY_LISTENER_TASK_TIMEOUT_MS` | 1,800,000 毫秒，即原生提示词等待上限 30 分钟。 |

不同客户端实例应配置不同的 `WORKBUDDY_LISTENER_DATA`。不支持多个服务同时操作同一个记录库。移动仓库或清除本地状态前，请先停止客户端。

## 状态记录、会话标识与隐私

`data/journal.sqlite` 保存提示词、公开回复、工具输出、任务、会话元数据、请求 ID 和默认选择。工作进程配置在 `data/workers/<本地会话 ID>/`，其中可能包含已选 MCP 配置与技能文本。用户提供的 MCP 配置本身可能带有凭据，因此整个目录都应作为私有数据保管。

认证在**已安装的 WorkBuddy 原生进程内部**加载。预加载模块使用私有原生存储接口读取受支持的加密凭据，并在原生进程内存中设置认证；父 MCP 服务不接收访问令牌，客户端 MCP JSON 也无需填写令牌。

原生子进程环境会移除继承来的自定义模型提供商凭据、接口覆盖和 Node 预加载参数，使用已安装 WorkBuddy 的产品配置进行路由，同时保留已有代理环境变量。本项目不内置账户凭据，不绕过订阅权益和额度限制。

凭据键名及 Bearer 值过滤只是有限的防御措施，**不等于完整秘密扫描**。任意提示词、嵌套 JSON 字符串及第三方工具输出仍可能包含敏感信息。分享日志前务必检查；不要强制把被忽略的本地数据加入 Git。

## 测试与实际验证

不调用模型的检查：

```powershell
npm test
npm run smoke
```

单元测试使用模拟 ACP 工作进程，覆盖幂等性、Unicode/游标、等待超时、流式与最终事件、取消重试、环境隔离、断开与重启、模型校验、配置约束和结构化权限回复。smoke 测试通过真实 MCP 客户端验证项目名、七个工具及跨目录启动，不启动原生工作进程。

### 可选的真实集成测试

真实测试会调用模型并消耗正常账户额度，**不会在 CI 自动执行**。请先自行选择两个不同、实际可用的模型 ID：

```powershell
$env:WORKBUDDY_LIVE_TESTS='1'
$env:WORKBUDDY_TEST_MODEL='<第一个实际可用模型 ID>'
$env:WORKBUDDY_TEST_SECOND_MODEL='<另一个不同的模型 ID>'
npm run test:live
```

测试使用隔离配置和数据目录，验证简短回复、模型切换、无害 echo MCP 与技能标记，并取消一个生成中的回复。只会为匹配的 echo 测试操作选择一次性许可。报告写入被 Git 忽略的 `test-results/`。

早期原型于 2026 年 11 月 4 日通过 13 项单元测试和 12 项真实集成检查。另一次测试通过已安装的 Origin MCP 成功让 WorkBuddy 创建并导出 Origin 原生图形。公开版本的验证范围和已发现问题见 [docs/VALIDATION.md](VALIDATION.md)。这些是有日期的实测结果，不保证任意模型、账户或软件版本都完全一致。

## 故障排查

| 现象 | 检查方式 |
| --- | --- |
| MCP 客户端无法启动 | 使用脚本生成的绝对路径；确认 Node 24+ 和依赖已安装；运行 `npm run smoke`。 |
| 手动运行后一直等待 | stdio 服务在等待 MCP 客户端输入，并非聊天终端。 |
| `WORKER_START_FAILED` / 工作进程立即退出 | 检查安装目录与兼容版本；不要直接公开可能涉及账户数据的原始诊断输出。 |
| 认证缺失或被拒绝 | 在同一 Windows 用户下重新登录 WorkBuddy，然后新建会话；私有接口变化可能需要更新适配器。 |
| `MODEL_NOT_AVAILABLE` | 重新查询原生可用 ID，避免使用显示名称或过期示例。 |
| `SESSION_BUSY` | 先等待或停止活跃任务，再提交消息或变更配置。 |
| `SESSION_EXPIRED` | 新建会话；旧的公开回复仍可从记录中读取。 |
| `waiting_for_user` | 检查具体权限/问题，再用 `send_message` 结构化回答。 |
| MCP 或技能未找到 | 检查实际名称、安装位置和当前配置文件路径。 |
| 第三方 MCP 执行失败 | 检查它自己的应用、桥接器、权限和真实工具参数；选中不等于已验证健康。 |
| 任务为 `unknown` | 断开、重启或超时使结果无法确认；先检查外部效果再重试。 |
| 文件已生成但状态为 `cancelled` | 同时保留两个事实；核验文件，必要时使用独立会话读回，不要把取消状态改写为完成。 |

## 开发与许可证

```text
src/server.mjs       七个 MCP 工具和 stdio 入口
src/controller.mjs   任务与会话生命周期
src/acp.mjs          原生进程与 ACP 协议
src/worker-auth.cjs  原生进程内的桌面认证预加载模块
src/journal.mjs      SQLite 事件与状态记录
src/catalog.mjs      已配置 MCP 和技能选择
scripts/            配置生成及不调用模型的 smoke 测试
test/               单元/真实测试与无害测试组件
docs/               兼容性和验证记录
```

Windows GitHub Actions 只执行依赖安装、单元测试和不调用模型的 smoke 测试，不需要桌面账户或任何 WorkBuddy 凭据。

贡献时请保留七个工具、准确的原生状态、明确的权限边界，以及公开代码与本地私有数据的隔离。参见 [CONTRIBUTING.md](../CONTRIBUTING.md)、[SECURITY.md](../SECURITY.md) 和 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

项目代码使用 [MIT 许可证](../LICENSE)。非商业使用是自愿倡议，不覆盖 MIT 允许商业使用的权利。WorkBuddy、模型服务和第三方 MCP 各自适用其许可证与服务条款；本仓库不分发这些产品，也不授予它们的使用权益。
