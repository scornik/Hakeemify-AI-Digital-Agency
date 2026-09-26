# The engine image.
#
# This runs the *pipeline*, not a generated site. A built site is a folder of static HTML with zero
# JavaScript and needs no container at all — `renderDeployConfig()` emits what Vercel, Netlify or
# Northflank need to serve one. This image is for the thing that produces it.
#
# ## Why it is not small
#
# The gate runs a real browser, twice: the browser pass across five device and colour-scheme
# projects, and the Lighthouse pass three times per representative route. Both fail closed when no
# browser is present, deliberately — falling back to the static subset would report green on a gate
# that stopped gating. So Chromium and its system libraries are not optional, and they are most of
# the image.
#
# ## The subtlety that breaks a `--prod` install
#
# `@playwright/test`, `lighthouse` and `@axe-core/playwright` are declared as **devDependencies of
# `@ada/gate`**, because they must never enter the dependency closure shipped to a client — the
# licence gate holds that closure to MIT/Apache/BSD/MPL and checks it on every build. But the
# engine *needs* them at runtime to gate anything.
#
# So this image installs the full tree, and `pnpm install --prod` would produce an image that
# builds sites and cannot check them. It would not fail quietly: the browser pass throws
# `BrowserUnavailableError` and the run stops. That is the correct behaviour and it is still a
# broken image, so: do not add `--prod` here.
#
# ## Not a server
#
# There is no port, no healthcheck and no long-running process. The engine is a batch job: it runs
# for minutes and exits non-zero if the gate is red. Schedule it, or trigger it; do not expect it
# to stay up.

FROM node:24-bookworm-slim

# Browsers live outside the app tree so they survive a bind-mounted source directory during
# development, and so one chown covers them.
#
# NODE_ENV is deliberately NOT set here. pnpm honours `NODE_ENV=production` and omits
# devDependencies, which would silently produce exactly the image this header warns about: one
# that builds sites and cannot check them, because @playwright/test and lighthouse are
# devDependencies of @ada/gate to keep them out of the client-facing licence closure.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    # Ceilings are per run (resolveBudgets). A low default here is a tripwire, not a budget: the
    # image ships with the deterministic fake provider wired, so a real provider appearing by
    # accident stops the run instead of billing somebody.
    ADA_MAX_COST_USD=0.01 \
    NODE_ENV=production

# `corepack` pins pnpm to the version in package.json's `packageManager` field, so the image and a
# developer's machine resolve the lockfile identically.
RUN corepack enable

WORKDIR /app

# Manifests and the lockfile first, so `docker build` reuses the install layer whenever only source
# changed — which is almost every build.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/contract/package.json packages/contract/
COPY packages/gate/package.json packages/gate/
COPY packages/library/package.json packages/library/
COPY packages/db/package.json packages/db/
COPY packages/pipeline/package.json packages/pipeline/

# `--frozen-lockfile`: an image whose dependency tree differs from the lockfile is an image whose
# tests passed against something else.
RUN pnpm install --frozen-lockfile

# Chromium, plus the ~two dozen shared libraries it needs. Playwright chooses the build that
# matches the installed client version, which is why this is not a pinned base image: a browser and
# a client that disagree is a failure mode with no good error message.
RUN pnpm --filter @ada/gate exec playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Compile every package. `tsc --build` walks the project references, so this is also the typecheck.
RUN pnpm run typecheck

# Chromium refuses to start as root without `--no-sandbox`, and passing that flag to work around a
# container running as root gives up the sandbox on the one process that loads untrusted pages.
# Running as a normal user keeps it.
RUN mkdir -p /app/artifacts /app/_proposed \
    && chown -R node:node /app /ms-playwright

USER node

# Safe now: every install and build is done. Set before the install it would have stripped the
# browser tooling the gate cannot run without.
ENV NODE_ENV=production

# Run with `--shm-size=1g`. Docker's default 64 MB of /dev/shm is not enough for Chromium's
# renderer processes, and the failure surfaces as a Playwright timeout rather than an
# out-of-memory error — so the symptom points at the site instead of at the host.
#
# The acceptance test, which makes the image self-proving: one business through all sixteen stages
# to a green gate across all three passes, exiting non-zero if any is red. Override it to build a
# real site.
CMD ["pnpm", "run", "e2e:fixture"]
