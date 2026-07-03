import { describe, it, expect } from "vitest";
import { describeError, withErrorHandling, ok, compact } from "../src/utils.js";

describe("describeError", () => {
  it("adds a PAT hint on 401/403", () => {
    const msg = describeError({ statusCode: 401, message: "Unauthorized" });
    expect(msg).toContain("401");
    expect(msg).toContain("AZURE_DEVOPS_PAT");
  });

  it("flags 404 as not found", () => {
    expect(describeError({ statusCode: 404, message: "nope" })).toContain("not found");
  });

  it("handles plain errors", () => {
    expect(describeError(new Error("boom"))).toContain("boom");
  });
});

describe("withErrorHandling", () => {
  it("passes through successful results", async () => {
    const fn = withErrorHandling(async () => ok({ a: 1 }));
    const result = await fn();
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ a: 1 });
  });

  it("converts thrown errors into isError results", async () => {
    const fn = withErrorHandling(async () => {
      throw new Error("kaput");
    });
    const result = await fn();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("kaput");
  });
});

describe("compact", () => {
  it("drops null, undefined, _links and url", () => {
    expect(compact({ a: 1, b: null, c: undefined, _links: {}, url: "x" })).toEqual({ a: 1 });
  });
});
