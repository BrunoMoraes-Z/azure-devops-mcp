import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebApi } from "azure-devops-node-api";
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
import type { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
import { ok, err, withErrorHandling } from "../utils.js";

const fieldValue = z.union([z.string(), z.number(), z.boolean()]);
const fieldsSchema = z
  .record(fieldValue)
  .describe(
    'Fields as reference-name → value, e.g. {"System.Title": "My bug", "Microsoft.VSTS.Common.Priority": 1}'
  );

export const LINK_TYPES: Record<string, string> = {
  parent: "System.LinkTypes.Hierarchy-Reverse",
  child: "System.LinkTypes.Hierarchy-Forward",
  related: "System.LinkTypes.Related",
  predecessor: "System.LinkTypes.Dependency-Reverse",
  successor: "System.LinkTypes.Dependency-Forward",
  "tested-by": "Microsoft.VSTS.Common.TestedBy-Forward",
  tests: "Microsoft.VSTS.Common.TestedBy-Reverse",
  duplicate: "System.LinkTypes.Duplicate-Forward",
};

interface PatchOp {
  op: string;
  path: string;
  value?: unknown;
}

/** Builds a JSON Patch document from a field dictionary. */
export function buildFieldPatch(fields: Record<string, string | number | boolean>, op = "add"): PatchOp[] {
  return Object.entries(fields).map(([name, value]) => ({
    op,
    path: `/fields/${name}`,
    value,
  }));
}

export function buildRelationPatch(orgUrl: string, targetId: number, rel: string): PatchOp {
  return {
    op: "add",
    path: "/relations/-",
    value: { rel, url: `${orgUrl}/_apis/wit/workItems/${targetId}` },
  };
}

export function summarizeWorkItem(wi: WorkItem, includeRelations = false): object {
  const f = wi.fields ?? {};
  const base: Record<string, unknown> = {
    id: wi.id,
    rev: wi.rev,
    type: f["System.WorkItemType"],
    title: f["System.Title"],
    state: f["System.State"],
    assignedTo: (f["System.AssignedTo"] as { displayName?: string })?.displayName,
    iterationPath: f["System.IterationPath"],
    areaPath: f["System.AreaPath"],
    tags: f["System.Tags"],
    fields: f,
  };
  if (includeRelations && wi.relations) {
    base.relations = wi.relations.map((r) => ({
      rel: r.rel,
      targetId: Number(r.url?.split("/").pop()),
      attributes: r.attributes,
    }));
  }
  return base;
}

const BATCH_SIZE = 200;

async function getWorkItemsBatched(
  connection: WebApi,
  ids: number[],
  fields?: string[]
): Promise<WorkItem[]> {
  const wit = await connection.getWorkItemTrackingApi();
  const results: WorkItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const items = await wit.getWorkItems(
      chunk,
      fields,
      undefined,
      fields ? undefined : WorkItemExpand.Fields
    );
    results.push(...(items ?? []));
  }
  return results;
}

