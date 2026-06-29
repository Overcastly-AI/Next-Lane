# @next-lane/mcp — Next Lane MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets
external AI agents — **Claude Desktop**, **Claude Code**, and any other MCP host
— **read and write** a Next Lane project's **workflows / SDLC** and core
entities (projects, boards, statuses, issues).

This is the "workflows editable & readable from MCP" surface: an agent can list a
project's statuses, design a workflow from a template, add/edit/delete
transitions and gates, attach a workflow to a board, and create or move issues —
all through your running Next Lane instance's REST API.

It is a **thin, additive** package: it makes authenticated HTTP calls to the
Next Lane API. It requires no schema or backend changes and stores nothing.

## How it works

The server speaks MCP over **stdio** and forwards each tool call to the Next
Lane REST API using a **Personal Access Token (PAT)** as a bearer token. Next
Lane's auth guard accepts PATs (tokens prefixed `nlp_`) on the standard
`Authorization: Bearer <token>` header.

## Configuration (environment variables)

| Variable            | Required | Default                 | Description                                                                 |
| ------------------- | -------- | ----------------------- | --------------------------------------------------------------------------- |
| `NEXT_LANE_TOKEN`   | **Yes**  | —                       | A Next Lane Personal Access Token (`nlp_...`). The server fails fast if unset. |
| `NEXT_LANE_API_URL` | No       | `http://localhost:4000` | Next Lane API host root. Do **not** include `/api` — it is added automatically. |

## Getting a Personal Access Token

1. Log in to your Next Lane instance.
2. Go to **Profile Settings** (`/me/settings`) → **API Tokens**.
3. Create a token, give it a name, and **copy the `nlp_...` value immediately** —
   it is shown only once and cannot be retrieved again.
4. Use that value as `NEXT_LANE_TOKEN`.

> The token inherits your account's permissions. Workflow-editing tools require
> **project ADMIN**; reads require project **VIEWER+**.

## Install & build

From the monorepo root:

```bash
pnpm install
pnpm --filter @next-lane/mcp build
```

This compiles to `apps/mcp/dist/index.js` with an executable
`#!/usr/bin/env node` shebang (exposed as the `next-lane-mcp` bin). You can run
it directly:

```bash
NEXT_LANE_TOKEN=nlp_xxx NEXT_LANE_API_URL=http://localhost:4000 node /absolute/path/to/Next-Lane/apps/mcp/dist/index.js
```

### Run without cloning (once published)

The package is publish-ready (`publishConfig.access: public`, no `workspace:*`
runtime deps). After a maintainer runs `npm publish` from `apps/mcp`, anyone can
run it with **no clone or build**:

```bash
NEXT_LANE_TOKEN=nlp_xxx NEXT_LANE_API_URL=https://your-next-lane.example.com npx @next-lane/mcp
```

…and the Claude Desktop / Claude Code configs below become `"command": "npx"`,
`"args": ["-y", "@next-lane/mcp"]`.

## Connect to Claude Desktop

Edit your Claude Desktop config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add a `next-lane` entry under `mcpServers` (use the **absolute path** to the
built file):

```json
{
  "mcpServers": {
    "next-lane": {
      "command": "node",
      "args": ["/absolute/path/to/Next-Lane/apps/mcp/dist/index.js"],
      "env": {
        "NEXT_LANE_API_URL": "http://localhost:4000",
        "NEXT_LANE_TOKEN": "nlp_your_token_here"
      }
    }
  }
}
```

Restart Claude Desktop. The `next-lane` tools appear in the tools menu.

## Connect to Claude Code

Register the server with the `claude mcp add` command (the `--` separates the
launch command; `-e` sets env vars):

```bash
claude mcp add next-lane \
  -e NEXT_LANE_API_URL=http://localhost:4000 \
  -e NEXT_LANE_TOKEN=nlp_your_token_here \
  -- node /absolute/path/to/Next-Lane/apps/mcp/dist/index.js
```

Then run `claude mcp list` to confirm it is connected.

## Tools

### Read

| Tool                | Description                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| `list_workspaces`   | List workspaces the token can access.                                   |
| `list_projects`     | List projects in a workspace (`workspaceId`).                           |
| `list_boards`       | List a project's boards (`projectId`).                                  |
| `list_statuses`     | List a project's statuses/columns (`projectId`).                       |
| `list_workflows`    | List a project's named workflows with counts (`projectId`).            |
| `get_workflow`      | Get one workflow including its transitions (`workflowId`).              |
| `list_issues`       | List issues with optional project/sprint/assignee/type/status/`q` filters + cursor paging. |
| `get_issue`         | Get one issue by id (`issueId`).                                        |
| `list_issue_links`  | List an issue's typed links/dependencies (`issueId`); includes link ids. |

### Write (SDLC)

| Tool                            | Description                                                         |
| ------------------------------- | ----------------------------------------------------------------- |
| `create_workflow`               | Create an empty named workflow (`projectId`, `name`, …).           |
| `create_workflow_from_template` | Create a workflow from `simple`/`kanban`/`scrum`/`bug-triage`.     |
| `update_workflow`               | Update a workflow's name/description/enforced flag.                |
| `delete_workflow`               | Delete a workflow (transitions cascade; boards detached).         |
| `add_workflow_transition`       | Add a transition (`fromStatusId` null = any → `toStatusId`, gates).|
| `update_workflow_transition`    | Update a transition's from/to/type/name/gates.                    |
| `delete_workflow_transition`    | Delete a transition.                                               |
| `assign_board_workflow`         | Attach a workflow to a board (`workflowId` null detaches).        |
| `create_issue`                  | Create an issue (`projectId`, `title`, …).                         |
| `move_issue`                    | Move an issue to a status (`boardId` applies enforced workflow).  |
| `link_issues`                   | Link two issues (`issueId`, `target`, `type` BLOCKS/BLOCKED_BY/RELATES_TO/DUPLICATES/DUPLICATED_BY/CLONES). |
| `unlink_issues`                 | Remove an issue link by id (`linkId`).                            |

## Development

```bash
pnpm --filter @next-lane/mcp dev    # tsc --watch
pnpm --filter @next-lane/mcp test   # vitest (mocks fetch; no live server needed)
pnpm --filter @next-lane/mcp lint   # tsc --noEmit
```

## License

MIT — same as Next Lane.
