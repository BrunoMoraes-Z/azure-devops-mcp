import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebApi } from "azure-devops-node-api";
import { TreeStructureGroup } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
import { ok, withErrorHandling } from "../utils.js";

interface IterationNode {
  name?: string;
  path?: string;
  attributes?: { startDate?: Date; finishDate?: Date };
  children?: IterationNode[];
}

function flattenIterations(node: IterationNode): object[] {
  const self = {
    name: node.name,
    path: node.path,
    startDate: node.attributes?.startDate,
    finishDate: node.attributes?.finishDate,
  };
  return [self, ...(node.children ?? []).flatMap(flattenIterations)];
}

export function registerWorkTools(server: McpServer, getConnection: () => WebApi): void {
  server.registerTool(
    "work_list_iterations",
    {
      description:
        "List the iteration tree (sprints) defined for a project, flattened with path and dates.",
      inputSchema: {
        project: z.string().describe("Project name or id"),
        depth: z.number().int().positive().max(10).optional().describe("Tree depth (default 5)"),
      },
    },
    withErrorHandling(async ({ project, depth }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const root = await wit.getClassificationNode(
        project,
        TreeStructureGroup.Iterations,
        undefined,
        depth ?? 5
      );
      return ok(flattenIterations(root as IterationNode));
    })
  );

  server.registerTool(
    "work_list_team_iterations",
    {
      description:
        "List iterations assigned to a team, optionally filtered by timeframe ('current' returns the active sprint).",
      inputSchema: {
        project: z.string().describe("Project name or id"),
        team: z.string().optional().describe("Team name (defaults to the project's default team)"),
        timeframe: z.enum(["current", "past", "future"]).optional(),
      },
    },
    withErrorHandling(async ({ project, team, timeframe }) => {
      const work = await getConnection().getWorkApi();
      const iterations = await work.getTeamIterations({ project, team }, timeframe);
      return ok(
        iterations.map((i) => ({
          id: i.id,
          name: i.name,
          path: i.path,
          startDate: i.attributes?.startDate,
          finishDate: i.attributes?.finishDate,
          timeFrame: i.attributes?.timeFrame,
        }))
      );
    })
  );

  server.registerTool(
    "work_get_team_settings",
    {
      description: "Get a team's settings: backlog iteration, default iteration, working days, bugs behavior.",
      inputSchema: {
        project: z.string().describe("Project name or id"),
        team: z.string().optional().describe("Team name (defaults to the project's default team)"),
      },
    },
    withErrorHandling(async ({ project, team }) => {
      const work = await getConnection().getWorkApi();
      const s = await work.getTeamSettings({ project, team });
      return ok({
        backlogIteration: s.backlogIteration?.name,
        defaultIteration: s.defaultIteration?.name,
        defaultIterationMacro: s.defaultIterationMacro,
        workingDays: s.workingDays,
        bugsBehavior: s.bugsBehavior,
        backlogVisibilities: s.backlogVisibilities,
      });
    })
  );
}
