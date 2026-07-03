import { describe, it, expect, vi } from "vitest";
import { registerWorkTools } from "../../src/tools/work.js";
import { fakeServer, fakeConnection } from "../helpers.js";

describe("work tools", () => {
  it("work_list_iterations flattens the classification node tree", async () => {
    const wit = {
      getClassificationNode: vi.fn().mockResolvedValue({
        name: "Root",
        path: "\\Proj\\Iteration",
        children: [
          {
            name: "Sprint 1",
            path: "\\Proj\\Iteration\\Sprint 1",
            attributes: { startDate: "2026-01-01", finishDate: "2026-01-14" },
          },
        ],
      }),
    };
    const s = fakeServer();
    registerWorkTools(s.server, () => fakeConnection({ wit }));
    const result = await s.call("work_list_iterations", { project: "Proj" });
    const items = result.json();
    expect(items).toHaveLength(2);
    expect(items[1].name).toBe("Sprint 1");
    expect(items[1].startDate).toBe("2026-01-01");
  });

  it("work_list_team_iterations passes team context and timeframe", async () => {
    const getTeamIterations = vi.fn().mockResolvedValue([
      { id: "abc", name: "Sprint 2", path: "Proj\\Sprint 2", attributes: { timeFrame: 1 } },
    ]);
    const s = fakeServer();
    registerWorkTools(s.server, () => fakeConnection({ work: { getTeamIterations } }));
    const result = await s.call("work_list_team_iterations", {
      project: "Proj",
      team: "Team A",
      timeframe: "current",
    });
    expect(getTeamIterations).toHaveBeenCalledWith({ project: "Proj", team: "Team A" }, "current");
    expect(result.json()[0].id).toBe("abc");
  });

  it("work_get_team_settings returns team settings summary", async () => {
    const s = fakeServer();
    registerWorkTools(s.server, () =>
      fakeConnection({
        work: {
          getTeamSettings: vi.fn().mockResolvedValue({
            backlogIteration: { name: "Backlog" },
            workingDays: ["monday"],
          }),
        },
      })
    );
    const result = await s.call("work_get_team_settings", { project: "Proj" });
    expect(result.json()).toMatchObject({ backlogIteration: "Backlog", workingDays: ["monday"] });
  });
});
