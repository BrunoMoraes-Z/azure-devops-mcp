import * as azdev from "azure-devops-node-api";

let connection: azdev.WebApi | undefined;

export interface AdoConfig {
  orgUrl: string;
  pat: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AdoConfig {
  const orgUrl = env.AZURE_DEVOPS_ORG_URL?.trim();
  const pat = env.AZURE_DEVOPS_PAT?.trim();
  if (!orgUrl || !pat) {
    throw new Error(
      "Missing configuration: set AZURE_DEVOPS_ORG_URL (e.g. https://dev.azure.com/my-org) and AZURE_DEVOPS_PAT environment variables."
    );
  }
  if (!/^https?:\/\//.test(orgUrl)) {
    throw new Error(`AZURE_DEVOPS_ORG_URL must be a URL, got: ${orgUrl}`);
  }
  return { orgUrl: orgUrl.replace(/\/+$/, ""), pat };
}

export function getConnection(): azdev.WebApi {
  if (!connection) {
    const { orgUrl, pat } = readConfig();
    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    connection = new azdev.WebApi(orgUrl, authHandler);
  }
  return connection;
}

export function resetConnection(): void {
  connection = undefined;
}
