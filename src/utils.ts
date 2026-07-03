export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }] };
}

export function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wraps a tool handler: converts thrown errors into readable isError results. */
export function withErrorHandling<A extends unknown[]>(
  fn: (...args: A) => Promise<ToolResult>
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e: unknown) {
      return err(describeError(e));
    }
  };
}

export function describeError(e: unknown): string {
  const anyErr = e as { statusCode?: number; message?: string };
  const msg = anyErr?.message ?? String(e);
  const status = anyErr?.statusCode;
  if (status === 401 || status === 403 || /TF400813|VS30063/.test(msg)) {
    return `Azure DevOps authorization error (${status ?? "auth"}): ${msg}\nHint: check that AZURE_DEVOPS_PAT is valid, not expired, and has the required scopes (Work Items Read/Write, Test Management Read/Write, Project Read).`;
  }
  if (status === 404) {
    return `Azure DevOps resource not found (404): ${msg}`;
  }
  return `Azure DevOps error${status ? ` (${status})` : ""}: ${msg}`;
}

/** Removes undefined/null values and drops the noisy _links/url properties. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (k === "_links" || k === "url") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}
