---
name: add-domain-module
description: Scaffold a new NestJS backend domain module for Next Lane (controller, service, DTOs, module wiring) following project conventions. Use when adding a new resource to the API such as labels, sprints, comments, or attachments.
---

# Add a backend domain module

Use this when adding a new REST resource to the Next Lane API.

## Steps

1. **Confirm the data model exists.** Check `apps/api/prisma/schema.prisma` for the entity. If missing, add it (or delegate to the `schema-architect` agent) and run a migration first.

2. **Create the module folder** `apps/api/src/<domain>/` with:
   - `<domain>.module.ts` — declares controller + service, imports `PrismaModule`.
   - `<domain>.service.ts` — all business logic; injects `PrismaService`. Methods: `create`, `findAll`, `findOne`, `update`, `remove` (plus domain-specific ones).
   - `<domain>.controller.ts` — REST routes under `/<domain>` (or nested under `/projects/:projectId/<domain>` when scoped). Guard with `JwtAuthGuard`. Authorize by membership.
   - `dto/create-<domain>.dto.ts` and `dto/update-<domain>.dto.ts` — `class-validator` decorators; update DTO extends `PartialType(CreateDto)`.

3. **Mirror the closest existing module** (e.g. `issues`) for structure, error handling, and auth.

4. **Wire it up**: add the module to `AppModule` imports.

5. **Share types**: if the frontend needs the domain types/enums, put them in `packages/shared` and import on both sides.

6. **Verify**: `pnpm --filter @next-lane/api build`. Add a basic spec if a test harness exists.

7. **Update** `docs/ROADMAP.md` status.

## Conventions
- Validate everything at the DTO boundary. Whitelist unknown props.
- Never expose another workspace's/project's data — check authorization in the service.
- For ordered resources (board cards, backlog), use the fractional-rank helper, not integer positions.
