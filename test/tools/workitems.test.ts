import { describe, it, expect, vi } from "vitest";
import {
  registerWorkItemTools,
  buildFieldPatch,
  buildRelationPatch,
  LINK_TYPES,
} from "../../src/tools/workitems.js";
import { fakeServer, fakeConnection } from "../helpers.js";

function setup(wit: object, work: object = {}) {
  const s = fakeServer();
  registerWorkItemTools(s.server, () => fakeConnection({ wit, work }));
  return s;
}

const sampleItem = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  rev: 3,
  fields: {
    "System.WorkItemType": "Bug",
    "System.Title": `Item ${id}`,
    "System.State": "Active",
    ...extra,
  },
});

describe("buildFieldPatch", () => {
  it("builds one add op per field with reference-name path", () => {
    expect(buildFieldPatch({ "System.Title": "T", "Microsoft.VSTS.Common.Priority": 2 })).toEqual([
      { op: "add", path: "/fields/System.Title", value: "T" },
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: 2 },
    ]);
  });
});

describe("buildRelationPatch", () => {
  it("builds a relation add op with the work item url", () => {
    expect(buildRelationPatch("https://dev.azure.com/org", 42, LINK_TYPES.parent)).toEqual({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: "https://dev.azure.com/org/_apis/wit/workItems/42",
      },
    });
  });
});

describe("wit_query", () => {
  it("runs WIQL and fetches the matching items", async () => {
    const queryByWiql = vi.fn().mockResolvedValue({
      queryType: 1,
      workItems: [{ id: 1 }, { id: 2 }],
    });
    const getWorkItems = vi.fn().mockResolvedValue([sampleItem(1), sampleItem(2)]);
    const s = setup({ queryByWiql, getWorkItems });
    const result = await s.call("wit_query", {
      wiql: "SELECT [System.Id] FROM WorkItems",
      project: "Proj",
    });
    expect(queryByWiql).toHaveBeenCalledWith(
      { query: "SELECT [System.Id] FROM WorkItems" },
      { project: "Proj" },
      undefined,
      200
    );
    const data = result.json();
    expect(data.count).toBe(2);
    expect(data.workItems[0].title).toBe("Item 1");
  });

  it("handles link queries (workItemRelations) and de-duplicates ids", async () => {
    const s = setup({
      queryByWiql: vi.fn().mockResolvedValue({
        workItemRelations: [{ target: { id: 5 } }, { target: { id: 5 } }, { source: null, target: { id: 6 } }],
      }),
      getWorkItems: vi.fn().mockResolvedValue([sampleItem(5), sampleItem(6)]),
    });
    const result = await s.call("wit_query", { wiql: "..." });
    expect(result.json().count).toBe(2);
  });

  it("returns empty result without calling getWorkItems when no matches", async () => {
    const getWorkItems = vi.fn();
    const s = setup({ queryByWiql: vi.fn().mockResolvedValue({ workItems: [] }), getWorkItems });
    const result = await s.call("wit_query", { wiql: "..." });
    expect(result.json()).toEqual({ count: 0, workItems: [] });
    expect(getWorkItems).not.toHaveBeenCalled();
  });

  it("splits large result sets into batches of 200", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
    const getWorkItems = vi.fn().mockImplementation(async (chunk: number[]) =>
      chunk.map((id) => sampleItem(id))
    );
    const s = setup({
      queryByWiql: vi.fn().mockResolvedValue({ workItems: ids }),
      getWorkItems,
    });
    const result = await s.call("wit_query", { wiql: "...", top: 1000 });
    expect(getWorkItems).toHaveBeenCalledTimes(2);
    expect(result.json().count).toBe(250);
  });

  it("surfaces WIQL syntax errors as isError", async () => {
    const s = setup({
      queryByWiql: vi.fn().mockRejectedValue({ statusCode: 400, message: "Invalid WIQL" }),
    });
    const result = await s.call("wit_query", { wiql: "garbage" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Invalid WIQL");
  });
});

describe("wit_get / wit_get_batch", () => {
  it("wit_get returns the item summary with relations when requested", async () => {
    const getWorkItem = vi.fn().mockResolvedValue({
      ...sampleItem(7),
      relations: [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: "http://x/_apis/wit/workItems/3" }],
    });
    const s = setup({ getWorkItem });
    const result = await s.call("wit_get", { id: 7, includeRelations: true });
    const data = result.json();
    expect(data.id).toBe(7);
    expect(data.relations[0].targetId).toBe(3);
  });

  it("wit_get_batch passes selected fields", async () => {
    const getWorkItems = vi.fn().mockResolvedValue([sampleItem(1)]);
    const s = setup({ getWorkItems });
    await s.call("wit_get_batch", { ids: [1], fields: ["System.Title"] });
    expect(getWorkItems).toHaveBeenCalledWith([1], ["System.Title"], undefined, undefined);
  });
});

