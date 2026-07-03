import { describe, it, expect, vi } from "vitest";
import { registerTestPlanTools, stepsToXml } from "../../src/tools/testplans.js";
import { fakeServer, fakeConnection } from "../helpers.js";

function setup(testPlan: object, wit: object = {}) {
  const s = fakeServer();
  registerTestPlanTools(s.server, () => fakeConnection({ testPlan, wit }));
  return s;
}

describe("stepsToXml", () => {
  it("generates steps XML with ids starting at 2", () => {
    const xml = stepsToXml([
      { action: "Open page", expected: "Page loads" },
      { action: "Click save", expected: "Saved" },
    ]);
    expect(xml).toContain('<steps id="0" last="3">');
    expect(xml).toContain('<step id="2"');
    expect(xml).toContain('<step id="3"');
    expect(xml).toContain("Open page");
    expect(xml).toContain("Saved");
  });

  it("escapes XML special characters in step text", () => {
    const xml = stepsToXml([{ action: 'Type "<b>" & save', expected: "ok" }]);
    expect(xml).not.toContain('"<b>"');
    expect(xml).toContain("&lt;b&gt;");
    expect(xml).toContain("&amp; save");
  });
});

describe("test plan tools", () => {
  it("testplan_list returns compact plans", async () => {
    const s = setup({
      getTestPlans: vi.fn().mockResolvedValue([
        { id: 1, name: "Plan A", state: "Active", rootSuite: { id: 10 } },
      ]),
    });
    const result = await s.call("testplan_list", { project: "Proj" });
    expect(result.json()[0]).toMatchObject({ id: 1, name: "Plan A", rootSuiteId: 10 });
  });

  it("testplan_create passes params and returns root suite id", async () => {
    const createTestPlan = vi.fn().mockResolvedValue({ id: 2, name: "P", rootSuite: { id: 20 } });
    const s = setup({ createTestPlan });
    const result = await s.call("testplan_create", { project: "Proj", name: "P", iteration: "Proj\\S1" });
    expect(createTestPlan).toHaveBeenCalledWith({ name: "P", iteration: "Proj\\S1" }, "Proj");
    expect(result.json().rootSuiteId).toBe(20);
  });

  it("testsuite_create creates a static suite under the parent", async () => {
    const createTestSuite = vi.fn().mockResolvedValue({ id: 30, name: "Suite", parentSuite: { id: 10 } });
    const s = setup({ createTestSuite });
    const result = await s.call("testsuite_create", {
      project: "Proj",
      planId: 1,
      parentSuiteId: 10,
      name: "Suite",
    });
    const params = createTestSuite.mock.calls[0][0];
    expect(params.name).toBe("Suite");
    expect(params.parentSuite.id).toBe(10);
    expect(result.json().id).toBe(30);
  });

  it("testcase_list returns cases with work item ids", async () => {
    const s = setup({
      getTestCaseList: vi.fn().mockResolvedValue([
        { workItem: { id: 99, name: "TC" }, order: 1, pointAssignments: [{}] },
      ]),
    });
    const result = await s.call("testcase_list", { project: "Proj", planId: 1, suiteId: 10 });
    expect(result.json()[0]).toMatchObject({ workItemId: 99, name: "TC", pointCount: 1 });
  });

  it("testcase_add associates existing cases to the suite", async () => {
    const addTestCasesToSuite = vi.fn().mockResolvedValue([{ workItem: { id: 5, name: "TC5" } }]);
    const s = setup({ addTestCasesToSuite });
    await s.call("testcase_add", { project: "Proj", planId: 1, suiteId: 10, testCaseIds: [5] });
    expect(addTestCasesToSuite).toHaveBeenCalledWith([{ workItem: { id: 5 } }], "Proj", 1, 10);
  });

  it("testcase_create creates the work item with steps XML and adds to suite", async () => {
    const createWorkItem = vi.fn().mockResolvedValue({ id: 77, fields: { "System.Title": "TC" } });
    const addTestCasesToSuite = vi.fn().mockResolvedValue([]);
    const s = setup({ addTestCasesToSuite }, { createWorkItem });
    const result = await s.call("testcase_create", {
      project: "Proj",
      title: "TC",
      steps: [{ action: "a", expected: "e" }],
      planId: 1,
      suiteId: 10,
    });
    const patch = createWorkItem.mock.calls[0][1];
    const stepsOp = patch.find((p: { path: string }) => p.path.includes("TCM.Steps"));
    expect(stepsOp.value).toContain("<steps");
    expect(createWorkItem.mock.calls[0][3]).toBe("Test Case");
    expect(addTestCasesToSuite).toHaveBeenCalledWith([{ workItem: { id: 77 } }], "Proj", 1, 10);
    expect(result.json().addedToSuite).toBe(true);
  });

  it("testcase_update_steps replaces the steps field", async () => {
    const updateWorkItem = vi.fn().mockResolvedValue({ id: 77, rev: 4 });
    const s = setup({}, { updateWorkItem });
    const result = await s.call("testcase_update_steps", {
      id: 77,
      steps: [{ action: "a", expected: "e" }],
    });
    const patch = updateWorkItem.mock.calls[0][1];
    expect(patch[0].path).toBe("/fields/Microsoft.VSTS.TCM.Steps");
    expect(result.json().stepCount).toBe(1);
  });
});
