# azure-devops-mcp

TypeScript MCP server that connects AI agents (Claude, Codex, ...) to Azure DevOps, built for flexibility: arbitrary WIQL queries, free-form fields on create/update, and Test Plans operations.

## Setup

```bash
npm install
npm run build
```

### Environment variables

| Variable | Example |
|---|---|
| `AZURE_DEVOPS_ORG_URL` | `https://dev.azure.com/my-org` |
| `AZURE_DEVOPS_PAT` | Personal Access Token |

**Required PAT scopes:** Work Items (Read & Write), Test Management (Read & Write), Project and Team (Read).

### Register in Claude Code
```bash
claude mcp add azure-devops \
  -e AZURE_DEVOPS_ORG_URL=https://dev.azure.com/my-org \
  -e AZURE_DEVOPS_PAT=<your-pat> \
  -- npx -y BrunoMoraes-Z/azure-devops-mcp
```

Or in any MCP client (JSON config):

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "BrunoMoraes-Z/azure-devops-mcp"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/my-org",
        "AZURE_DEVOPS_PAT": "<your-pat>"
      }
    }
  }
}
```

`npx --yes <path>` builds and runs the package's `bin` entry (`azure-devops-mcp`) straight from the local directory, so there's no need to run `npm run build` manually or reference `dist/index.js` directly. If you publish this package to the npm registry under its own name, you can instead run `npx -y BrunoMoraes-Z/azure-devops-mcp` from anywhere.

## Tools

### Projects
- `project_list`, `project_get`, `project_list_teams`

### Work (iterations)
- `work_list_iterations` — the project's iteration tree
- `work_list_team_iterations` — team iterations (`current|past|future` timeframe)
- `work_get_team_settings`

### Work Items
- `wit_query` — **arbitrary WIQL** (flat, link and tree queries) with fields returned
- `wit_get`, `wit_get_batch`, `wit_list_for_iteration`
- `wit_list_comments`, `wit_add_comment`
- `wit_list_types`, `wit_get_type` — metadata (states, required fields)
- `wit_create`, `wit_update`, `wit_update_batch` — free-form fields via `{"System.Title": "..."}`
- `wit_link` (parent/child/related/predecessor/successor/tested-by/...), `wit_add_child`

### Test Plans
- `testplan_list`, `testplan_create`
- `testsuite_list`, `testsuite_create`
- `testcase_list`, `testcase_add` (associates existing cases)
- `testcase_create` — creates a Test Case with `{action, expected}` steps and optionally adds it to a suite
- `testcase_update_steps` — replaces the steps (generates the `Microsoft.VSTS.TCM.Steps` XML)

### WIQL query example

```sql
SELECT [System.Id] FROM WorkItems
WHERE [System.TeamProject] = 'MyProject'
  AND [System.WorkItemType] = 'Bug'
  AND [System.State] <> 'Closed'
ORDER BY [Microsoft.VSTS.Common.Priority]
```

## Development

```bash
npm test         # unit tests (Vitest)
npm run build    # compiles to dist/
```
