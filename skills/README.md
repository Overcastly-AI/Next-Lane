# Next Lane agent skills

Distributable [Agent Skills](https://code.claude.com/docs/en/skills) that
pair with the [`@next-lane/mcp`](../apps/mcp) server. Install a skill by
copying its folder into your agent's skills directory — for Claude Code:

```bash
cp -r skills/project-context ~/.claude/skills/      # all projects
# or
cp -r skills/project-context .claude/skills/        # one project
```

| Skill | What it does |
|---|---|
| [`project-context`](./project-context/SKILL.md) | Gives your agent persistent per-project memory: read the project's agent-context handoff at session start, keep it updated, always dump a handoff for the next run before finishing. |
| [`knowledge-base`](./knowledge-base/SKILL.md) | Teaches your agent to use the Pages knowledge base as connected team memory: find docs before building (`search_pages` / `get_issue_pages` / `get_page_graph`), write link-first pages with `[[wiki-links]]` + issue keys, and keep the graph connected. |

These are product-facing skills for Next Lane *users*' agents — distinct
from `.claude/`, which is this repository's internal dev tooling.
