# Deployment

There are **two artefacts** here with opposite requirements, and most deployment confusion comes
from treating them as one thing.

| | What it is | Needs |
| --- | --- | --- |
| **A generated site** | A folder of static HTML and CSS. Zero bytes of JavaScript. | Any static host. No Node, no container, no database |
| **The engine** | A Node batch pipeline | Node 24, Postgres, **headless Chromium**, root to install its libraries, ~2 GB RAM, minutes of CPU |

The engine is **neither a web app nor a desktop app**. It has no HTTP server, no port and no UI: it
runs for a few minutes, writes a site and three documents, and exits non-zero if the gate is red.
Schedule it or trigger it; do not expect it to stay up.

---

## Where a generated site goes

Anywhere. `renderDeployConfig()` emits what each target needs, and the `deploy.*` gate rows verify
the emitted config declares the whole header policy before the build is allowed to ship.

| Target | What is emitted |
| --- | --- |
| Vercel | `vercel.json` — headers, `cleanUrls` |
| Netlify | `_headers`, `_redirects` |
| Northflank | `Dockerfile` + `nginx.conf` (it runs containers, so the adapter ships the server) |

Hostinger is fine for this too — it is static files. There is no adapter for it because nothing
about the output is Hostinger-specific; upload the folder. If you want the security headers there,
they go in an `.htaccess`, and `deploy.security-headers-declared` will be `notApplicable` until
someone writes that adapter.

One thing the gate cannot check locally: **declaring `Strict-Transport-Security` in `vercel.json`
is not an origin sending it.** The `deploy.*` checks assert the declaration. Lighthouse's
`is-on-https`, `has-hsts` and `csp-xss` assert the response and need a deployed origin, so they
stay `notApplicable` until there is one. After the first deploy, point the browser pass at the live
URL to close that gap.

---

## Where the engine goes

### Not shared or "cloud" hosting — including Hostinger Cloud Startup

The blocker is not Node support. It is Chromium.

The gate runs a real browser twice: the **browser pass** across five device and colour-scheme
projects (axe with the full WCAG 2.2 tag set, computed focus styles, tab order, the LCP element,
the motion probe), and the **Lighthouse pass** three times per representative route. Both
[fail closed](../packages/gate/src/browser-pass.ts) when no browser is present — falling back to
the static subset would report green on a gate that had stopped gating.

That needs:

- `apt-get install` of about two dozen shared libraries, which needs **root**;
- roughly **1 GB of RAM per Chromium instance**;
- several **minutes of uninterrupted CPU**, where shared hosting kills long-running processes.

Shared and managed-cloud plans give you none of the three. This is a property of that hosting
model rather than a quirk of any vendor, so verify the specific plan with your provider if you
want to be certain — but a browser-driven pipeline on shared hosting is the wrong shape whoever
sells it.

### Recommended: Northflank

You already chose it as an output target, and it is the right home for the engine too:

- it runs **containers**, so `Dockerfile` at the repository root is the deployment unit;
- it offers a **managed Postgres addon**, so `DATABASE_URL` is one variable;
- it has **scheduled and one-off jobs**, which is the shape of a batch pipeline. Deploy the image
  as a *job*, not a service — a service that exits after one run looks like a crash loop.

### Also fine

| Option | Note |
| --- | --- |
| **Hostinger VPS** | A real VM with root. Their *VPS*, not Cloud Startup |
| Fly.io / Railway / Render | Containers and jobs; same shape as Northflank |
| GitHub Actions | The CI workflow already installs Chromium and runs the whole pipeline. For low volume this is a legitimate production runner |
| A plain VPS + cron | Nothing wrong with it. `docker compose run --rm engine` |

**Not Vercel or Netlify for the engine.** Their functions cap out well below a multi-minute
Chromium run, and they are built for request/response rather than batch.

---

## The image

```bash
docker build -t ada-engine .
docker run --rm --shm-size=1g ada-engine   # runs the acceptance test: the image proves itself
```

