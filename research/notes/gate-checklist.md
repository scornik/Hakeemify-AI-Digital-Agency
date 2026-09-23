# Launch QA Gate — consolidated check inventory

Sources read: Lighthouse 13.5.0 `core/config/default-config.js` (audit list + weights), `core/gather/gatherers/accessibility.js` (which axe rules LH runs), axe-core 4.13.0 `doc/rule-descriptions.md` (105 rules), pa11y 10 `lib/runners/*`, unlighthouse 0.18.1 `packages/core/src`, lighthouse-ci `packages/utils/src/{assertions,presets,representative-runs,budgets-converter}.js`.

Legend — **Det.** column: `D` deterministic given same build + viewport (safe to gate on a single run); `D*` deterministic on our static Astro output but sensitive to viewport/fonts/lazy-load (run at mobile 412x823 and desktop 1350x940 after `document.fonts.ready`); `F` flaky (timing/network) — gate only on median of N runs, or gate on a deterministic proxy; `M` manual/visual — emitted as `scoreDisplayMode: manual`, requires human sign-off recorded in the Decision Manifest.

Tool column: `LH` Lighthouse audit id, `axe` axe-core rule id (via `@axe-core/playwright`), `LHCI` assertion/budget key, `UL` unlighthouse mechanism, `PW` our own Playwright/Node check (gap that none of the four tools gates on), `build` check on SiteDefinition/build output before any browser.

Dedup rule: when Lighthouse wraps an axe rule (`accessibility/<id>` = `AxeAudit` over the same rule id), list it once under **axe** and run axe directly — Lighthouse only runs the `wcag2a`/`wcag2aa` tags plus a hand-picked best-practice list and drops `incomplete` nodes. Lighthouse-only rows are those with no axe equivalent.

---

## 1. Performance (Lighthouse + LHCI budgets)

| # | Tool | Check id | Detects | Det. | Gate policy |
|---|------|----------|---------|------|-------------|
| 1 | LH/LHCI | `largest-contentful-paint` | LCP ms (weight 25) | F | warn, `median-run` of 3, maxNumericValue 2500 (mobile) |
| 2 | LH/LHCI | `first-contentful-paint` | FCP ms (weight 10) | F | warn, median-run |
| 3 | LH/LHCI | `total-blocking-time` | main-thread blocking ms (weight 30) | F | warn, median-run, maxNumericValue 200 |
| 4 | LH/LHCI | `cumulative-layout-shift` | CLS (weight 25) | D* (static site: near-deterministic) | error, maxNumericValue 0.1 on median-run |
| 5 | LH/LHCI | `speed-index` | visual completeness ms | F | warn |
| 6 | LH/LHCI | `interaction-to-next-paint` | INP (timespan mode only, weight 0) | F | informative |
| 7 | LHCI | `resource-summary:script:size` | total JS transfer bytes | D | **error, maxNumericValue 184320 (180 kB budget)** |
| 8 | LHCI | `resource-summary:total:size` / `total-byte-weight` | page weight | D | error, e.g. 1.5 MB mobile |
| 9 | LHCI | `resource-summary:font:count` / `:size` | font files | D | error, count <= 2, size <= 200 kB |
| 10 | LHCI | `resource-summary:image:size` | image bytes | D | error per archetype (hero-heavy pages higher) |
| 11 | LHCI | `resource-summary:third-party:count` | third-party requests | D | error, <= 2 (fonts/analytics only) |
| 12 | LH | `unsized-images` | img without width/height (CLS cause) | D | error, maxLength 0 |
| 13 | LH | `render-blocking-insight` | render-blocking CSS/JS | D | error, maxLength 0 |
| 14 | LH | `dom-size-insight` / `dom-size` | DOM nodes, depth, child count | D | error, maxNumericValue 1500 nodes |
| 15 | LH | `non-composited-animations` | animations not on compositor (main-thread motion) | D* | error, maxLength 0 — enforces motion budget |
| 16 | LH | `forced-reflow-insight` | layout thrash in JS | D* | warn |
| 17 | LH | `font-display-insight` | fonts without `font-display` | D | error |
| 18 | LH | `image-delivery-insight` | oversized/uncompressed/non-modern images | D | error, maxLength 0 |
| 19 | LH | `lcp-discovery-insight` | LCP image lazy-loaded / not preloaded / not in HTML | D | error |
| 20 | LH | `lcp-breakdown-insight` | LCP element + phase breakdown (`details.items` has node) | D (element) / F (timing) | **use for LCP element identity** (see 8.4) |
| 21 | LH | `duplicated-javascript-insight`, `legacy-javascript-insight`, `unused-javascript`, `unused-css-rules`, `unminified-*` | bundle hygiene | D | error, maxLength 0 |
| 22 | LH | `network-dependency-tree-insight`, `cache-insight`, `modern-http-insight`, `document-latency-insight`, `third-parties-insight` | network diagnostics | D* (server-dependent) | warn |
| 23 | LH | `bf-cache` | back/forward cache blockers | D | warn |
| 24 | LH | `viewport-insight` / `meta-viewport` | viewport meta present & not zoom-blocking | D | error (also axe `meta-viewport`) |
| 25 | LH | `mainthread-work-breakdown`, `bootup-time`, `long-tasks` | JS CPU cost | F | informative only (LHCI marks these noisy) |
| 26 | PW | `js-budget-per-page` | per-page JS bytes from Playwright `response.body()` size sum, by page and by island | D | error 180 kB; more precise than LH transfer size (gap: per-island attribution) |

