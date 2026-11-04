# WorkBuddy Bridge

[English](README.md) | [简体中文](README.zh-CN.md)

**Use WorkBuddy as a subagent without leaving your AI assistant.**

Delegate Origin plotting, Blender modeling, and other tasks from your current chat. Ask your main assistant to pass along the relevant context and use the same project folder, then bring WorkBuddy's results back into your main workflow.

**The bridge is free and needs no separate API key.** WorkBuddy's own account limits and any model charges still apply.

## What can you do?

- **Stay in one chat.** Your main assistant delegates tasks and collects the results.
- **Share context and a workspace.** Pass the task brief, decisions, and file paths so WorkBuddy can work with the same local project files.
- **Use WorkBuddy's tools.** Plot in Origin, model in Blender, or use other MCP tools and skills you have configured.

## Get started

Copy this and send it to your AI assistant to install:

> Install WorkBuddy Bridge for me: https://github.com/P-PPPP/workbuddy-bridge

[Manual installation](docs/REFERENCE.md#installation)

## Use it on your current project

Tell your AI assistant:

> Delegate this task to WorkBuddy. Share the relevant context from our conversation and the path to our current project folder. Ask me which model to use first, then save the results in that folder and report back here.

Your assistant chooses what context to send; the full chat history is not synced automatically.

## Example: make a chart in Origin

If Origin MCP is already set up and working in WorkBuddy, ask:

> Have WorkBuddy use Origin MCP to plot the data we are discussing. Pass along the data file paths, labels, and style requirements from this conversation. Ask me which model to use, then save the chart as PNG and PDF in our current project folder.

The Origin workflow was tested with OriginPro 2024 using synthetic sine and cosine data. WorkBuddy created the chart below and exported PNG and PDF files:

![Sine and cosine chart created in Origin through WorkBuddy](docs/images/origin-demo.png)

## Example: make a model in Blender

If Blender MCP is set up in WorkBuddy, try:

> Have WorkBuddy use Blender MCP to create a simple desk organizer. Pass along the dimensions and design requirements we agreed on. Ask me which model to use, then save the .blend file and a preview image in our current project folder and return the file paths here.

The Blender example is a suggested workflow; it has not been tested in this project.

You can also ask:

> Which MCP tools and skills can WorkBuddy use?

> Check the progress of my WorkBuddy task.

> Stop the current WorkBuddy task.

## A few things to know

- **Choose your model.** If you don't, WorkBuddy uses its own default, which may be Auto. Tasks use your WorkBuddy account and normal usage allowance.
- **These are separate task sessions.** They don't take over an existing desktop chat, and you shouldn't expect them to appear in WorkBuddy's chat history.
- **WorkBuddy's tools still need to be installed.** This project connects to your setup; it doesn't install Origin or other applications for you.
- **Keep local data private.** Task messages and results are saved on your computer. Don't upload your `data` folder or account files.

## Need help?

**Your AI app can't connect?** Check that Node.js 24+ is installed and that you copied the generated settings. From the project folder, run `npm run smoke` to check the connection without calling a model.

**WorkBuddy needs you to sign in?** Sign in again in the desktop app, then ask your assistant to start a new task session.

For tool details, custom settings, and troubleshooting, see the [technical reference](docs/REFERENCE.md). You can also [report an issue](https://github.com/P-PPPP/workbuddy-bridge/issues).

Tested with WorkBuddy 5.9.3 on Windows. This is an unofficial project; compatibility may change after WorkBuddy updates.

## License

[MIT](LICENSE). Personal and non-commercial use is encouraged; commercial use remains permitted.
