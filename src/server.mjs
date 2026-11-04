import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Controller } from './controller.mjs';
import { clean, publicError } from './common.mjs';

const controller = new Controller();
const server = new McpServer({ name: 'workbuddy-bridge', version: '0.1.0' }, { instructions: 'Controls dedicated native WorkBuddy ACP workers, without screen automation. Send a turn, then get/wait using task_id and cursors. Discover configured MCP servers and skills before selecting them. Started sessions keep their selected MCP/skills; change defaults to create a new session. Permission requests are returned as waiting_for_user; authorize only the exact intended action with a structured interruption reply.' });
const id = z.string().min(1).max(256);
const cursor = z.string().regex(/^\d+$/).default('0');
const read = { task_id: id, after_cursor: cursor, limit: z.number().int().min(1).max(500).default(100), include_partial: z.boolean().default(true) };
const specs = [
  ['send_message', 'Start or continue a dedicated WorkBuddy conversation. Returns task_id immediately. Reusing request_id with the same payload is idempotent. Can also reply to a specific pending permission or elicitation using its structured ID.', {
    message: z.string().max(500000).optional(), session_id: id.optional(), request_id: id.optional(), cwd: z.string().max(32768).optional(), reply_to_interruption_id: id.optional(), permission_option_id: id.optional(), elicitation_action: z.enum(['accept', 'decline', 'cancel']).optional(), elicitation_content: z.record(z.string(), z.unknown()).optional()
  }, (a) => controller.sendMessage(a), false],
  ['get_message', 'Read incremental task events after a cursor. Returns next_cursor, has_more, status, and the accumulated answer on terminal tasks. Private reasoning is not collected.', read, a => controller.getMessage(a), true],
  ['select_model', 'List runtime-reported models (omit model_id) or select one for an idle session. Omit session_id to create a new managed session. Changes are acknowledged by WorkBuddy.', { session_id: id.optional(), model_id: id.optional() }, a => controller.selectModel(a), false],
  ['wait_for_message', 'Wait for task events, terminal state or required user input. Timeout returns without stopping the task. Continue with next_cursor.', { ...read, timeout_seconds: z.number().min(0).max(60).default(30) }, (a, extra) => controller.waitForMessage(a, extra.signal), true],
  ['get_status', 'Get server health and available MCP/skill catalogs, session state, or task state including pending input. A connected worker is not necessarily executing a task.', { task_id: id.optional(), session_id: id.optional() }, a => controller.getStatus(a), true],
  ['stop_task', 'Request native task cancellation. Reports cancelling until WorkBuddy confirms cancellation. force=true may terminate only the listener-owned worker after a grace period, never the desktop application.', { task_id: id, force: z.boolean().default(false) }, a => controller.stopTask(a), false],
  ['select_mcp_or_skills', 'List available choices, or select configured MCP servers and SKILL.md instructions for new sessions. Empty arrays disable that category. Omitted fields keep their selection. A running worker keeps its configuration.', { session_id: id.optional(), mcp_servers: z.array(id).max(50).optional(), skills: z.array(id).max(50).optional() }, a => controller.selectMcpOrSkills(a), false]
];
for (const [name, description, inputSchema, invoke, readOnlyHint] of specs) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: !readOnlyHint } }, async (args, extra) => {
    try { const result = clean(await invoke(args, extra)); return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }; }
    catch (e) { const result = { error: publicError(e) }; return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }; }
  });
}
let closing;
function shutdown() { return closing ??= controller.close().catch(e => process.stderr.write(JSON.stringify({ error: publicError(e) }) + '\n')); }
server.server.onclose = shutdown;
process.once('SIGTERM', () => shutdown().finally(() => process.exit(0)));
process.once('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.stdin.once('end', shutdown);
await server.connect(new StdioServerTransport());