LHCI mechanics: `ci.collect.numberOfRuns: 3` (or 5), `ci.assert.assertions` eslint-style `[level, {minScore|maxLength|maxNumericValue, aggregationMethod: median-run}]`; `representative-runs.js` picks the run nearest median FCP+TTI; `assertMatrix` for per-archetype thresholds by URL pattern. Do **not** gate on `categories:performance` minScore.

## 2. Accessibility (axe-core direct; Lighthouse wraps a subset)

Run `AxeBuilder.withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'])` on every page, mobile + desktop, after fonts; keep `incomplete`.

### 2a. Automated, deterministic (axe rule ids; impact in parentheses; `LH` = also wrapped by Lighthouse)

| # | Rule | Detects | Det. |
|---|------|---------|------|
| 27 | `image-alt` (critical, LH) | `<img>` without alt / role=presentation | D |
| 28 | `svg-img-alt`, `role-img-alt`, `object-alt`, `input-image-alt`, `area-alt` | non-img graphics alt | D |
| 29 | `image-redundant-alt` (minor, LH) | alt text repeated as adjacent text | D |
| 30 | `button-name`, `input-button-name`, `link-name`, `select-name`, `summary-name`, `aria-command-name`, `aria-*-name` family (LH) | controls without accessible name | D |
| 31 | `label`, `label-title-only`, `form-field-multiple-labels`, `autocomplete-valid` (LH) | form field labelling | D |
| 32 | `color-contrast` (serious, LH) | text contrast < 4.5:1 / 3:1 large | D* — **goes `incomplete` on bgImage/bgGradient/imgNode/bgOverlap/fgAlpha/pseudoContent** |
| 33 | `link-in-text-block` (LH) | links distinguished only by colour | D* |
| 34 | `document-title`, `html-has-lang`, `html-lang-valid`, `valid-lang`, `html-xml-lang-mismatch` (LH) | document metadata | D |
| 35 | `heading-order` (moderate, LH), `empty-heading`, `page-has-heading-one` (best-practice, **not in LH**), `p-as-heading` (experimental) | heading structure | D |
| 36 | `landmark-one-main` (LH), `landmark-no-duplicate-*`, `landmark-*-is-top-level`, `landmark-unique`, `region` (best-practice, **not in LH**) | landmark structure — all content inside landmarks | D |
| 37 | `bypass` (needs review), `skip-link` (LH) | skip navigation mechanism | D (presence) / M (works) |
| 38 | `tabindex` (LH), `accesskeys`, `focus-order-semantics` (experimental), `scrollable-region-focusable`, `nested-interactive` (**not in LH**), `frame-focusable-content` | keyboard structure | D |
| 39 | `aria-*` family: `aria-allowed-attr`, `aria-allowed-role`, `aria-required-attr/children/parent`, `aria-roles`, `aria-valid-attr(-value)`, `aria-prohibited-attr`, `aria-conditional-attr`, `aria-deprecated-role`, `aria-hidden-body`, `aria-hidden-focus`, `aria-text`, `presentation-role-conflict`, `duplicate-id-aria` (LH) | ARIA correctness | D |
| 40 | `list`, `listitem`, `definition-list`, `dlitem`, `td-headers-attr`, `th-has-data-cells`, `scope-attr-valid`, `table-duplicate-name`, `empty-table-header`, `td-has-header`, `table-fake-caption` | lists/tables | D |
| 41 | `target-size` (wcag22aa, LH) | touch targets < 24x24 with spacing | D* (viewport) |
| 42 | `meta-viewport`, `meta-viewport-large`, `meta-refresh`, `blink`, `marquee`, `avoid-inline-spacing`, `css-orientation-lock` (experimental) | zoom / motion / orientation anti-patterns | D |
| 43 | `video-caption` (needs review), `no-autoplay-audio` (needs review, **not in LH**), `audio-caption` (deprecated) | media | M (axe only flags presence) |
| 44 | `frame-title`, `frame-title-unique`, `frame-tested` | iframes | D |
| 45 | `identical-links-same-purpose` (AAA, needs review), `label-content-name-mismatch` (experimental) | link purpose / visible label vs name | M |
| 46 | `color-contrast-enhanced` (AAA) | 7:1 contrast | D* — informative for premium/luxury positioning only |

