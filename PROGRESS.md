# Progress

Running log of milestones, their definition of done, and decisions taken. Authority for
*what* is being built: `docs/section-metadata-schema.md` (v4). Authority for *how*:
`docs/ARCHITECTURE.md`.

| Phase | Status | DoD command |
| --- | --- | --- |
| P0 Scaffold | ✅ done | `pnpm verify` |
| P1 `contract` | ⏳ not started | `pnpm --filter @ada/contract test` |
| P2 `gate` | ⏳ not started | `pnpm --filter @ada/gate test` |
| P3 `library` infra | ⏳ not started | `pnpm --filter @ada/library test` |
| P4 `pipeline` | ⏳ not started | `pnpm --filter @ada/pipeline test` |
| P5 Renderer + scaffold sections | ⏳ not started | `pnpm --filter @ada/library build:fixture` |
| P6 End to end | ⏳ not started | `pnpm e2e:fixture` |
| P7 Section library | 🚫 human only | — |

---

## P0 — Scaffold

**DoD:** `pnpm verify` exits 0. ✅

`verify` = `check:licences → format:check → lint → typecheck → test`.

### Decisions

**Dependency versions are the current published ones, not the ones the spec-era docs imply.**
At build time the registry offers TypeScript 7.0.2, ESLint 10.11.0 and Vitest 5.0.1. Pinned
TypeScript 6.0.3 rather than 7.x because `typescript-eslint@8.70.1` does not yet declare
support for the 7.x compiler rewrite, and a lint stack that silently degrades is worse than a
minor version behind. Everything else is on latest stable.

**`pnpm verify` runs `check:licences` first.** `pnpm licences` collides with pnpm's own
`licenses` subcommand (pnpm normalises the British spelling), hence the `check:` prefix.

**Licence gate is mechanical, and splits shipped from toolchain.** ARCHITECTURE §1.6 scopes
the strict MIT/Apache/BSD/MPL list to "dependencies shipped to clients". `scripts/check-licences.mjs`
therefore computes the transitive production closure of `licence-policy.json:shippedRoots`
(currently `@ada/library`, the only package whose code reaches a client's site) and holds that
closure to the strict list. The toolchain closure additionally admits ISC, 0BSD, BlueOak-1.0.0
and the other unavoidable permissive licences of the Node toolchain — permissive only, never
copyleft. AGPL/GPL/LGPL/SSPL/BUSL/FSL/MSCL/Elastic/UNLICENSED and any *missing* licence field
are fatal anywhere, shipped or not, because "if a package's licence is unclear, do not add it".
This is a faithful reading of the policy's own scope, not a widening of it; the distinction is
recorded here because it is the kind of thing that should never be silent.

**`js-yaml` (MIT) over `yaml` (ISC) for the token compiler.** The token compiler's YAML parser
is the one toolchain dependency likely to end up in a shipped closure later, so it was chosen
from the strict list to keep that option open without a licence question.

**Vitest projects, not the deprecated workspace file.** `vitest.config.ts` at the root lists the
four packages as projects; each package config excludes `**/dist/**` so compiled
`dist/tests/*.js` are not collected twice.

**Postgres on port 55432.** Avoids colliding with a local 5432.
