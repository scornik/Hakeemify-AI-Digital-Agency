/**
 * The gate's check contract (ARCHITECTURE §7, `docs/gate-checklist.md`).
 *
 * Shape borrowed deliberately from Lighthouse's audit model, for the property that makes it
 * work: **gather once, check many**. A check is a pure function of a typed artifact bundle, so
 * every check is testable against a fixture without starting a browser, and a failing check can
 * be reproduced from the stored artifacts rather than by re-running the site.
 *
 * `scoreDisplayMode` is Lighthouse's enum plus `needs_review`, which is axe's `incomplete`:
 * a result a machine genuinely cannot decide, which must reach a human rather than being
 * rounded to a pass.
 */
import type { DeployArtifact } from './deploy.js';

export type { DeployArtifact };

export const SCORE_DISPLAY_MODES = [
  /** Pass or fail. Most of our checks. */
  'binary',
  /** A measured value scored against a threshold. */
  'numeric',
  /** A human must look. Carried into the report, never auto-passed. */
  'manual',
  /** Reported, never scored. */
  'informative',
  /** The artifact this check needs is genuinely absent for this page. */
  'notApplicable',
  /** The check could not run. Weighted errors null the whole report. */
  'error',
  /** The machine could not decide (axe `incomplete`). Requires a reviewer. */
  'needs_review',
] as const;
export type ScoreDisplayMode = (typeof SCORE_DISPLAY_MODES)[number];

/** axe's impact scale. The weights are the ones the gate aggregates with. */
export const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  serious: 7,
  moderate: 3,
  minor: 1,
};

/** Where a failing check points. `target` is a selector path; `sd_path` addresses the source. */
export interface CheckEvidence {
  readonly target?: string;
  readonly sd_path?: string;
  readonly snippet?: string;
  readonly detail?: string;
  readonly actual?: unknown;
  readonly expected?: unknown;
}

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly mode: ScoreDisplayMode;
  /** True only for `binary`/`numeric` modes that passed. */
  readonly passed: boolean;
  readonly severity: Severity;
  readonly weight: number;
  readonly items: readonly CheckEvidence[];
  readonly message?: string;
  /** Numeric value for `numeric` checks, e.g. bytes or milliseconds. */
  readonly value?: number;
}

/** The artifact names a check can require. Missing required artifact -> `notApplicable`. */
export const ARTIFACT_NAMES = [
  'build',
  'dom',
  'axe',
  'console',
  'network',
  'screenshots',
  'runtime',
  'lighthouse',
  'deploy',
] as const;
export type ArtifactName = (typeof ARTIFACT_NAMES)[number];

export interface GateCheck<TContext = unknown> {
  readonly id: string;
  readonly title: string;
  /** What the report says when this check fails. Phrased as the problem, not the rule. */
  readonly failureTitle: string;
  readonly description: string;
  readonly severity: Severity;
  readonly requiredArtifacts: readonly ArtifactName[];
  /** Which gate-checklist row this implements, for traceability. */
  readonly checklistRows: readonly number[];
  readonly audit: (bundle: ArtifactBundle, context: TContext) => CheckOutcome;
}

/** What a check returns. The registry turns this into a `CheckResult`. */
export interface CheckOutcome {
  readonly mode?: ScoreDisplayMode;
  readonly passed: boolean;
  readonly items?: readonly CheckEvidence[];
  readonly message?: string;
  readonly value?: number;
}

// ---------------------------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------------------------

export interface LinkArtifact {
  readonly href: string;
  readonly text: string;
  readonly rel?: string;
  readonly target?: string;
  readonly isInternal: boolean;
  readonly hasHref: boolean;
}

export interface ImageArtifact {
  readonly src: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly loading: string | null;
  readonly fetchpriority: string | null;
  readonly gradeId: string | null;
  readonly sdPath: string | null;
  readonly inPictureSource: boolean;
}

export interface HeadingArtifact {
  readonly level: number;
  readonly text: string;
}

export interface FormFieldArtifact {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly hasLabel: boolean;
  readonly autocomplete: string | null;
}

export interface FormArtifact {
  readonly action: string | null;
  readonly method: string | null;
  readonly fields: readonly FormFieldArtifact[];
  readonly hasHoneypot: boolean;
}

export interface SectionArtifact {
  readonly sdId: string;
  readonly sdPath: string;
  readonly variantId: string | null;
  readonly arrangementId: string | null;
  readonly textLength: number;
}