### 2b. Not automatable — must be manual/visual checks (Lighthouse `accessibility/manual/*` + axe `incomplete` + known gaps)

| # | Check (our id) | Source of the gap | Det. |
|---|----------------|-------------------|------|
| 47 | `a11y.focus-visible` | no axe rule; LH `focusable-controls`/`interactive-element-affordance` are manual | PW-assisted: tab through page, assert computed `outline`/`box-shadow` changes on `:focus-visible`; M for aesthetics |
| 48 | `a11y.logical-tab-order` | LH `logical-tab-order` manual | PW-assisted: tab sequence vs DOM order vs visual y/x order (see 5.4); M final |
| 49 | `a11y.visual-order-follows-dom` | LH `visual-order-follows-dom` manual | PW-assisted: compare DOM order with boundingRect order per section (CSS `order`, grid placement, `flex-direction: row-reverse`) |
| 50 | `a11y.focus-traps` / `managed-focus` | LH manual | PW: open/close mobile nav, dialogs; assert focus returns; Escape closes |
| 51 | `a11y.custom-controls-labels/roles` | LH manual | M unless section library forbids custom controls (recommended: only native elements) |
| 52 | `a11y.offscreen-content-hidden` | LH manual | PW: assert elements outside viewport that are not visible have `aria-hidden`/`inert` (drawers, carousels) |
| 53 | `a11y.use-landmarks` | LH manual (axe `region` covers most) | D via axe `region` + `landmark-*` |
| 54 | `a11y.meaningful-alt` | `image-alt` only checks presence; `image-redundant-alt` catches echo | M — reviewer confirms alt describes content; anti-slop tier-1 regex bans `image`, `photo`, `img_1234`, filename-as-alt, `placeholder` |
| 55 | `a11y.contrast-over-image` | `color-contrast` `incomplete` reasons bgImage/bgGradient/imgNode/bgOverlap | PW: sample rendered pixels behind text bbox (screenshot crop), compute min contrast vs text colour; fail < 4.5:1 unless overlay/scrim present; M spot-check |
| 56 | `a11y.reduced-motion` | no rule anywhere | PW: emulate `prefers-reduced-motion: reduce`, assert no `animation`/`transition` > 0 s on section roots and no autoplay video; WebGL section shows static poster |
| 57 | `a11y.reading-order` | none | M (with 49 as proxy) |
| 58 | `a11y.captions-quality` | `video-caption` needs review | M |
| 59 | `a11y.link-purpose` | `identical-links-same-purpose` needs review | PW: flag generic link text (`click here`, `learn more`, `read more` >1 per page) as anti-slop tier 1; M final |
| 60 | `a11y.text-resize-200` | none | PW: emulate 200% zoom / 320 px width, assert no horizontal scroll, no clipped text |

