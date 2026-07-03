import { describe, it, expect, vi } from "vitest";
import { registerProjectTools } from "../../src/tools/projects.js";
import { fakeServer, fakeConnection } from "../helpers.js";

function setup(core: object) {
  const s = fakeServer();
  registerProjectTools(s.server, () => fakeConnection({ core }));
  return s;
}

describe("project tools", () => {
  it("registers all project tools", () => {
    const s = setup({});
    expect(s.names()).toEqual(["project_list", "project_get", "project_list_teams"]);
  });

  it("project_list returns compact project info", async () => {
    const s = setup({
      getProjects: vi.fn().mockResolvedValue([
        { id: "1", name: "Alpha", description: "d", state: "wellFormed", url: "noise" },
      ]),
    });
    const result = await s.call("project_list", {});
    expect(result.isError).toBe(false);
    expect(result.json()).toEqual([
      { id: "1", name: "Alpha", description: "d", state: "wellFormed" },
    ]);
  });

  it("project_get returns details", async () => {
    const getProject = vi.fn().mockResolvedValue({ id: "1", name: "Alpha", state: "wellFormed" });
    const s = setup({ getProject });
    const result = await s.call("project_get", { project: "Alpha" });
    expect(getProject).toHaveBeenCalledWith("Alpha", true);
    expect(result.json().name).toBe("Alpha");
  });

  it("project_list_teams returns teams", async () => {
    const s = setup({
      getTeams: vi.fn().mockResolvedValue([{ id: "t1", name: "Team A", description: null }]),
    });
    const result = await s.call("project_list_teams", { project: "Alpha" });
    expect(result.json()).toEqual([{ id: "t1", name: "Team A", description: null }]);
  });

  it("returns isError with readable message when the API fails", async () => {
    const s = setup({
      getProjects: vi.fn().mockRejectedValue({ statusCode: 401, message: "Unauthorized" }),
    });
    const result = await s.call("project_list", {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain("AZURE_DEVOPS_PAT");
  });
});
