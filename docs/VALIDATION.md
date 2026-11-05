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

The original implementation was called WorkBuddy MCP Listener and was initially published as Workbuddy Local Worker, then WorkBuddy Bridge. Its current name is **WorkBuddy-Link**. The seven tool names and legacy environment variable names are preserved. Unit and no-model MCP smoke checks are rerun for the public release; no additional live model execution is implied by a rename.

Public release preparation: **15 automated tests passed**, including two additional checks for the renamed recursion guard and explicit live-test consent/model requirements. The generated MCP client configuration also passed the no-model smoke test. No new WorkBuddy model request was made for publication.

## Origin MCP demonstration

An installed `origin` MCP server was selected through the listener. WorkBuddy used native Origin MCP operations to import a synthetic sine/cosine CSV, create a graph in OriginPro 2024, set labels and a legend, inspect two curves, export PNG/PDF, and render a preview.

The graph contained one layer and two curves with 73 rows covering angles 0–360 degrees in 5-degree steps. The PNG was 1600 × 1224 pixels and was opened for visual inspection. A fresh independent native session confirmed the graph and finished `completed`.

Observed limitations were retained rather than hidden:

1. An exploratory attempt timed out before exporting.
2. The installed Origin MCP schema accepted integer column selectors, but the live bridge rejected them; WorkBuddy retried with column names successfully.
3. A drawing/export turn reported native `cancelled` despite successful tool results and exported artifacts. Its cause was not established. Artifact verification and an independent fresh-session readback supported the successful drawing/export outcome; the original turn was not relabeled `completed`.

Private local paths, account information, native session IDs, and full conversation traces are intentionally omitted from this repository.

## Water DFT → ESP demonstration, November 5, 2026

WorkBuddy used **GLM-5.3-Flash** with the configured WSL Gaussian and Multiwfn skills. Gaussian 16 Rev. A.03 optimized gas-phase neutral singlet water at B3LYP/def2TZVP and calculated harmonic frequencies. Multiwfn 2026.6.2 analyzed the wavefunction ESP on the 0.001 e/bohr³ density isosurface and exported full density/ESP grids. VMD 1.9.3/Tachyon rendered the real wavefunction-based surface.

Independent read-only checks confirmed two Gaussian normal terminations, all final optimization criteria, no imaginary frequencies, matching Gaussian/FCHK energies, and aligned 50 × 54 × 50 cube grids. The final energy is −76.4629956141 Hartree; the surface ESP extrema are −0.05806658 / +0.06795273 a.u. The 2740 × 1890 PNG was opened for visual inspection.

The [public example](../examples/water-dft-esp/) includes bilingual instructions, calculation evidence, the formatted checkpoint, compressed grids, rendering scripts, independent checks, and actual reported token counters. Both saved-grid rendering and a fresh Multiwfn-to-image reproduction passed. The latter reproduced the surface-extrema file byte for byte. Seven pre-existing Multiwfn/VMD files were hash-checked and remained unchanged.

Workflow limits are explicit: the initial native turn timed out after the listener's default 30-minute wait and remains `unknown` / `ACP_TIMEOUT`. A new worker continued rendering without rerunning DFT, then ended `cancelled` after another read-only log permission was rejected. The public summaries were completed and checked afterward. Artifact success is not reported as a confirmed native task completion. The two workers reported 35 completed model calls: 1,644,455 input + 19,717 output = 1,664,172 total tokens, including 1,461,760 cached-read tokens. This is not a billing invoice and excludes unreported calls.

## Ongoing checks

### Model discovery and token reporting, November 5, 2026

The tested WorkBuddy 5.9.3 external ACP session returned a nine-model initialization snapshot that omitted `glm-5.3-flash` and `deepseek-v4.1-flash`, although both existed in the installed official product configuration. The listener previously treated this snapshot as exhaustive and rejected those IDs before asking WorkBuddy.

The adapter now exposes the native snapshot alongside installed, tool-capable candidates, handles native model catalog updates, and requires native acknowledgement when selecting either kind. Installed candidates are explicitly marked as unverified account availability. GLM-5.3-Flash selection was acknowledged and actual response metadata confirmed that model during the water example. DeepSeek-V4.1-Flash was discovered but was not executed in this check.

All **22 automated tests** and the no-model MCP smoke check passed. Added checks cover incomplete model snapshots, native rejection, model updates, numeric-only usage redaction, persistence, context occupancy versus consumption, per-turn log boundaries, duplicate metric records, and missing counters. Native model-call logs provided real input/output/cache counts for the example; these are recorded separately from context occupancy and latest credit updates.

### WorkBuddy-Link rename, November 5, 2026

All 15 automated tests and the no-model MCP smoke check passed after updating the project identity and generated configuration. The recursion check covers the new `workbuddy-link` name and previous names. No native worker or WorkBuddy model request was started for this update.

`npm test` uses a fake ACP worker. `npm run smoke` launches a real MCP client but never starts a native worker or model task. Windows GitHub Actions runs both.

`npm run test:live` is opt-in, makes real model calls, and requires two distinct user-chosen model IDs. A future WorkBuddy update, account entitlement change, or third-party MCP update can invalidate historical observations.

Existing desktop chat attachment, persistent desktop-history synchronization, attachments, arbitrary native plugin reload, remote MCP transport, and recovery of expired native sessions are not verified capabilities.