**`--shm-size=1g` is not optional.** Docker gives a container 64 MB of `/dev/shm` by default, and
Chromium uses shared memory for its renderer processes. Below roughly 512 MB it crashes partway
through a page, which surfaces as a Playwright timeout rather than as an out-of-memory error — so
the symptom points at the site rather than at the host. On Northflank, Fly and similar, raise the
shared-memory limit in the service configuration.

Verified: `docker run --rm --shm-size=1g ada-engine:test` exits 0 with

```
static pass           gate green — 1 page/project report(s), no fatal rows
browser pass          gate green — 5 page/project report(s), no fatal rows
budget pass           budgets green — 14 assertion(s), 0 warning(s)
```

Image size is **1.09 GB**.

The default `CMD` is `pnpm run e2e:fixture` — one business through all sixteen stages to a green
gate across all three passes, exiting non-zero if any is red. So a successful `docker run` with no
arguments demonstrates the image can actually build and check a site, rather than merely starting.

### Two things about it worth knowing

**It is large, and most of that is Chromium.** Not something to optimise away: see above.

**Do not add `pnpm install --prod`.** `@playwright/test`, `lighthouse` and `@axe-core/playwright`
are declared as devDependencies of `@ada/gate` so they stay out of the dependency closure shipped
to a client — the licence gate holds that closure to MIT/Apache/BSD/MPL and checks it every build.
The *engine* needs them at runtime. A production install produces an image that builds sites and
cannot check them.

For the same reason `NODE_ENV=production` is set **after** the install, not before: pnpm honours it
and omits devDependencies.

### With Postgres

```bash
docker compose run --rm engine
```

Brings up Postgres, waits for its healthcheck, runs one build. `artifacts/` and `_proposed/` are
bind-mounted so a run's output survives the container.

---

## Configuration

Nothing is baked into the image. Everything below is read per run.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | for persistence | **No default, deliberately.** A default lets a process connect somewhere plausible when its config is absent and report that persistence works |
| `ADA_MAX_COST_USD` | no | Image default `0.01`, a tripwire rather than a budget. Raise per run |
| `ADA_MAX_MODEL_CALLS` | no | Default 24 |
| `ADA_MAX_WALL_CLOCK_MS` | no | Default 300 000. Exists because a local model spends $0.00 and can still hang forever |
| `ADA_PRICE_BOOK` | if a paid provider is used | JSON. A model with no price **throws** rather than costing zero, which would let a run pass a ceiling you believe is holding |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | per provider routed | None is in this repository |
| `ADA_OMNIROUTE_BASE_URL`, `ADA_OMNIROUTE_API_KEY` | if Omniroute is routed | No default hostname: a guessed endpoint that 404s looks like an outage |

A malformed ceiling **throws**. An operator who believes they raised a limit and did not is the one
outcome a spend guard must not produce.

### The database

```bash
DATABASE_URL=postgres://… pnpm --filter @ada/db run db:migrate
```

The end-to-end run does not need this: it applies the committed migration itself, because a run
that needs a shell command prepared first is a run somebody will forget to prepare. Already
migrated is a no-op.

`migrations/0000_init.sql` is generated from `schema.ts` and committed — code prints DB schema,
never the reverse. After changing the schema, regenerate with `db:generate`. **There is no
automatic drift check**: `migration.test.ts` fails if you add a *table* without regenerating, but
widening a column silently passes.

Any Postgres 17 works: a Northflank addon, Neon, Supabase, or the compose container. The engine
needs no extensions.

---

## What is not wired yet

Stated plainly, because a deployment guide that implies more than exists is worse than none:

- **Nothing triggers a run.** There is no API, no queue consumer and no scheduler in the repo. You
  invoke the image.
- **Nothing publishes.** Stage 16 is confirm-gated and unimplemented; the engine writes a folder
  and stops. Getting that folder to a host is currently your deploy step, not its.
- **Persistence is opt-in on `DATABASE_URL`.** With it set, the fixture applies the migration,
  persists the run and reads it back; without it the run reports `not persisted — DATABASE_URL is
  not set`. The path does not rot from being optional: `persist-run.test.ts` exercises it on every
  `pnpm verify` against Postgres-in-WASM, and CI runs the end-to-end twice to hold it idempotent.
