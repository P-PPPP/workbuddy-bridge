# Technical reference

[English](REFERENCE.md) | [简体中文](REFERENCE.zh-CN.md)

For setup and everyday use, see the [README](../README.md).

## What it controls

```text
Your AI agent / MCP client
         |
         | MCP over stdin/stdout
         v
WorkBuddy Bridge
  seven tools + task/session state + SQLite event journal
         |
         | ACP JSON-RPC through native worker pipes
         v
Installed WorkBuddy native worker
         |
         +--> selected model using your signed-in WorkBuddy account
         +--> selected MCP servers already configured on your computer
         +--> selected SKILL.md instructions
```

No WinUI, mouse/keyboard automation, screen scraping, or modifications to the installed application are required. The MCP client launches the server; it is not a Windows service. The public MCP transport is stdio, not an unauthenticated HTTP listener.

### Important scope limits

- Conversations are **dedicated listener-owned native ACP sessions**. This does not attach to a conversation already open in the desktop app.
- The API's `session_id` is a local worker identifier. WorkBuddy's native ACP session ID is a separate value recorded in the local journal; neither should be assumed to be a verified desktop-history chat ID.
- Workers are launched with `--no-session-persistence`. Do not expect a normal resumable desktop chat entry or desktop sidebar synchronization.
- After server restart, old worker sessions expire. Public messages remain in the journal, but unfinished outcomes become `unknown`. Work is not automatically replayed.
- Current message input is text. Attachments, arbitrary desktop-history access, remote HTTP control, and native plugin hot reload are not implemented.

## Installation

Requirements:

1. Windows and an installed, licensed WorkBuddy desktop application.
2. WorkBuddy signed in under the same Windows account that launches this server.
3. [Node.js](https://nodejs.org/) **24 or later** and Git.
4. An MCP client that can launch a local stdio server.

Clone and install in PowerShell:

```powershell
git clone https://github.com/P-PPPP/workbuddy-bridge.git
Set-Location workbuddy-bridge
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run smoke
```

The unit and smoke tests do not invoke a model. WorkBuddy does not need to be running for them. Runtime use requires its installed files and a valid desktop sign-in.

This repository is distributed through GitHub; it is not published as an npm package. Use a local checkout rather than assuming `npx workbuddy-bridge` is available.

## Connect an MCP client

Generate a configuration containing the absolute paths for **your** checkout and Node executable:

```powershell
node scripts/print-config.mjs --out mcp-client-config.local.json
```

Merge its `workbuddy-bridge` entry into your client's MCP server settings, preserving existing servers. Restart or reconnect the client. It should discover exactly seven tools.

If you previously configured `workbuddy-local-worker`, replace that entry with the generated `workbuddy-bridge` entry rather than keeping both. Existing entries still work if their file paths remain valid; the seven tool names and `WORKBUDDY_LISTENER_*` settings are unchanged.

Equivalent example, with an installation path you must adapt:

```json
{
  "mcpServers": {
    "workbuddy-bridge": {
      "command": "node",
      "args": ["C:/tools/workbuddy-bridge/src/server.mjs"]
    }
  }
}
```

Do not configure this worker to load itself as one of WorkBuddy's selected MCP servers. That would create recursive delegation.

`npm start` or `start-worker.cmd` also starts the stdio entry point. Running it manually waits for MCP input; it does not open an interactive chat console. stdout is reserved for MCP messages.

## First conversation and model choice

**Decide which model to use before sending a billable task.** The server does not infer a user preference. If no explicit model is selected, the native runtime supplies its own default, observed as `auto` in the tested installation. Auto may route different requests to different underlying models.

1. Call `get_status` with `{}` to inspect listener state and available MCP/skill names. This does not start a model request.
2. Select MCP servers and skills for new sessions, if needed, before starting a worker.
3. Call `select_model` with `{}` to create an idle native session and list runtime-reported models. Save the returned `session_id`. This loads the native account/session but does not send a prompt.
4. Ask the user to choose an available model, then select it for that session:

```json
{"session_id":"<returned session_id>","model_id":"<user-chosen runtime model ID>"}
```

5. Submit a message to that **same session**:

```json
{
  "session_id":"<returned session_id>",
  "message":"Reply with exactly HELLO_WORKBUDDY. Do not use tools.",
  "request_id":"hello-example-001"
}
```

`send_message` returns immediately with `task_id`, `session_id`, and status. Receive the reply with:

```json
{"task_id":"<returned task_id>","after_cursor":"0","timeout_seconds":30}
```

Pass that object to `wait_for_message`. Continue with its returned `next_cursor` until the task is terminal or requires input. If `has_more` is true, drain remaining events with `get_message`. Terminal responses include the accumulated `answer`.

To continue the conversation, send another message using the same `session_id`. A new message without `session_id` creates a new session with its own native defaults; a model choice in another session does not carry over automatically.

## Seven-tool reference

All tools return structured JSON in `structuredContent`, mirrored as JSON text for clients that need it. Errors set MCP `isError` and include `error.code` and `error.message`.

### `send_message`

Start a new task, continue an idle live session, or answer a specific interruption.

| Input | Meaning |
| --- | --- |
| `message` | Text prompt; required for an ordinary message. Maximum 500,000 characters. |
| `session_id` | Existing local session; omit to create a new one. |
| `request_id` | Optional idempotency key, maximum 256 characters. |
| `cwd` | Working directory for a newly created session. Defaults to the configured workspace. It does not change an existing session's directory. |
| `reply_to_interruption_id` | ID of a pending permission or question; see the permission section. |
| `permission_option_id` | Exact native permission option ID. |
| `elicitation_action` | `accept`, `decline`, or `cancel`. |
| `elicitation_content` | Structured answer to a supported question. |

One active turn is permitted per session. Concurrent turns return `SESSION_BUSY`; separate sessions may execute independently. Reusing a `request_id` with the same message/session/workspace returns the existing task, while different content returns `REQUEST_ID_CONFLICT`. Do not use a new request ID to blindly replay a task whose outcome is `unknown`.

### `get_message`

Read journaled events without waiting.

| Input | Default / limit |
| --- | --- |
| `task_id` | Required. |
| `after_cursor` | `"0"`; nonnegative integer string. |
| `limit` | 100; range 1–500. |
| `include_partial` | `true`; set false to hide streamed text deltas. |

Returns events, `next_cursor`, `has_more`, task status, and `answer` on terminal tasks. Events distinguish user messages, public assistant deltas/final messages, tool activity, state changes, and input requests. Private reasoning text is not collected.

### `select_model`

Omit `model_id` to list the native session's available models; supply it to select an exact runtime-reported ID. Omit `session_id` to create an idle session. Changes require an idle session and are acknowledged by WorkBuddy through `session/set_model`.

No hard-coded model list is authoritative. Availability depends on the native runtime and signed-in account. `get_status` for a task distinguishes `selected_model` from `response_model` when native metadata provides the latter.

### `wait_for_message`

Uses the same inputs as `get_message`, plus `timeout_seconds` (default 30; range 0–60). Waits for new visible events, a terminal outcome, required input, or timeout. Returns `timed_out` in addition to the event result. A timeout leaves the task running; it is not a stop request. Already-terminal tasks return immediately.

### `get_status`

- `{}`: listener readiness, current managed sessions, defaults, and public MCP/skill catalogs.
- `{"session_id":"..."}`: native connection state, active task, selected model, and selections.
- `{"task_id":"..."}`: task state, selected/response model, activity phase, pending input, and cancellation information.

`ready` means the MCP server is ready. It does not prove the desktop account is still signed in or a model call will succeed. Authentication and entitlement are exercised when the native worker executes.

Task states include `starting`, `running`, `waiting_for_user`, `cancelling`, `completed`, `cancelled`, `failed`, and `unknown`. A connected worker and a running task are different states. Preserve native error/cancellation outcomes rather than interpreting silence as completion.

### `stop_task`

```json
{"task_id":"<task_id>","force":false}
```

Requests native ACP cancellation. It reports `cancelling` until a terminal result is confirmed, and retries cancellation across a native prompt-startup race. Repeated stops on a terminal task are safe.

`force:true` may terminate only the listener-owned worker and its process tree after a short grace period. The result reports `forced_worker_termination:true` to distinguish it from native confirmation. The desktop application is not targeted. A forcibly closed session cannot be continued. Stopping cannot undo tool actions already performed or guarantee cancellation of independently detached jobs.

### `select_mcp_or_skills`

Omit selection fields to list available names. To change defaults for **new** sessions:

```json
{"mcp_servers":["origin"],"skills":[]}
```

`origin` is an example and must already exist in your configuration. Empty arrays disable that category; omitted fields retain the previous selection. Changes to a busy session return `SESSION_BUSY`; a started worker's selection is immutable and returns `SESSION_ALREADY_STARTED` if changed. Configure defaults first, then create a fresh session.

## MCP servers and skills

MCP entries are discovered from `%USERPROFILE%\.workbuddy\mcp.json`, then merged with optional project-local `listener.config.json`. Local entries with the same name override desktop entries for these workers only. No global settings are edited.

Copy the empty example if you need local overrides:

```powershell
Copy-Item listener.config.example.json listener.config.json
```

Example local configuration; adapt the absolute paths:

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

Selected MCP configurations are supplied to the native runtime with strict MCP configuration. Only selected names are included; selecting a disabled desktop entry explicitly enables it inside that dedicated worker. Selection does not install packages or guarantee a third-party server is healthy. Server-specific tools may need their own application, account, bridge, and permissions.

Skills are discovered from user `.workbuddy/skills/<name>/SKILL.md`, installed WorkBuddy built-in skill directories, and explicit local mappings. Relative local skill paths resolve from the configuration file's directory. Each selected file is limited to 256 KB.

**Skill activation is instruction injection:** selected `SKILL.md` contents and their source directories are appended to the worker's system prompt. This is not native plugin installation, live reload, or automatic bundling of referenced files. Referenced resources keep their original locations. Scripts and external tools remain subject to normal permissions.

## Permissions and questions

The server does not auto-approve native tool permission requests. A task requiring a decision reports `waiting_for_user`. Read `get_status` for the task and inspect `pending_input`, including the requested tool, its arguments, and available options.

For `session/request_permission`, reply only to an action the user authorized:

```json
{
  "session_id":"<session_id>",
  "reply_to_interruption_id":"<pending_input.id>",
  "permission_option_id":"<exact optionId from pending_input.params.options>"
}
```

Pass the object to `send_message`. Do not invent an option ID or treat permission to perform one task as blanket approval for unrelated actions. Prefer one-time permission when appropriate.

`elicitation/create` accepts `elicitation_action` and optional structured `elicitation_content`. Unsupported native input methods return `INTERACTION_UNSUPPORTED`. Rejecting a native permission can result in cancellation of the turn, depending on native behavior; do not assume it merely skips one tool call.

## Configuration

Environment variables are read at server startup. The legacy `WORKBUDDY_LISTENER_*` names are intentionally retained for compatibility with the original prototype.

| Variable | Default / purpose |
| --- | --- |
| `WORKBUDDY_INSTALL_DIR` | `%USERPROFILE%/AppData/Local/Programs/WorkBuddy`; installed application directory. |
| `WORKBUDDY_LISTENER_DATA` | `<checkout>/data`; journal and isolated worker profiles. |
| `WORKBUDDY_LISTENER_WORKSPACE` | `<data>/workspace`; default task working directory. |
| `WORKBUDDY_LISTENER_CONFIG` | `<checkout>/listener.config.json`; optional local overrides. |
| `WORKBUDDY_HOME` | `%USERPROFILE%/.workbuddy`; desktop MCP/skill configuration root. |
| `WORKBUDDY_AUTH_FILE` | `%LOCALAPPDATA%/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info`; authorized desktop account file. |
| `WORKBUDDY_LISTENER_TASK_TIMEOUT_MS` | 1,800,000 ms; maximum native prompt wait. |

Use distinct `WORKBUDDY_LISTENER_DATA` directories for independent client instances. Running multiple servers against one journal is not supported. Stop the client before moving the checkout or removing state.

## State, session IDs, and privacy

`data/journal.sqlite` stores prompts, public responses, tool activity, tasks, session metadata, request IDs, and default selections. Worker profiles live under `data/workers/<local-session-id>/`. Profiles can contain selected MCP configurations and skill text; those configurations may include credentials supplied by the user. Treat this directory as private conversation/application state.

Authentication is loaded from the currently signed-in desktop account **inside the installed native WorkBuddy process**. The preload uses a private native storage binding for supported encrypted credentials, then configures native authentication in memory. The parent MCP server does not receive the access token, and no token is needed in the client's MCP JSON.

Inherited custom provider credentials, endpoint overrides, and Node preloads are removed from native worker environments. The installed WorkBuddy product configuration supplies routing. Existing proxy variables are retained. This project neither bundles WorkBuddy credentials nor bypasses account entitlement or service limits.

Basic credential-key/Bearer-value redaction is defensive hygiene, **not a complete secret scanner**. Arbitrary prompt text, nested JSON strings, and third-party tool output can contain sensitive information. Review logs before sharing them. The repository excludes state, local configuration, logs, credential-like files, and test artifacts by default; never force-add them.

## Tests and demonstrated workflows

Non-billable checks:

```powershell
npm test
npm run smoke
```

Unit tests use a fake ACP worker. They cover idempotency, Unicode/cursors, timeouts, streaming/final events, cancellation and startup retry, inherited environment isolation, disconnect/restart behavior, model validation, selection constraints, and structured permission replies. The smoke test launches a real MCP client, verifies the project name and seven tools, and checks startup from another directory without starting a native worker.

### Optional live integration test

Live tests make real WorkBuddy model requests and consume normal account usage. They are **not run by CI**. Choose two distinct, available model IDs yourself:

```powershell
$env:WORKBUDDY_LIVE_TESTS='1'
$env:WORKBUDDY_TEST_MODEL='<first runtime-supported model ID>'
$env:WORKBUDDY_TEST_SECOND_MODEL='<second runtime-supported model ID>'
npm run test:live
```

The live runner uses isolated configuration and state, performs short text requests, tests model switching, invokes a harmless echo MCP with a sentinel skill, and cancels a generated response. It authorizes only the specific echo fixture's one-time permission. Generated reports remain under ignored `test-results/`.

The original local prototype passed 13 automated tests and 12 live checks on November 4, 2026. A separate workflow successfully delegated native graph creation/export through an already installed Origin MCP. See [docs/VALIDATION.md](VALIDATION.md) for scope and observed issues. These are dated observations, not a promise that every model/application combination will behave identically.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| Client cannot launch the server | Use the generated absolute-path configuration; confirm Node 24+ and `npm ci` completed. Run `npm run smoke`. |
| Server appears to wait forever when launched manually | stdio requires an MCP client; this is expected for `npm start` without one. |
| `WORKER_START_FAILED` / immediate `WORKER_EXITED` | Verify the WorkBuddy installation path and supported runtime version. Native worker stderr is not a safe place to publish account diagnostics. |
| Authentication unavailable/refused | Sign in again in WorkBuddy under the same Windows user, then start a new managed session. A private storage/API change may need an adapter update. |
| `MODEL_NOT_AVAILABLE` | List current runtime IDs; select an available ID rather than a display label or historical example. |
| `SESSION_BUSY` | Wait for or stop the active turn before changing configuration or sending another turn. |
| `SESSION_EXPIRED` | Create a new session; old journaled results remain readable. |
| `waiting_for_user` | Inspect and answer the exact native permission/question through `send_message`. |
| `MCP_NOT_FOUND` / `SKILL_NOT_FOUND` | Check installed/configured names with `select_mcp_or_skills` and the active configuration path. |
| Selected third-party MCP fails | Check its own bridge, installed application, permissions, and actual tool schema. Selection alone is not a health check. |
| Task `unknown` | A disconnect, restart, or timeout prevented confirmation. Inspect saved output and external effects before resubmitting. |
| Output exists but native status says `cancelled` | Preserve both facts; inspect the artifact and perform a separate readback if needed. Do not rewrite cancellation as successful completion. |

## Development and license

```text
src/server.mjs       Seven MCP tools and stdio transport
src/controller.mjs   Managed task/session lifecycle
src/acp.mjs          Native process and ACP protocol
src/worker-auth.cjs  Native-process desktop authentication preload
src/journal.mjs      SQLite event/state journal
src/catalog.mjs      Configured MCP and skill selection
scripts/             Portable configuration and no-model smoke checks
test/                Unit/live tests and harmless fixtures
docs/                Validation notes
```

Windows CI runs dependency installation, unit tests, and the no-model smoke check. It does not require a WorkBuddy account or contain a desktop credential.

Contributions should preserve the seven-tool surface, surgical changes, explicit permissions, truthful native outcomes, and separation of public source from local state. Include unit/smoke results with changes. See [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md).

Project code is under the [MIT License](../LICENSE). The non-commercial preference at the top is voluntary and does not override MIT's commercial-use rights. WorkBuddy, model services, and third-party MCP servers have their own terms/licenses; this repository does not redistribute those products or grant rights to them. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
