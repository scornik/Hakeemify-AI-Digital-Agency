/**
 * Anti-slop tier 1 — deterministic bans, blocking (v4 §14, ARCHITECTURE §8).
 *
 * The rule pack is versioned with fatal and warning classes and `canShip = !hasFatal`, so
 * promoting a phrase from the tier-2 queue is a version bump rather than a code change.
 *
 * The copy bans are seeded from v4's published list. The effect-name and class-fingerprint bans
 * are **harvested, not invented** (ARCHITECTURE §1.7): the Aceternity public registry, MagicUI,
 * and the literal utility classes that tutorial builder prompts mandate. The motion and 3D idiom
 * bans come from SYNTHESIS §7.3. A list of things a person found tasteless would go stale and be
 * arguable; a list derived from what the most-copied effect libraries actually ship is neither.
 */

export type BanSeverity = 'blocking' | 'warning';

export interface CopyBan {
  readonly id: string;
  readonly pattern: RegExp;
  readonly severity: BanSeverity;
  readonly source: string;
}

export interface TokenBan {
  readonly id: string;
  readonly severity: BanSeverity;
  readonly source: string;
  readonly detect: (input: SlopInput) => boolean;
  readonly detail: string;
}

export interface SlopInput {
  /** Generated copy only, keyed by `sectionInstanceId.slot`. */
  readonly copy: Readonly<Record<string, string>>;
  readonly designSystem: {
    readonly heading_font: string;
    readonly body_font: string;
    readonly radius_applied_uniformly: boolean;
    readonly radius_value: number;
  };
  readonly sections: readonly {
    readonly instance_id: string;
    readonly family: string;
    readonly background: string;
    readonly hues: readonly string[];
    readonly align: string;
    readonly cta_count: number;
    readonly media: string;
    readonly item_count: number;
    readonly item_media: string;
    readonly list_markers: readonly string[];
    readonly effect_ids: readonly string[];
    readonly css_classes: readonly string[];
  }[];
  /** Every image the build will render, with the grade actually applied. */
  readonly assets: readonly {
    readonly asset_id: string;
    readonly grade_id: string | null;
    readonly aspect: number;
    readonly tags: readonly string[];
    readonly ai_generated: boolean;
  }[];
  readonly artDirection: {
    readonly grade_id: string;
    readonly allowed_aspects: readonly number[];
    readonly forbidden_tags: readonly string[];
  };
}

/** v4 §14's published regex list. Blocking. */
export const BANNED_COPY: readonly CopyBan[] = [
  { id: 'elevate_your', pattern: /\belevate your\b/i, severity: 'blocking', source: 'v4 §14' },
  { id: 'seamless', pattern: /\bseamless(ly)?\b/i, severity: 'blocking', source: 'v4 §14' },
  {
    id: 'todays_world',
    pattern: /\bin today'?s (fast-paced|digital) world\b/i,
    severity: 'blocking',
    source: 'v4 §14',
  },
  {
    id: 'unlock_the',
    pattern: /\bunlock the (power|potential)\b/i,
    severity: 'blocking',
    source: 'v4 §14',
  },
  {
    id: 'next_level',
    pattern: /\btake .{0,24} to the next level\b/i,
    severity: 'blocking',
    source: 'v4 §14',
  },
  {
    id: 'passionate_about',
    pattern: /\bwe'?re passionate about\b/i,
    severity: 'blocking',
    source: 'v4 §14',
  },
  { id: 'cutting_edge', pattern: /\bcutting[- ]edge\b/i, severity: 'blocking', source: 'v4 §14' },
  {
    id: 'quality_you_can_trust',
    pattern: /\bquality you can trust\b/i,
    severity: 'blocking',
    source: 'v4 §14',
  },
  { id: 'one_stop', pattern: /\byour one[- ]stop\b/i, severity: 'blocking', source: 'v4 §14' },
];

