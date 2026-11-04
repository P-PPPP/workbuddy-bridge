# WorkBuddy Bridge

[English](README.md) | [简体中文](README.zh-CN.md)

**不离开当前 AI 助手，让 WorkBuddy 成为你的子智能体。**

在当前聊天里，把 Origin 绘图、Blender 建模等任务交给 WorkBuddy。让主 AI 助手传递相关上下文，并使用同一个项目文件夹，再将结果带回主工作流程。

**桥接工具免费，无需另外配置 API Key。** WorkBuddy 账户本身的额度限制及可能产生的模型费用仍然适用。

## 可以用它做什么？

- **始终留在当前聊天。** 主 AI 助手负责分派任务，并收回结果。
- **共享上下文与工作目录。** 传递任务说明、已确定的要求和文件路径，让 WorkBuddy 使用同一份本地项目文件。
- **使用 WorkBuddy 已有的工具。** 用 Origin 绘图、Blender 建模，或调用你已配置的其他 MCP 工具和技能。

## 开始使用

复制下面这句话，发给你的 AI 助手即可安装：

> 帮我安装 WorkBuddy Bridge：https://github.com/P-PPPP/workbuddy-bridge

[手动安装](docs/REFERENCE.zh-CN.md#安装)

## 用在当前项目中

对你的 AI 助手说：

> 把这个任务交给 WorkBuddy，传递我们对话中相关的上下文，以及当前项目文件夹的路径。先问我要用哪个模型，然后把结果保存到这个文件夹，并在这里向我汇报。

主 AI 助手决定传递哪些上下文，不会自动同步完整聊天历史。

## 示例：用 Origin 画图

如果 WorkBuddy 中已经配置好 Origin MCP，并且可以正常使用，你可以说：

> 让 WorkBuddy 通过 Origin MCP 绘制我们正在讨论的数据。把数据文件路径、坐标轴标签和对话中确定的样式要求一起传过去。先问我要用哪个模型，然后把 PNG 和 PDF 保存到当前项目文件夹。

Origin 绘图流程已用 OriginPro 2024 和模拟的正弦、余弦数据测试。下面是 WorkBuddy 实际生成并导出为 PNG 和 PDF 的图：

![通过 WorkBuddy 调用 Origin 生成的正弦和余弦曲线](docs/images/origin-demo.png)

## 示例：用 Blender 建模

如果 WorkBuddy 中已配置 Blender MCP，可以试试：

> 让 WorkBuddy 通过 Blender MCP 制作一个简单的桌面收纳盒。把我们确定的尺寸和设计要求一起传过去。先问我要用哪个模型，然后将 .blend 文件和预览图保存到当前项目文件夹，并在这里返回文件路径。

Blender 示例是建议用法，本项目尚未实际测试这个流程。

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

工具用法、更多设置及故障排查见[技术参考](docs/REFERENCE.zh-CN.md)。你也可以[提交问题](https://github.com/P-PPPP/workbuddy-bridge/issues)。

已在 Windows 上的 WorkBuddy 5.9.3 测试。这是非官方项目，WorkBuddy 更新后可能需要适配。

## 许可证

[MIT](LICENSE)。鼓励个人及非商业用途，商业使用仍被允许。