describe("wit_list_for_iteration", () => {
  it("fetches iteration work item ids then loads them", async () => {
    const work = {
      getIterationWorkItems: vi.fn().mockResolvedValue({
        workItemRelations: [{ target: { id: 10 } }, { target: { id: 11 } }],
      }),
    };
    const wit = { getWorkItems: vi.fn().mockResolvedValue([sampleItem(10), sampleItem(11)]) };
    const s = setup(wit, work);
    const result = await s.call("wit_list_for_iteration", {
      project: "Proj",
      iterationId: "guid-1",
    });
    expect(work.getIterationWorkItems).toHaveBeenCalledWith(
      { project: "Proj", team: undefined },
      "guid-1"
    );
    expect(result.json().count).toBe(2);
  });
});

describe("comments", () => {
  it("wit_list_comments returns compact comments", async () => {
    const s = setup({
      getComments: vi.fn().mockResolvedValue({
        comments: [{ id: 1, text: "hi", createdBy: { displayName: "Ana" }, createdDate: "d" }],
      }),
    });
    const result = await s.call("wit_list_comments", { project: "Proj", id: 5 });
    expect(result.json()[0]).toMatchObject({ id: 1, text: "hi", createdBy: "Ana" });
  });

  it("wit_add_comment posts the comment", async () => {
    const addComment = vi.fn().mockResolvedValue({ id: 9, createdDate: "d" });
    const s = setup({ addComment });
    const result = await s.call("wit_add_comment", { project: "Proj", id: 5, text: "note" });
    expect(addComment).toHaveBeenCalledWith({ text: "note" }, "Proj", 5);
    expect(result.json().id).toBe(9);
  });
});

describe("create / update", () => {
  it("wit_create builds the field patch and creates the item", async () => {
    const createWorkItem = vi.fn().mockResolvedValue(sampleItem(100));
    const s = setup({ createWorkItem });
    const result = await s.call("wit_create", {
      project: "Proj",
      type: "Bug",
      fields: { "System.Title": "New bug" },
    });
    expect(createWorkItem).toHaveBeenCalledWith(
      undefined,
      [{ op: "add", path: "/fields/System.Title", value: "New bug" }],
      "Proj",
      "Bug"
    );
    expect(result.json().id).toBe(100);
  });

  it("wit_create with parentId appends the parent relation", async () => {
    const createWorkItem = vi.fn().mockResolvedValue(sampleItem(101));
    const s = setup({ createWorkItem });
    await s.call("wit_create", {
      project: "Proj",
      type: "Task",
      fields: { "System.Title": "Child" },
      parentId: 42,
    });
    const patch = createWorkItem.mock.calls[0][1];
    expect(patch[1].value.rel).toBe("System.LinkTypes.Hierarchy-Reverse");
    expect(patch[1].value.url).toContain("/workItems/42");
  });

  it("wit_update patches arbitrary fields", async () => {
    const updateWorkItem = vi.fn().mockResolvedValue(sampleItem(7));
    const s = setup({ updateWorkItem });
    await s.call("wit_update", { id: 7, fields: { "System.State": "Closed" } });
    expect(updateWorkItem).toHaveBeenCalledWith(
      undefined,
      [{ op: "add", path: "/fields/System.State", value: "Closed" }],
      7
    );
  });

  it("wit_update_batch reports per-item success and failure", async () => {
    const updateWorkItem = vi
      .fn()
      .mockResolvedValueOnce(sampleItem(1))
      .mockRejectedValueOnce(new Error("field locked"));
    const s = setup({ updateWorkItem });
    const result = await s.call("wit_update_batch", {
      updates: [
        { id: 1, fields: { "System.State": "Closed" } },
        { id: 2, fields: { "System.State": "Closed" } },
      ],
    });
    const data = result.json();
    expect(data[0]).toMatchObject({ id: 1, ok: true });
    expect(data[1]).toMatchObject({ id: 2, ok: false, error: "field locked" });
  });

  it("wit_link maps friendly link type names", async () => {
    const updateWorkItem = vi.fn().mockResolvedValue(sampleItem(1));
    const s = setup({ updateWorkItem });
    await s.call("wit_link", { id: 1, targetId: 2, linkType: "child" });
    const patch = updateWorkItem.mock.calls[0][1];
    expect(patch[0].value.rel).toBe("System.LinkTypes.Hierarchy-Forward");
  });

  it("wit_add_child creates the item linked to the parent", async () => {
    const createWorkItem = vi.fn().mockResolvedValue(sampleItem(200));
    const s = setup({ createWorkItem });
    const result = await s.call("wit_add_child", {
      project: "Proj",
      parentId: 50,
      type: "Task",
      fields: { "System.Title": "Sub" },
    });
    const patch = createWorkItem.mock.calls[0][1];
    expect(patch.at(-1).value.rel).toBe("System.LinkTypes.Hierarchy-Reverse");
    expect(result.json().id).toBe(200);
  });
});

describe("types", () => {
  it("wit_get_type returns states and required fields", async () => {
    const s = setup({
      getWorkItemType: vi.fn().mockResolvedValue({
        name: "Bug",
        states: [{ name: "Active", category: "InProgress" }],
        fields: [{ referenceName: "System.Title", name: "Title", alwaysRequired: true }],
      }),
    });
    const result = await s.call("wit_get_type", { project: "Proj", type: "Bug" });
    expect(result.json().fields[0].referenceName).toBe("System.Title");
  });
});
