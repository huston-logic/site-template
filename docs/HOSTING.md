# Hosting register

How hosting works: `docs/PROCESS.md`, rule 13. Rate-limit ids: rule 14. Moving a client out: `docs/OFFBOARDING.md`.

## Rate-limit ids

Rate-limit bindings with the same `namespace_id` in one Cloudflare account share their counters, even across Workers
(Cloudflare docs, "Rate Limiting" binding). So every site has its own ids. They are two whole numbers written as
strings: `contact.rateLimitIds` `{ production, preview }` in `site.config.ts` (`npm run sync:config` copies them into
`wrangler.jsonc`). `npm run check:config` refuses a missing pair, a pair with the same number twice, and a site that
still uses the template's 1001 and 1002. The site editor has its own id, `editor.rateLimitId` in `site.config.ts`, a whole number written as a string. Once the editor is on, `npm run check:config` also refuses the template's 1003 on a real site.

**To give a new site its ids:** take the next three free ids in a row below, starting at 2001, 2002 and 2003 (the first two for the contact form, the third for the editor), then add a row in the same PR.

| Site | Production | Preview | Editor | Notes |
|---|---|---|---|---|
| This template | 1001 | 1002 | 1003 | Only for the template itself. A site made from it must change them. |
| Grant's site | 1001 | 1002 | none (editor off) | Taken. |
| Dylan's site | 1001 | 1002 | none (editor off) | Taken. If it is in the same Cloudflare account as another site on 1001/1002, the two share counters. |
| Pipeline app copies | picked at install | picked at install | | The Pipeline app picks its own ids when a copy is installed. Do not assign them here. |
| (next new site) | 2001 | 2002 | 2003 | Next free ids. The contact form takes the first two, the editor the third. |

Grant's site and Dylan's site were built before the register existed and both use 1001/1002. Once they run in the
same Cloudflare account, move one of them to a new pair and update its row.

## Offboarded sites

When a client is moved out (`docs/OFFBOARDING.md`), add a row with the handover date. Huston Logic's liability ends on
that date. Release the site's ids in the table above in the same PR.

| Site | Handover date | Ids released |
|---|---|---|
| (none yet) | | |
