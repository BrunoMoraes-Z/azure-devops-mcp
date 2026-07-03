import { describe, it, expect } from "vitest";
import { readConfig } from "../src/connection.js";

describe("readConfig", () => {
  it("reads org url and pat from env", () => {
    const cfg = readConfig({
      AZURE_DEVOPS_ORG_URL: "https://dev.azure.com/my-org",
      AZURE_DEVOPS_PAT: "secret",
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ orgUrl: "https://dev.azure.com/my-org", pat: "secret" });
  });

  it("strips trailing slashes from the org url", () => {
    const cfg = readConfig({
      AZURE_DEVOPS_ORG_URL: "https://dev.azure.com/my-org//",
      AZURE_DEVOPS_PAT: "secret",
    } as NodeJS.ProcessEnv);
    expect(cfg.orgUrl).toBe("https://dev.azure.com/my-org");
  });

  it("throws when variables are missing", () => {
    expect(() => readConfig({} as NodeJS.ProcessEnv)).toThrow(/AZURE_DEVOPS_ORG_URL/);
    expect(() =>
      readConfig({ AZURE_DEVOPS_ORG_URL: "https://dev.azure.com/x" } as NodeJS.ProcessEnv)
    ).toThrow(/AZURE_DEVOPS_PAT/);
  });

  it("throws when the org url is not a URL", () => {
    expect(() =>
      readConfig({ AZURE_DEVOPS_ORG_URL: "my-org", AZURE_DEVOPS_PAT: "x" } as NodeJS.ProcessEnv)
    ).toThrow(/must be a URL/);
  });
});