/**
 * The serialisable DOM artifact. Deliberately not a live DOM: a JSON artifact can be stored
 * next to the report, replayed, diffed and unit-tested, and it is produced identically by the
 * static (jsdom) gatherer and the Playwright gatherer.
 */
export interface DomArtifact {
  readonly route: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly lang: string | null;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly canonical: string | null;
  readonly robots: string | null;
  readonly viewport: string | null;
  readonly og: Readonly<Record<string, string>>;
  readonly twitter: Readonly<Record<string, string>>;
  readonly icons: readonly string[];
  readonly themeColor: string | null;
  readonly jsonLd: readonly unknown[];
  readonly headings: readonly HeadingArtifact[];
  readonly links: readonly LinkArtifact[];
  readonly images: readonly ImageArtifact[];
  readonly scripts: readonly { src: string | null; inlineBytes: number; type: string | null }[];
  readonly stylesheets: readonly string[];
  readonly inlineStyleText: string;
  readonly forms: readonly FormArtifact[];
  readonly landmarks: readonly string[];
  readonly sections: readonly SectionArtifact[];
  readonly text: string;
  readonly attributeText: string;
  readonly canvasCount: number;
  readonly webglCanvasCount: number;
  readonly autoplayMedia: readonly { tag: string; muted: boolean; hasPoster: boolean }[];
  readonly nodeCount: number;
  readonly maxDepth: number;
  readonly emptyInteractiveText: readonly string[];
  readonly bytes: number;
}

/** Everything known before a browser starts: the build output and the definition it came from. */
export interface BuildArtifact {
  readonly siteDefinitionHash: string;
  /** Route -> per-route JS bytes, from the build manifest. */
  readonly jsBytesByRoute: Readonly<Record<string, number>>;
  readonly routes: readonly string[];
  readonly sitemapRoutes: readonly string[];
  readonly robotsTxt: string | null;
  readonly llmsTxt: string | null;
  readonly allowedHosts: readonly string[];
  readonly buildYear: number;
}

export interface AxeNode {
  readonly target: readonly string[];
  readonly html: string;
  readonly failureSummary?: string;
}

export interface AxeResult {
  readonly id: string;
  readonly impact: Severity | null;
  readonly tags: readonly string[];
  readonly nodes: readonly AxeNode[];
}

export interface AxeArtifact {
  readonly violations: readonly AxeResult[];
  readonly incomplete: readonly AxeResult[];
  readonly passes: readonly AxeResult[];
  readonly tags: readonly string[];
}

export interface ConsoleArtifact {
  readonly messages: readonly { level: string; text: string; phase: 'load' | 'interaction' }[];
  readonly pageErrors: readonly string[];
}

export interface NetworkRequestArtifact {
  readonly url: string;
  readonly status: number;
  readonly resourceType: string;
  readonly bytes: number;
  readonly failed: boolean;
  readonly beforeConsent: boolean;
}

export interface NetworkArtifact {
  readonly requests: readonly NetworkRequestArtifact[];
}

/** Values only a real browser can produce. */
export interface RuntimeArtifact {
  readonly lcpElementSdId: string | null;
  readonly lcpElementTag: string | null;
  readonly runningAnimationsUnderReducedMotion: number;
  readonly posterVisibleUnderReducedMotion: boolean;
  readonly tabStops: readonly { sdId: string | null; tag: string; x: number; y: number }[];
  readonly positiveTabIndexCount: number;
  readonly focusVisibleFailures: readonly string[];
  readonly horizontalScrollWidths: Readonly<
    Record<string, { scrollWidth: number; clientWidth: number }>
  >;
}

export interface LighthouseArtifact {
  /** Audit id -> numeric value or score, already reduced to the median run. */
  readonly audits: Readonly<Record<string, { score: number | null; numericValue?: number }>>;
  readonly resourceSummary: Readonly<Record<string, { size: number; count: number }>>;
}

export interface ArtifactBundle {
  readonly project: string;
  readonly build: BuildArtifact;
  readonly dom: DomArtifact;
  readonly axe?: AxeArtifact;
  readonly console?: ConsoleArtifact;
  readonly network?: NetworkArtifact;
  readonly runtime?: RuntimeArtifact;
  readonly lighthouse?: LighthouseArtifact;
  readonly screenshots?: Readonly<Record<string, string>>;
  /**
   * The host config the build emitted. Present only when a deploy target was chosen — a build
   * with no target declares no headers, and the `deploy.*` rows are `notApplicable` rather than
   * failing, because "no target yet" is not "insecure".
   */
  readonly deploy?: DeployArtifact;
}
