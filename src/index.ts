#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConnection } from "./connection.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerWorkTools } from "./tools/work.js";
import { registerWorkItemTools } from "./tools/workitems.js";
import { registerTestPlanTools } from "./tools/testplans.js";

const server = new McpServer({
  name: "azure-devops-mcp",
  version: "0.1.0",
});

registerProjectTools(server, getConnection);
registerWorkTools(server, getConnection);
registerWorkItemTools(server, getConnection);
registerTestPlanTools(server, getConnection);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("azure-devops-mcp server running on stdio");
