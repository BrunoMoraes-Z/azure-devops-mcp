import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebApi } from "azure-devops-node-api";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

/** Minimal fake McpServer that captures registered tools so tests can invoke them directly. */
export function fakeServer() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;

  return {
    server,
    async call(name: string, args: Record<string, unknown> = {}) {
      const handler = tools.get(name);
      if (!handler) throw new Error(`Tool not registered: ${name}`);
      const result = await handler(args);
      return {
        isError: result.isError ?? false,
        text: result.content[0]?.text ?? "",
        json: () => JSON.parse(result.content[0].text),
      };
    },
    names: () => [...tools.keys()],
  };
}

/** Builds a fake WebApi whose sub-APIs are the provided mocks. */
export function fakeConnection(apis: {
  core?: object;
  work?: object;
  wit?: object;
  testPlan?: object;
  serverUrl?: string;
}): WebApi {
  return {
    serverUrl: apis.serverUrl ?? "https://dev.azure.com/org",
    getCoreApi: async () => apis.core,
    getWorkApi: async () => apis.work,
    getWorkItemTrackingApi: async () => apis.wit,
    getTestPlanApi: async () => apis.testPlan,
  } as unknown as WebApi;
}
