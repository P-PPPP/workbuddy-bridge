# Contributing

Use Node.js 24 or later and install dependencies with `npm ci --ignore-scripts --no-audit --no-fund`.

Before proposing a change, run:

```powershell
npm test
npm run smoke
```

Keep the public seven-tool interface stable. Preserve explicit native permissions, immutable started-session MCP/skill configuration, idempotency, cursor semantics, and truthful terminal outcomes. Changes to the bundled native adapter should document the tested WorkBuddy version.

Unit and smoke tests must not use a real account or send model prompts. Live tests require explicit opt-in and two user-chosen runtime model IDs; never run them automatically in CI. Document any actual model/application usage and observed failures without publishing session IDs, personal paths, credentials, or private transcripts.

Do not commit local configuration, state databases, worker profiles, or generated client configuration. Use placeholders or generated examples for machine-dependent paths.

Contributions are provided under the project's MIT license. Its non-commercial-use request is a voluntary preference, not an additional license condition.
