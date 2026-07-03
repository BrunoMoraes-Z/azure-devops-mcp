import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebApi } from "azure-devops-node-api";
import { TestSuiteType } from "azure-devops-node-api/interfaces/TestPlanInterfaces.js";
import { ok, withErrorHandling } from "../utils.js";
import { buildFieldPatch, summarizeWorkItem } from "./workitems.js";

export interface TestStep {
  action: string;
  expected: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Converts a list of {action, expected} steps into the XML format required by Microsoft.VSTS.TCM.Steps. */
export function stepsToXml(steps: TestStep[]): string {
  // Azure DevOps numbers steps starting at id 2.
  const stepXml = steps
    .map(
      (s, i) =>
        `<step id="${i + 2}" type="ValidateStep">` +
        `<parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;${escapeXml(s.action)}&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>` +
        `<parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;${escapeXml(s.expected)}&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>` +
        `<description/></step>`
    )
    .join("");
  return `<steps id="0" last="${steps.length + 1}">${stepXml}</steps>`;
}

const stepsSchema = z
  .array(z.object({ action: z.string(), expected: z.string() }))
  .min(1)
  .describe("Ordered test steps, each with an action and its expected result");

export function registerTestPlanTools(server: McpServer, getConnection: () => WebApi): void {
  server.registerTool(
    "testplan_list",
    {
      description: "List test plans of a project.",
      inputSchema: {
        project: z.string(),
        activeOnly: z.boolean().optional().describe("Only active plans (default true)"),
      },
    },
    withErrorHandling(async ({ project, activeOnly }) => {
      const api = await getConnection().getTestPlanApi();
      const plans = await api.getTestPlans(project, undefined, undefined, false, activeOnly ?? true);
      return ok(
        (plans ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          state: p.state,
          areaPath: p.areaPath,
          iteration: p.iteration,
          rootSuiteId: p.rootSuite?.id,
        }))
      );
    })
  );

  server.registerTool(
    "testplan_create",
    {
      description: "Create a test plan in a project.",
      inputSchema: {
        project: z.string(),
        name: z.string(),
        areaPath: z.string().optional(),
        iteration: z.string().optional().describe("Iteration path for the plan"),
        description: z.string().optional(),
        startDate: z.string().optional().describe("ISO date"),
        endDate: z.string().optional().describe("ISO date"),
      },
    },
    withErrorHandling(async ({ project, name, areaPath, iteration, description, startDate, endDate }) => {
      const api = await getConnection().getTestPlanApi();
      const params = {
        name,
        ...(areaPath ? { areaPath } : {}),
        ...(iteration ? { iteration } : {}),
        ...(description ? { description } : {}),
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(endDate ? { endDate: new Date(endDate) } : {}),
      };
      const plan = await api.createTestPlan(params as Parameters<typeof api.createTestPlan>[0], project);
      return ok({ id: plan.id, name: plan.name, rootSuiteId: plan.rootSuite?.id });
    })
  );

  server.registerTool(
    "testsuite_list",
    {
      description: "List the test suites of a test plan.",
      inputSchema: {
        project: z.string(),
        planId: z.number().int().positive(),
      },
    },
    withErrorHandling(async ({ project, planId }) => {
      const api = await getConnection().getTestPlanApi();
      const suites = await api.getTestSuitesForPlan(project, planId);
      return ok(
        (suites ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          suiteType: s.suiteType,
          parentSuiteId: s.parentSuite?.id,
        }))
      );
    })
  );

  server.registerTool(
    "testsuite_create",
    {
      description: "Create a static test suite under a parent suite of a test plan.",
      inputSchema: {
        project: z.string(),
        planId: z.number().int().positive(),
        parentSuiteId: z.number().int().positive().describe("Parent suite id (use the plan's rootSuiteId for top level)"),
        name: z.string(),
      },
    },
    withErrorHandling(async ({ project, planId, parentSuiteId, name }) => {
      const api = await getConnection().getTestPlanApi();
      const suite = await api.createTestSuite(
        {
          name,
          suiteType: TestSuiteType.StaticTestSuite,
          parentSuite: { id: parentSuiteId, name: undefined as unknown as string },
        },
        project,
        planId
      );
      return ok({ id: suite.id, name: suite.name, parentSuiteId: suite.parentSuite?.id });
    })
  );

  server.registerTool(
    "testcase_list",
    {
      description: "List the test cases contained in a test suite.",
      inputSchema: {
        project: z.string(),
        planId: z.number().int().positive(),
        suiteId: z.number().int().positive(),
      },
    },
    withErrorHandling(async ({ project, planId, suiteId }) => {
      const api = await getConnection().getTestPlanApi();
      const cases = await api.getTestCaseList(project, planId, suiteId);
      return ok(
        (cases ?? []).map((c) => ({
          workItemId: c.workItem?.id,
          name: c.workItem?.name,
          order: c.order,
          pointCount: c.pointAssignments?.length,
        }))
      );
    })
  );

  server.registerTool(
    "testcase_add",
    {
      description: "Add existing test case work items to a test suite.",
      inputSchema: {
        project: z.string(),
        planId: z.number().int().positive(),
        suiteId: z.number().int().positive(),
        testCaseIds: z.array(z.number().int().positive()).min(1).describe("Work item ids of the test cases"),
      },
    },
    withErrorHandling(async ({ project, planId, suiteId, testCaseIds }) => {
      const api = await getConnection().getTestPlanApi();
      const added = await api.addTestCasesToSuite(
        testCaseIds.map((id) => ({ workItem: { id } })),
        project,
        planId,
        suiteId
      );
      return ok((added ?? []).map((c) => ({ workItemId: c.workItem?.id, name: c.workItem?.name })));
    })
  );

  server.registerTool(
    "testcase_create",
    {
      description:
        "Create a new Test Case work item, optionally with steps and adding it to a suite in one call.",
      inputSchema: {
        project: z.string(),
        title: z.string(),
        steps: stepsSchema.optional(),
        fields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe("Extra fields (reference-name → value)"),
        planId: z.number().int().positive().optional().describe("If set with suiteId, adds the new case to that suite"),
        suiteId: z.number().int().positive().optional(),
      },
    },
    withErrorHandling(async ({ project, title, steps, fields, planId, suiteId }) => {
      const connection = getConnection();
      const wit = await connection.getWorkItemTrackingApi();
      const allFields: Record<string, string | number | boolean> = {
        "System.Title": title,
        ...(fields ?? {}),
      };
      if (steps) allFields["Microsoft.VSTS.TCM.Steps"] = stepsToXml(steps);
      const wi = await wit.createWorkItem(undefined, buildFieldPatch(allFields), project, "Test Case");
      let addedToSuite = false;
      if (planId && suiteId && wi.id) {
        const api = await connection.getTestPlanApi();
        await api.addTestCasesToSuite([{ workItem: { id: wi.id } }], project, planId, suiteId);
        addedToSuite = true;
      }
      return ok({ ...summarizeWorkItem(wi), addedToSuite });
    })
  );

  server.registerTool(
    "testcase_update_steps",
    {
      description: "Replace the steps of an existing Test Case work item.",
      inputSchema: {
        id: z.number().int().positive().describe("Test case work item id"),
        steps: stepsSchema,
      },
    },
    withErrorHandling(async ({ id, steps }) => {
      const wit = await getConnection().getWorkItemTrackingApi();
      const wi = await wit.updateWorkItem(
        undefined,
        buildFieldPatch({ "Microsoft.VSTS.TCM.Steps": stepsToXml(steps) }),
        id
      );
      return ok({ id: wi.id, rev: wi.rev, stepCount: steps.length });
    })
  );
}
