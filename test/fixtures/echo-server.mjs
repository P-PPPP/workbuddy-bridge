import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({ name: 'listener-test-echo', version: '1.0.0' });
server.registerTool('listener_test_echo', { description: 'Harmless local test: return the supplied text exactly. Does not read or change files.', inputSchema: { text: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, async ({ text }) => ({ content: [{ type: 'text', text }] }));
await server.connect(new StdioServerTransport());