## 3. SEO (Lighthouse + gaps)

| # | Tool | Check id | Detects | Det. |
|---|------|----------|---------|------|
| 61 | LH | `is-crawlable` (weight 93/23) | robots meta / X-Robots-Tag noindex, robots.txt blocking | D |
| 62 | LH | `document-title` / `meta-description` | present, non-empty | D |
| 63 | LH | `http-status-code` | 2xx on audited page | D |
| 64 | LH | `link-text` | descriptive anchor text (generic text list) | D |
| 65 | LH | `crawlable-anchors` | `<a>` with real href (no `javascript:`/click handlers) | D |
| 66 | LH | `robots-txt` | robots.txt valid syntax | D |
| 67 | LH | `hreflang` | valid hreflang values on page | D |
| 68 | LH | `canonical` | canonical tag valid, absolute, not to different hreflang/root | D — **per-page only; does not assert canonical == final URL or site-wide uniqueness** |
| 69 | LH | `structured-data` | **manual** (weight 0) — LH does not validate | — |
| 70 | PW/build | `seo.title-unique`, `seo.description-unique` | duplicate `<title>`/description across site (UL extracts but does not assert) | D (build-time over SiteDefinition; verify in DOM) |
| 71 | PW/build | `seo.title-length`, `seo.description-length` | 30–60 / 70–160 chars | D |
| 72 | PW | `seo.canonical-self` | canonical equals final URL (after redirects), one per page, no cross-page collisions | D |
| 73 | PW/build | `seo.og-twitter` | og:title/description/image (1200x630, reachable, < 300 kB), twitter:card | D |
| 74 | PW | `seo.sitemap-consistency` | every SiteDefinition page in sitemap.xml, no extras, all 200, lastmod set | D |
| 75 | PW | `seo.robots-sitemap-ref` | robots.txt exists and references sitemap | D |
| 76 | PW | `seo.h1-single` | exactly one h1 per page, h1 != title clone | D (axe `page-has-heading-one` covers presence only) |
| 77 | PW | `seo.404-page` | unknown URL returns 404 status + branded page with nav | D |
| 78 | PW | `seo.hreflang-reciprocal` | hreflang pairs point back (if multilingual) | D |

## 4. Best practices / security (Lighthouse)

| # | Tool | Check id | Detects | Det. |
|---|------|----------|---------|------|
| 79 | LH | `is-on-https`, `redirects-http`, `has-hsts` | transport | D (prod only) |
| 80 | LH | `csp-xss`, `trusted-types-xss`, `clickjacking-mitigation`, `origin-isolation` | headers | D (prod) — warn |
| 81 | LH | `errors-in-console` (weight 1) | console errors **during load only** | D* | 
| 82 | LH | `inspector-issues` | DevTools issues panel (mixed content, cookies, CORS, deprecated APIs) | D |
| 83 | LH | `deprecations`, `third-party-cookies`, `geolocation-on-start`, `notification-on-start`, `paste-preventing-inputs` | anti-patterns | D |
| 84 | LH | `image-aspect-ratio`, `image-size-responsive` | distorted / under-resolved images | D* |
| 85 | LH | `doctype`, `charset`, `baseline` (features vs Baseline), `js-libraries`, `valid-source-maps` | hygiene | D |
| 86 | PW | `bp.console-clean-interaction` | console errors/warnings and failed requests (4xx/5xx) **during scripted interactions** (nav open, form submit, scroll to bottom) — LH covers load only | D* |
| 87 | PW | `bp.no-mixed-content`, `bp.no-external-script-unlisted` | scripts only from allowlist (fonts/analytics) | D |

