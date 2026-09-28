# career-ops UI

React app for the career-ops applications table and job detail drawer.

- `npm run ui:dev` (from the repo root) — Vite on :5173, proxying `/api` to the
  server on :3700. Start `npm run web` first.
- `npm run ui:build` (from the repo root) — builds `ui/dist`; the server
  serves it at `/` once built, falling back to the legacy `web/` UI when not
  built. The legacy UI is always reachable at `/legacy`.
- `cd ui && npm test` — Vitest.

shadcn components were generated with `shadcn@3` — use `npx shadcn@3 add <name>`.