/**
 * Effect names harvested from the Aceternity public registry (284 items) and MagicUI (78), plus
 * the motion and 3D idioms in SYNTHESIS §7.3. Banned by id, so an arrangement that pulls one in
 * fails regardless of what it calls the class.
 */
export const BANNED_EFFECTS: readonly string[] = [
  'background-beams',
  'sparkles',
  'lamp-effect',
  'aurora-background',
  'meteors',
  'spotlight',
  'typewriter-effect',
  'card-3d',
  'globe',
  'grid-pattern',
  'dot-pattern',
  'shimmer-button',
  'animated-gradient-text',
  'marquee',
  'bento-grid',
  'border-beam',
  'orbiting-circles',
  'smooth-scroll',
  'floating-blob',
  'cursor-follow',
  'text-3d',
  'spline-scene',
  'infinite-lottie-loop',
  'fade-up-everything',
];

/** Literal utility classes mandated by tutorial generation prompts. */
export const BANNED_CLASS_FINGERPRINTS: readonly string[] = [
  'from-indigo-500',
  'via-purple-500',
  'to-pink-500',
  'backdrop-blur',
  'glassmorphism',
  'hover:scale-105',
  'bg-gradient-to-r',
  'blur-3xl',
];

export const BANNED_TOKEN_COMBOS: readonly TokenBan[] = [
  {
    id: 'single_family_typography',
    severity: 'blocking',
    source: 'v4 §14',
    detail: 'the heading and body faces are the same family',
    detect: (input) => input.designSystem.heading_font === input.designSystem.body_font,
  },
  {
    id: 'uniform_large_radius',
    severity: 'warning',
    source: 'v4 §14',
    detail: 'one large radius applied uniformly to everything',
    detect: (input) =>
      input.designSystem.radius_applied_uniformly && input.designSystem.radius_value >= 16,
  },
];

const SAAS_GRADIENT_HUES = new Set(['purple', 'blue', 'indigo', 'violet']);
const EMOJI = /\p{Extended_Pictographic}/u;

export interface SlopViolation {
  readonly id: string;
  readonly severity: BanSeverity;
  readonly detail: string;
  readonly where?: string;
  readonly snippet?: string;
  readonly source: string;
}

export function checkCopyBans(input: SlopInput): SlopViolation[] {
  const out: SlopViolation[] = [];
  for (const [where, text] of Object.entries(input.copy)) {
    for (const ban of BANNED_COPY) {
      const match = ban.pattern.exec(text);
      if (!match) continue;
      out.push({
        id: `banned_copy.${ban.id}`,
        severity: ban.severity,
        detail: 'the copy uses a banned phrase',
        where,
        snippet: match[0],
        source: ban.source,
      });
    }
  }
  return out;
}

export function checkTokenBans(input: SlopInput): SlopViolation[] {
  return BANNED_TOKEN_COMBOS.filter((ban) => ban.detect(input)).map((ban) => ({
    id: `banned_token.${ban.id}`,
    severity: ban.severity,
    detail: ban.detail,
    source: ban.source,
  }));
}