## 5. Structure, links, navigation (none of the four tools gate these)

| # | Tool | Check id | Detects | Det. |
|---|------|----------|---------|------|
| 88 | PW | `links.internal-200` | every internal href resolves 200 (HEAD/GET), no redirect chains > 1 (UL discovers links but never asserts status) | D |
| 89 | PW | `links.external-reachable` | external hrefs reachable (warn only; network-dependent) | F — warn |
| 90 | PW | `links.no-orphans` | every SiteDefinition page reachable from home within 3 clicks; nav/footer contain all primary pages | D |
| 91 | PW | `links.anchor-targets` | `#fragment` links resolve to an id | D |
| 92 | PW | `nav.consistent` | header/footer nav identical across pages; active state present | D |
| 93 | PW | `nav.mobile-menu-works` | hamburger opens/closes, traps focus, closes on Escape, links reachable at 412 px | D |
| 94 | PW | `structure.section-count` | page section count within archetype rhythm profile bounds; no empty section roots | D (build) |
| 95 | PW | `structure.no-horizontal-scroll` | `scrollWidth <= clientWidth` at 320/412/768/1350 | D |
| 96 | PW | `structure.cta-present` | each page has >= 1 primary CTA above fold and one in last section; CTA href valid | D |
| 97 | PW | `structure.tab-order-sanity` | (see 48) tab stops count == interactive elements; no positive tabindex; sequence monotonic in y then x per section | D |

## 6. Forms & conversion path

| # | Tool | Check id | Detects | Det. |
|---|------|----------|---------|------|
| 98 | axe | `label`, `autocomplete-valid`, `select-name`, `input-button-name` | field labelling (see 31) | D |
| 99 | PW | `forms.submit-e2e` | fill required fields with valid data, submit, assert POST 2xx (or handler mock), assert navigation/inline confirmation | D* (depends on handler endpoint; use a stub in CI) |
| 100 | PW | `forms.thank-you-reachable` | thank-you page exists, 200, `noindex`, has next-step CTA, in SiteDefinition | D |
| 101 | PW | `forms.validation-messages` | submit empty -> inline errors with `aria-describedby`/`aria-invalid`, focus moves to first error | D |
| 102 | PW | `forms.honeypot-spam` | honeypot/turnstile present; no CAPTCHA that blocks a11y | D |
| 103 | PW | `forms.tel-mail-links` | `tel:`/`mailto:` hrefs well-formed and match FactRegistry contact facts | D |
| 104 | LH (snapshot mode) | a11y + seo snapshot on thank-you and form-error states | post-interaction audit via `flow.snapshot()` | D |

## 7. Motion

| # | Tool | Check id | Detects | Det. |
|---|------|----------|---------|------|
| 105 | LH | `non-composited-animations` | animations hitting layout/paint (see 15) | D* |
| 106 | LH (timespan) | `total-blocking-time` / `long-tasks` during scroll timespan | main-thread cost of scroll-driven motion — **motion budget <= 120 ms** | F — median of 3, warn |
| 107 | PW | `motion.reduced-motion-respected` | (see 56) | D |
| 108 | PW | `motion.webgl-count` | <= 1 WebGL canvas per page; poster fallback when `WebGL` unavailable (emulate no-GPU) | D |
| 109 | PW | `motion.autoplay-media` | autoplay videos are muted, have poster, pause offscreen; no autoplay audio (axe `no-autoplay-audio`) | D |
| 110 | PW | `motion.cls-during-interaction` | layout shift observer during nav open/scroll (`PerformanceObserver` layout-shift) | D* |

## 8. Content, placeholder, anti-slop (deterministic text checks)

