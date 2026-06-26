# Next Lane — Dev Board (Backlog)

Single prioritized board maintained by the **backlog-groomer**, fed by the two independent auditors (`docs/AUDIT-PRODUCT.md`, `docs/AUDIT-ENGINEERING.md`), the front-end QA review (`docs/UI-REVIEW.md`), and the roadmap. The autonomous build loop pulls from **Ready (top of queue)**.

Format: `- [ ] (P1, M) title — description [src]` · P1 now / P2 next / P3 later · size S/M/L.

## Ready (top of queue)

- [ ] (P1, S) Fix label-chip contrast in issue drawer — reuse `Badge` instead of inline raw-color chips so light labels stay legible [ui-review]
- [ ] (P1, S) Drawer: add scroll-lock, focus trap + Esc, align z-index with Modal [ui-review]
- [ ] (P1, M) Replace native window.prompt/confirm (new workspace, delete issue) with themed modals [ui-review]
- [ ] (P1, M) Add a lightweight toast/notification system; surface mutation errors consistently [ui-review]
- [ ] (P2, S) Move issueMeta hardcoded hex to theme tokens [ui-review]
- [ ] (P2, M) Backlog & sprint planning view (backend sprints already exist) [roadmap]
- [ ] (P2, M) Epics & sub-tasks (parent/child hierarchy) UI [roadmap]
- [ ] (P2, S) Labels management UI (create/assign/filter) [roadmap]

## Next (P2)

- [ ] (P2, L) Roles & permissions enforcement (Admin/Member/Viewer) end to end [roadmap]
- [ ] (P2, M) Realtime board updates surfaced in UI (Socket.io already emits) [roadmap]
- [ ] (P2, L) Reports: burndown & velocity [roadmap]
- [ ] (P2, S) JWT refresh tokens (currently single access token) [roadmap]

## Later (P3)

- [ ] (P3, M) Custom fields (JSONB) [roadmap]
- [ ] (P3, M) Attachments (uploads volume) [roadmap]
- [ ] (P3, L) Query DSL / saved filters [roadmap]
- [ ] (P3, M) Webhooks + API tokens [roadmap]

## Changelog

- (initial) Seeded from UI review + roadmap. Groomer will reprioritize using auditor input.
