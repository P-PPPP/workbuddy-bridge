# Workbuddy Local Worker

[English](README.md) | [简体中文](README.zh-CN.md)

**让你正在使用的 AI 助手，也能调用 WorkBuddy。**

在当前聊天里，把任务交给 WorkBuddy，再收回结果。你可以使用 WorkBuddy 中已有的模型、MCP 工具和技能，不必切换应用。

## 可以用它做什么？

- 让 WorkBuddy 处理任务，结果直接回到你常用的 AI 助手中。
- 调用 WorkBuddy 里已配置的工具，例如用 Origin 绘图。
- 选择模型、查看进度、获取结果，或者停止任务。

## 开始使用

你需要一台 **Windows 电脑**、已安装并登录的 WorkBuddy、[Node.js 24 或更高版本](https://nodejs.org/)，以及 Git。你使用的 AI 应用需要支持添加 MCP 服务。

### 1. 下载并安装

在你想存放项目的文件夹中打开 PowerShell，执行：

```powershell
git clone https://github.com/P-PPPP/workbuddy-local-worker.git
cd workbuddy-local-worker
npm ci --ignore-scripts --no-audit --no-fund
```

### 2. 连接你的 AI 应用

执行下面的命令，生成适用于这台电脑的连接配置：

```powershell
node scripts/print-config.mjs
```

把输出中的 `workbuddy-local-worker` 条目添加到 AI 应用的 MCP 设置里，保留已有的其他条目，然后重启应用或重新连接。

无需复制 WorkBuddy 的登录令牌，也不用另外启动后台服务。

### 3. 在聊天中试一试

先对你的 AI 助手说：

> 连接 Workbuddy Local Worker，列出 WorkBuddy 可用的模型。开始任务前，先问我要用哪个模型。

选好模型后，再试试：

> 请让 WorkBuddy 回复“你好，WorkBuddy”。

你的 AI 助手会发送任务，并把 WorkBuddy 的回复带回当前聊天。

## 示例：用 Origin 画图

如果 WorkBuddy 中已经配置好 Origin MCP，并且可以正常使用，你可以说：

> 通过 WorkBuddy 的 Origin MCP 绘制正弦和余弦曲线。先问我要用哪个模型、保存到哪个文件夹，然后将图导出为 PNG 和 PDF。

这个流程已用 OriginPro 2024 测试。下面是 WorkBuddy 实际生成并导出的图：

![通过 WorkBuddy 调用 Origin 生成的正弦和余弦曲线](docs/images/origin-demo.png)

你也可以说：

> WorkBuddy 现在有哪些可用的 MCP 工具和技能？

> 查看我的 WorkBuddy 任务进度。

> 停止当前的 WorkBuddy 任务。

## 使用前了解这几件事

- **先选模型。** 如果没有指定，WorkBuddy 会使用自己的默认选项，可能是 Auto。任务使用你的 WorkBuddy 账户，并消耗相应额度。
- **任务使用独立会话。** 不会接管桌面应用中已有的聊天，也不要期待这些任务出现在 WorkBuddy 的聊天历史中。
- **需要先配置好工具。** 本项目连接你已有的 WorkBuddy 环境，不会替你安装 Origin 或其他应用。
- **保护本地记录。** 任务消息和结果保存在你的电脑上，请勿上传 `data` 文件夹或账户文件。

## 遇到问题？

**AI 应用连接不上？** 确认已安装 Node.js 24 或更高版本，并已复制生成的配置。也可以在项目目录中执行 `npm run smoke`，检查连接；这不会调用模型。

**提示需要登录 WorkBuddy？** 在桌面应用中重新登录，然后让 AI 助手新建一个任务会话。

工具用法、更多设置及故障排查见[技术参考](docs/REFERENCE.zh-CN.md)。你也可以[提交问题](https://github.com/P-PPPP/workbuddy-local-worker/issues)。

已在 Windows 上的 WorkBuddy 5.9.3 测试。这是非官方项目，WorkBuddy 更新后可能需要适配。

## 许可证

[MIT](LICENSE)。鼓励个人及非商业用途，商业使用仍被允许。