| # | Tool | Check id | Detects | Det. |
|---|------|----------|---------|------|
| 111 | PW/build | `content.placeholder-scan` | `lorem ipsum`, `TODO`, `TBD`, `{{ }}`, `[Company]`, `Your Company`, `123-456-7890`, `example.com`, `img_placeholder`, `Insert`, unresolved template tokens, default alt (`image`, `photo`) — in rendered DOM text, attributes (alt/title/aria-label/meta/og) and JSON-LD | D |
| 112 | build | `content.facts-provenance` | every phone/address/price/claim in DOM matches a FactRegistry entry with `quotable: true` | D |
| 113 | PW | `content.no-empty-text-nodes` | headings/buttons/links with whitespace-only text (axe `empty-heading`, `button-name` overlap) | D |
| 114 | PW | `content.lcp-element-identity` | LCP element (from `lcp-breakdown-insight` details node / PW `PerformanceObserver` largest-contentful-paint) is the hero image or h1 declared in SiteDefinition, not a logo/icon/font swap | D (element) |
| 115 | PW | `content.image-art-direction-grade` | every `<img>`/`<picture>` in a photo slot carries the art_direction_id grade class/LUT marker; srcset widths match crop grammar; no `ai_generated_person` tagged asset | D (build/DOM attribute) + M (visual grade sanity) |
| 116 | PW | `content.image-dimensions-match-slot` | intrinsic size >= slot size at DPR 2 and <= 2x (no 4000 px hero for 800 px slot) | D |
| 117 | anti-slop | tier-1 regex/token bans, tier-3 n-gram self-cliché | banned phrases, repeated n-grams across sections/pages | D |
| 118 | PW | `content.language-consistency` | `lang` attribute matches detected language of body text | D |

## 9. Legal, schema.org, trust

| # | Tool | Check id | Detects | Det. |
|---|------|----------|---------|------|
| 119 | PW | `schema.jsonld-valid` | every `<script type="application/ld+json">` parses; `@type` in allowlist (LocalBusiness/Organization/Service/FAQPage/BreadcrumbList/WebSite); validate against a Zod schema per type; required fields present (name, address, telephone, openingHours, url, image) — LH `structured-data` is manual, so this is our gap | D |
| 120 | PW | `schema.facts-match` | JSON-LD values equal FactRegistry values (phone, address, hours) and DOM values | D |
| 121 | PW | `legal.pages-present` | privacy policy, terms (if forms), cookie notice (if analytics/3rd-party), imprint (jurisdiction-dependent) exist, linked in footer, 200 | D |
| 122 | PW | `legal.consent-before-tracking` | no analytics/3rd-party requests before consent when consent banner configured (network log) | D |
| 123 | PW | `legal.copyright-year` | footer year == build year; business name matches FactRegistry | D |
| 124 | PW | `trust.contact-parity` | NAP (name/address/phone) identical in header/footer/contact page/JSON-LD | D |
| 125 | PW | `trust.favicon-manifest` | favicon 200, apple-touch-icon, `theme-color`; manifest optional | D |

---

## Determinism summary (question b)

- **Deterministic on run 1 (gate hard):** all axe rules (given fixed viewport + fonts), all Lighthouse a11y/seo/best-practice audits, resource-summary budgets, DOM-derived insights (`unsized-images`, `dom-size`, `render-blocking`, `font-display`, `image-delivery`, `lcp-discovery`, `non-composited-animations`), and every `PW`/`build` row above.
- **Flaky (never hard-gate a single run):** FCP/LCP/SI/TBT/INP numeric values and `categories:performance`. Lighthouse's own `docs/variability.md`: median of 5 runs is twice as stable as 1; `computeMedianRun` (`core/lib/median-run.js`) picks the run nearest the multi-metric median; LHCI adds `numberOfRuns` + `aggregationMethod: median | median-run | optimistic | pessimistic` and `representative-runs.js` (nearest median FCP + TTI). Policy: 3 serial runs per representative page, assert `median-run`, level `warn` for metrics, `error` for CLS (near-deterministic on static output) and for all size/count budgets. Never run Lighthouse instances concurrently on one machine (unlighthouse's cluster does; we should not).
- **Viewport/state sensitive (run at both viewports and in snapshot states):** `color-contrast`, `target-size`, `region`, hidden-content, `image-size-responsive`, `errors-in-console`.