export function registerWorkItemTools(server: McpServer, getConnection: () => WebApi): void {
  server.registerTool(
    "wit_query",
    {
      description:
        "Run an arbitrary WIQL query and return the matching work items with their fields. " +
        "Supports flat, one-hop (link) and tree queries. Example: SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'MyProj' AND [System.State] = 'Active'",
      inputSchema: {
        wiql: z.string().describe("Full WIQL query text"),
        project: z.string().optional().describe("Project to scope the query (optional if the WIQL filters by System.TeamProject)"),
        top: z.number().int().positive().max(1000).optional().describe("Max results (default 200)"),
        fields: z.array(z.string()).optional().describe("Field reference names to return (default: all fields)"),
      },
    },
    withErrorHandling(async ({ wiql, project, top, fields }) => {
      const connection = getConnection();
      const wit = await connection.getWorkItemTrackingApi();
      const result = await wit.queryByWiql(
        { query: wiql },
        project ? { project } : undefined,
        undefined,
        top ?? 200
      );
      const ids = (
        result.workItems?.map((w) => w.id) ??
        result.workItemRelations?.map((r) => r.target?.id) ??
        []
      ).filter((id): id is number => typeof id === "number");
      const unique = [...new Set(ids)];
      if (unique.length === 0) return ok({ count: 0, workItems: [] });
      const items = await getWorkItemsBatched(connection, unique, fields);
      return ok({
        count: unique.length,
        queryType: result.queryType,
        workItems: items.map((wi) => summarizeWorkItem(wi)),
      });
    })
  );

  server.registerTool(
    "wit_get",
    {
      description: "Get a single work item by id, with all fields and optionally its relations (links).",
      inputSchema: {
        id: z.number().int().positive(),
        includeRelations: z.boolean().optional().describe("Include links to other work items (default false)"),
      },
    },
    withErrorHandling(async ({ id, includeRelations }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const wi = await wit.getWorkItem(
        id,
        undefined,
        undefined,
        includeRelations ? WorkItemExpand.All : WorkItemExpand.Fields
      );
      if (!wi) return err(`Work item ${id} not found.`);
      return ok(summarizeWorkItem(wi, includeRelations));
    })
  );

  server.registerTool(
    "wit_get_batch",
    {
      description: "Get multiple work items by id in one call, optionally selecting specific fields.",
      inputSchema: {
        ids: z.array(z.number().int().positive()).min(1),
        fields: z.array(z.string()).optional().describe("Field reference names to return"),
      },
    },
    withErrorHandling(async ({ ids, fields }) => {
      const items = await getWorkItemsBatched(getConnection(), ids, fields);
      return ok(items.map((wi) => summarizeWorkItem(wi)));
    })
  );

  server.registerTool(
    "wit_list_for_iteration",
    {
      description: "List the work items assigned to a team iteration (sprint backlog).",
      inputSchema: {
        project: z.string(),
        iterationId: z.string().describe("Iteration GUID (from work_list_team_iterations)"),
        team: z.string().optional(),
        fields: z.array(z.string()).optional(),
      },
    },
    withErrorHandling(async ({ project, iterationId, team, fields }) => {
      const connection = getConnection();
      const work = await connection.getWorkApi();
      const iterationItems = await work.getIterationWorkItems({ project, team }, iterationId);
      const ids = (iterationItems.workItemRelations ?? [])
        .map((r) => r.target?.id)
        .filter((id): id is number => typeof id === "number");
      if (ids.length === 0) return ok({ count: 0, workItems: [] });
      const items = await getWorkItemsBatched(connection, ids, fields);
      return ok({ count: ids.length, workItems: items.map((wi) => summarizeWorkItem(wi)) });
    })
  );

  server.registerTool(
    "wit_list_comments",
    {
      description: "List the comments (discussion) of a work item.",
      inputSchema: {
        project: z.string(),
        id: z.number().int().positive().describe("Work item id"),
        top: z.number().int().positive().optional(),
      },
    },
    withErrorHandling(async ({ project, id, top }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const result = await wit.getComments(project, id, top);
      return ok(
        (result.comments ?? []).map((c) => ({
          id: c.id,
          text: c.text,
          createdBy: c.createdBy?.displayName,
          createdDate: c.createdDate,
          modifiedDate: c.modifiedDate,
        }))
      );
    })
  );

  server.registerTool(
    "wit_add_comment",
    {
      description: "Add a comment to a work item's discussion.",
      inputSchema: {
        project: z.string(),
        id: z.number().int().positive().describe("Work item id"),
        text: z.string().min(1).describe("Comment text (supports HTML)"),
      },
    },
    withErrorHandling(async ({ project, id, text }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const comment = await wit.addComment({ text }, project, id);
      return ok({ id: comment.id, createdDate: comment.createdDate });
    })
  );

  server.registerTool(
    "wit_list_types",
    {
      description: "List the work item types available in a project (Bug, Task, User Story, Test Case, ...).",
      inputSchema: { project: z.string() },
    },
    withErrorHandling(async ({ project }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const types = await wit.getWorkItemTypes(project);
      return ok(types.map((t) => ({ name: t.name, description: t.description, states: t.states?.map((s) => s.name) })));
    })
  );

  server.registerTool(
    "wit_get_type",
    {
      description: "Get a work item type's metadata: states, required fields and field reference names.",
      inputSchema: {
        project: z.string(),
        type: z.string().describe('Type name, e.g. "Bug", "User Story"'),
      },
    },
    withErrorHandling(async ({ project, type }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const t = await wit.getWorkItemType(project, type);
      return ok({
        name: t.name,
        description: t.description,
        states: t.states?.map((s) => ({ name: s.name, category: s.category })),
        fields: t.fields?.map((f) => ({
          referenceName: f.referenceName,
          name: f.name,
          alwaysRequired: f.alwaysRequired,
        })),
      });
    })
  );

  server.registerTool(
    "wit_create",
    {
      description:
        "Create a work item of any type with arbitrary fields (reference-name → value). Optionally link it to a parent.",
      inputSchema: {
        project: z.string(),
        type: z.string().describe('Work item type, e.g. "Bug", "Task", "User Story"'),
        fields: fieldsSchema,
        parentId: z.number().int().positive().optional().describe("Work item id to set as parent"),
      },
    },
    withErrorHandling(async ({ project, type, fields, parentId }) => {
      const connection = getConnection();
      const wit = await connection.getWorkItemTrackingApi();
      const patch: PatchOp[] = buildFieldPatch(fields);
      if (parentId) {
        patch.push(buildRelationPatch(connection.serverUrl, parentId, LINK_TYPES.parent));
      }
      const wi = await wit.createWorkItem(undefined, patch, project, type);
      return ok(summarizeWorkItem(wi));
    })
  );

  server.registerTool(
    "wit_update",
    {
      description: "Update arbitrary fields of a work item (reference-name → value).",
      inputSchema: {
        id: z.number().int().positive(),
        fields: fieldsSchema,
      },
    },
    withErrorHandling(async ({ id, fields }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const wi = await wit.updateWorkItem(undefined, buildFieldPatch(fields), id);
      return ok(summarizeWorkItem(wi));
    })
  );

  server.registerTool(
    "wit_update_batch",
    {
      description: "Update fields on multiple work items. Each update is applied independently; failures are reported per item.",
      inputSchema: {
        updates: z
          .array(z.object({ id: z.number().int().positive(), fields: fieldsSchema }))
          .min(1),
      },
    },
    withErrorHandling(async ({ updates }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const results = [];
      for (const { id, fields } of updates) {
        try {
          const wi = await wit.updateWorkItem(undefined, buildFieldPatch(fields), id);
          results.push({ id, ok: true, rev: wi.rev });
        } catch (e) {
          results.push({ id, ok: false, error: (e as Error).message });
        }
      }
      return ok(results);
    })
  );

  server.registerTool(
    "wit_link",
    {
      description:
        "Create a link between two work items. linkType: parent | child | related | predecessor | successor | tested-by | tests | duplicate, or a raw reference name like System.LinkTypes.Hierarchy-Forward.",
      inputSchema: {
        id: z.number().int().positive().describe("Source work item id"),
        targetId: z.number().int().positive().describe("Target work item id"),
        linkType: z.string().default("related"),
      },
    },
    withErrorHandling(async ({ id, targetId, linkType }) => {
      const connection = getConnection();
      const wit = await connection.getWorkItemTrackingApi();
      const rel = LINK_TYPES[linkType] ?? linkType;
      const patch = [buildRelationPatch(connection.serverUrl, targetId, rel)];
      const wi = await wit.updateWorkItem(undefined, patch, id);
      return ok({ id: wi.id, rev: wi.rev, linked: { targetId, rel } });
    })
  );

  server.registerTool(
    "wit_add_child",
    {
      description: "Create a new work item as a child of an existing one (shortcut for wit_create with parentId).",
      inputSchema: {
        project: z.string(),
        parentId: z.number().int().positive(),
        type: z.string().describe('Child work item type, e.g. "Task"'),
        fields: fieldsSchema,
      },
    },
    withErrorHandling(async ({ project, parentId, type, fields }) => {
      const connection = getConnection();
      const wit = await connection.getWorkItemTrackingApi();
      const patch: PatchOp[] = buildFieldPatch(fields);
      patch.push(buildRelationPatch(connection.serverUrl, parentId, LINK_TYPES.parent));
      const wi = await wit.createWorkItem(undefined, patch, project, type);
      return ok(summarizeWorkItem(wi));
    })
  );
}
