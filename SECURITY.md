# Security and privacy

WorkBuddy Bridge is a local automation bridge. Its MCP client can ask a signed-in native WorkBuddy worker to use tools and modify files within that worker's capabilities. Run it only for clients and tasks you trust.

## Boundaries

- MCP is exposed through stdio. This project does not provide a remote HTTP endpoint.
- Native workers use the current Windows user's existing WorkBuddy desktop account and normal service entitlements.
- The desktop access token is loaded inside the native process, not sent to the parent MCP server. No account credential is included in the repository or client configuration.
- Selected third-party MCP configurations and skill instructions can themselves contain secrets or powerful instructions. Inspect those sources before selecting them.
- Permission requests are returned for an explicit structured answer. No blanket permission approval is implemented in the server.
- Private reasoning chunks are not collected. Public messages and tool output are journaled and can still contain sensitive information.
- Redaction is limited defensive filtering, not a guarantee that arbitrary tool output or nested text is free of secrets.

## Keep local state private

Never publish `data/`, `test-results/`, `.env` files, `listener.config.json`, generated local client configuration, desktop `.info` account files, or worker profiles. These are excluded by `.gitignore`. Review staged files before committing; do not force-add private state.

Do not place the data directory in a public repository or shared folder. Use normal operating-system access controls and a separate data directory for each independent server instance. Stop the server before moving/deleting its state.

Native runtime/credential storage interfaces are private and version-sensitive. If an application update breaks them, stop and update the adapter; do not disable entitlement checks or publish account data to debug the issue.

## Reporting a concern

Use the repository's GitHub private vulnerability-reporting mechanism if available. If it is unavailable, open an issue containing only a high-level description and ask for a private contact route. Do not include tokens, decrypted data, raw account files, private conversations, or unreviewed worker logs in a public issue.

## Cancellation limits

Cancellation cannot roll back actions already performed. Forced shutdown targets only the owned native process tree; independently detached jobs may require separate inspection. After an unknown outcome, check external effects before repeating a task.