export function checkLayoutBans(input: SlopInput): SlopViolation[] {
  const out: SlopViolation[] = [];

  for (const section of input.sections) {
    if (
      section.family === 'hero' &&
      section.background === 'gradient' &&
      section.hues.every((hue) => SAAS_GRADIENT_HUES.has(hue)) &&
      section.hues.length > 0
    ) {
      out.push({
        id: 'banned_layout.gradient_saas_hero',
        severity: 'blocking',
        detail: 'a purple-blue gradient hero',
        where: section.instance_id,
        source: 'v4 §14',
      });
    }

    if (
      section.item_count === 3 &&
      section.align === 'center' &&
      section.item_media === 'line_icon'
    ) {
      out.push({
        id: 'banned_layout.icon_card_triplet',
        severity: 'blocking',
        detail: 'three centred cards with line icons',
        where: section.instance_id,
        source: 'v4 §14',
      });
    }

    if (
      section.family === 'hero' &&
      section.align === 'center' &&
      section.cta_count === 2 &&
      section.media === 'none'
    ) {
      out.push({
        id: 'banned_layout.centered_twin_cta_hero',
        severity: 'blocking',
        detail: 'a centred hero with two calls to action and no media',
        where: section.instance_id,
        source: 'v4 §14',
      });
    }

    if (section.list_markers.some((marker) => EMOJI.test(marker))) {
      out.push({
        id: 'banned_layout.emoji_bullets',
        severity: 'blocking',
        detail: 'emoji used as list markers',
        where: section.instance_id,
        source: 'v4 §14',
      });
    }

    for (const effect of section.effect_ids) {
      if (BANNED_EFFECTS.includes(effect)) {
        out.push({
          id: `banned_effect.${effect}`,
          severity: 'blocking',
          detail: `the arrangement pulls in the "${effect}" effect`,
          where: section.instance_id,
          source: 'harvested: Aceternity registry, MagicUI, SYNTHESIS §7.3',
        });
      }
    }

    for (const className of section.css_classes) {
      const hit = BANNED_CLASS_FINGERPRINTS.find((fingerprint) => className.includes(fingerprint));
      if (hit) {
        out.push({
          id: `banned_class.${hit}`,
          severity: 'blocking',
          detail: `the markup carries the "${hit}" fingerprint`,
          where: section.instance_id,
          snippet: className,
          source: 'harvested: tutorial builder prompts',
        });
      }
    }
  }

  return out;
}

/**
 * Art direction violations. `ungraded_asset` is the one that separates an art-directed site from
 * a collage, and `synthetic_person` is non-overridable.
 */
export function checkArtDirection(input: SlopInput): SlopViolation[] {
  const out: SlopViolation[] = [];

  for (const asset of input.assets) {
    if (asset.grade_id !== input.artDirection.grade_id) {
      out.push({
        id: 'art_direction.ungraded_asset',
        severity: 'blocking',
        detail: `asset carries grade "${asset.grade_id ?? 'none'}" rather than the site's "${input.artDirection.grade_id}"`,
        where: asset.asset_id,
        source: 'v4 §14',
      });
    }

    const allowed = input.artDirection.allowed_aspects;
    if (allowed.length > 0 && !allowed.some((aspect) => Math.abs(aspect - asset.aspect) < 0.02)) {
      out.push({
        id: 'art_direction.mixed_crop_grammar',
        severity: 'blocking',
        detail: `aspect ${asset.aspect.toFixed(2)} is outside the art direction's crop grammar`,
        where: asset.asset_id,
        source: 'v4 §14',
      });
    }

    const forbidden = asset.tags.filter((tag) => input.artDirection.forbidden_tags.includes(tag));
    if (forbidden.length > 0) {
      out.push({
        id: 'art_direction.forbidden_photo_tag',
        severity: 'blocking',
        detail: `the asset is tagged ${forbidden.join(', ')}, which this art direction forbids`,
        where: asset.asset_id,
        source: 'v4 §14',
      });
    }

    const depictsPerson = asset.tags.includes('person') || asset.tags.includes('portrait');
    if (asset.ai_generated && depictsPerson) {
      out.push({
        id: 'art_direction.synthetic_person',
        severity: 'blocking',
        detail: 'a generated image depicting a person, which is never allowed',
        where: asset.asset_id,
        source: 'v4 §4 — non-overridable',
      });
    }
  }

  return out;
}

export interface RulePack {
  readonly version: string;
  readonly violations: readonly SlopViolation[];
  readonly hasFatal: boolean;
  readonly canShip: boolean;
}

export const TIER1_VERSION = 'anti-slop@1';

export function runTier1(input: SlopInput): RulePack {
  const violations = [
    ...checkCopyBans(input),
    ...checkTokenBans(input),
    ...checkLayoutBans(input),
    ...checkArtDirection(input),
  ];
  const hasFatal = violations.some((violation) => violation.severity === 'blocking');
  return { version: TIER1_VERSION, violations, hasFatal, canShip: !hasFatal };
}
