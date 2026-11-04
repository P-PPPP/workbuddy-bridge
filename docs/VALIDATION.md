# Validation and compatibility

This document records dated local observations, not an official WorkBuddy compatibility guarantee.

## Original prototype, November 4, 2026

- Platform: Windows; Node.js 24.15.0.
- Installed WorkBuddy: 5.9.3.
- MCP SDK: 1.32.2.
- 13 automated unit tests passed.
- 12 real MCP/native integration checks passed after a native startup-cancellation retry fix.
- A separate configuration launch check succeeded from another working directory.

The live checks covered all seven tools, duplicate/conflicting request IDs, busy-session rejection, authenticated replies, cursor/final output, immediate terminal waits, acknowledged model selection and an actual follow-up response on that model, selected echo MCP execution, a sentinel skill, and confirmed native cancellation.

The original implementation was called WorkBuddy MCP Listener. This repository packages it as **WorkBuddy Bridge**, preserving the seven tool names and legacy environment variable names. Unit and no-model MCP smoke checks are rerun for the public release; no additional live model execution is implied by the rename.

Public release preparation: **15 automated tests passed**, including two additional checks for the renamed recursion guard and explicit live-test consent/model requirements. The generated MCP client configuration also passed the no-model smoke test. No new WorkBuddy model request was made for publication.

## Origin MCP demonstration

An installed `origin` MCP server was selected through the listener. WorkBuddy used native Origin MCP operations to import a synthetic sine/cosine CSV, create a graph in OriginPro 2024, set labels and a legend, inspect two curves, export PNG/PDF, and render a preview.

The graph contained one layer and two curves with 73 rows covering angles 0–360 degrees in 5-degree steps. The PNG was 1600 × 1224 pixels and was opened for visual inspection. A fresh independent native session confirmed the graph and finished `completed`.

Observed limitations were retained rather than hidden:

1. An exploratory attempt timed out before exporting.
2. The installed Origin MCP schema accepted integer column selectors, but the live bridge rejected them; WorkBuddy retried with column names successfully.
3. A drawing/export turn reported native `cancelled` despite successful tool results and exported artifacts. Its cause was not established. Artifact verification and an independent fresh-session readback supported the successful drawing/export outcome; the original turn was not relabeled `completed`.

Private local paths, account information, native session IDs, and full conversation traces are intentionally omitted from this repository.

## Ongoing checks

`npm test` uses a fake ACP worker. `npm run smoke` launches a real MCP client but never starts a native worker or model task. Windows GitHub Actions runs both.

`npm run test:live` is opt-in, makes real model calls, and requires two distinct user-chosen model IDs. A future WorkBuddy update, account entitlement change, or third-party MCP update can invalidate historical observations.

Existing desktop chat attachment, persistent desktop-history synchronization, attachments, arbitrary native plugin reload, remote MCP transport, and recovery of expired native sessions are not verified capabilities.
