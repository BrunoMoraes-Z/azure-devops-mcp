import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebApi } from "azure-devops-node-api";
import { ok, withErrorHandling } from "../utils.js";

export function registerProjectTools(server: McpServer, getConnection: () => WebApi): void {
  server.registerTool(
    "project_list",
    {
      description: "List all projects in the Azure DevOps organization (id, name, description, state).",
      inputSchema: {
        top: z.number().int().positive().optional().describe("Max number of projects to return"),
      },
    },
    withErrorHandling(async ({ top }) => {
      const core = await getConnection().getCoreApi();
      const projects = await core.getProjects(undefined, top);
      return ok(
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          state: p.state,
          lastUpdateTime: p.lastUpdateTime,
        }))
      );
    })
  );

  server.registerTool(
    "project_get",
    {
      description: "Get details of a single project by name or id, including capabilities.",
      inputSchema: {
        project: z.string().describe("Project name or id"),
      },
    },
    withErrorHandling(async ({ project }) => {
      const core = await getConnection().getCoreApi();
      const p = await core.getProject(project, true);
      return ok({
        id: p.id,
        name: p.name,
        description: p.description,
        state: p.state,
        visibility: p.visibility,
        defaultTeam: p.defaultTeam?.name,
        capabilities: p.capabilities,
      });
    })
  );

  server.registerTool(
    "project_list_teams",
    {
      description: "List teams of a project (id, name, description).",
      inputSchema: {
        project: z.string().describe("Project name or id"),
      },
    },
    withErrorHandling(async ({ project }) => {
      const core = await getConnection().getCoreApi();
      const teams = await core.getTeams(project);
      return ok(teams.map((t) => ({ id: t.id, name: t.name, description: t.description })));
    })
  );
}
