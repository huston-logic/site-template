# Website process

How sites are built from this template. The rules are added in the next pull request.

## Where facts live

- This repo, `huston-logic/site-template`, owns the website build rules (this file, `docs/PROCESS.md`), its status (`docs/STATUS.md`) and the handbook (`docs/pipeline/`, the technical reference).
- Client site repos follow these rules. Change them here first, then port them to the client repos.
- Business facts (offers, prices, priorities, clients, feature order) live in the Google Doc "00 Huston Logic: Source of Truth" and the "09 Feature Requests" doc. Find them there and do not copy them into this repo. No links to them are recorded here, so the docs are named only.

## Timings

Measured on Grant's Mac, `.next` deleted first so the build starts cold.

### Before (2026-11-24)

| Step | Time |
|---|---|
| `check:config` | 0.2 s |
| `lint` | 3.4 s |
| `typecheck` | 2.1 s |
| `test:worker` | 0.4 s |
| `test:scripts` | 5.0 s |
| `build` | 4.6 s |
| `npm run check` as one command | 12.8 s |

### After

Filled in at the end of this run.