## Gaps none of the four tools gate (question c) — all covered above as `PW`/`build`

placeholder text scan (111), duplicate titles/descriptions (70), canonical == final URL & site-wide uniqueness (72), schema.org validation (119–120), thank-you page reachability (100), form submission e2e (99, 101), tab order sanity (48, 97), console errors during interaction (86), 404 internal links (88), orphan pages (90), `prefers-reduced-motion` behaviour (56/107), LCP element identity (114), JS budget per page/per island (26), art-direction grade on all photos (115), focus visibility (47), contrast over images/gradients (55), WebGL count + poster fallback (108), horizontal scroll (95), NAP parity (124), consent-before-tracking (122).

## Report formats we can consume (question d)

| Producer | Format | Key fields for GateReport |
|----------|--------|---------------------------|
| Lighthouse | LHR JSON (`types/lhr/lhr.d.ts`) | `audits[id].{score, scoreDisplayMode, numericValue, numericUnit, displayValue, details.items[] (node items: lhId, selector, boundingRect, snippet, nodeLabel; debugdata impact/tags), metricSavings, warnings, errorMessage}`, `categories[id].{score, auditRefs[]}`, `configSettings.{formFactor, throttling}`, `runWarnings`, `runtimeError`, `environment.benchmarkIndex`, `fullPageScreenshot.{screenshot, nodes[lhId] -> rect}` |
| Lighthouse user flow | flow-result JSON (`createFlowResult()`) | `steps[].{name, gatherMode, lhr}` |
| LHCI | `assertion-results.json` + `manifest.json` (`isRepresentativeRun`) | `{name, auditId, auditProperty, level, expected, actual, operator, passed, values[], url}` |
| axe-core | results JSON (reporter v1 default; v2 compact; `raw`; `no-passes`; EARL JSON-LD via `@axe-core/reporter-earl`) | `{testEngine.version, toolOptions, violations|incomplete|passes|inapplicable[].{id, impact, tags, help, helpUrl, nodes[].{target[], html, failureSummary, any/all/none[].{id, message, data, relatedNodes}}}}` |
| pa11y / pa11y-ci | JSON issues | `{code, type, typeCode, message, context, selector, runner, runnerExtras.{impact, needsFurtherReview, helpUrl}}` — flatter than axe; only worth mapping if pa11y is used (it is not) |
| unlighthouse | `jsonSimple` / `jsonExpanded` / csv | per route `{path, score, categories{...}, audits subset}`; category-level only |
| SARIF | **none of the four emit SARIF natively** | write one GateReport -> SARIF 2.1.0 adapter (`runs[].results[].{ruleId, level, message, locations[].physicalLocation.artifactLocation.uri + region}`) if GitHub code scanning upload is wanted; rule metadata from LH `meta` + axe `getRules()` |

**Unified GateReport row (proposed, Zod):** `{check_id, source: 'lighthouse'|'axe'|'playwright'|'build'|'manual', category, severity: 'critical'|'serious'|'moderate'|'minor'|'info', deterministic: 'D'|'D*'|'F'|'M', status: 'pass'|'fail'|'warn'|'needs_review'|'not_applicable'|'error'|'manual', score?: number, numeric?: {value, unit}, threshold?: {op, value, aggregation}, pages: [{url, viewport, state}], nodes: [{target[], selector, snippet, rect, screenshot_ref}], reason_code?, evidence_ref, tool_version}` — `status` values mirror Lighthouse `scoreDisplayMode` plus axe's `incomplete` as `needs_review`; `severity` mirrors axe impact so Lighthouse-style weights (10/7/3/1) can be applied uniformly.

**Count:** 125 rows above; after collapsing rule families (30, 39, 40) the gate is ~110 distinct check ids, of which ~85 are deterministic machine checks, ~12 are flaky-but-medianed, ~13 are manual/visual with machine assist.
