/**
 * Assembly: composition, narrative and rhythm (v4 §7, §15).
 *
 * Rhythm is the part that separates an intentional page from four heavy bands in a row that each
 * satisfy their local constraints. Intensity is computed from fields the variant already carries,
 * so it needs no new authoring and cannot drift from what the section actually is.
 *
 * Violations are repaired by substitution, never by a model call.
 */
import type { ArchetypeView, VariantView } from './library-view.js';

const DENSITY_SCORE: Record<string, number> = { sparse: 0.2, medium: 0.55, dense: 1.0 };

/**
 * v4 §7. Every input already exists on the variant or its arrangement.
 *
 * `0.40 * focal_weight/3 + 0.25 * density + 0.20 * min(vh,100)/100 + 0.15 * motion.density`
 */
export function intensityOf(variant: {
  composition: { density: string; focal_weight: number; approx_vh: number };
  motion_density: number;
}): number {
  const focal = 0.4 * (variant.composition.focal_weight / 3);
  const density = 0.25 * (DENSITY_SCORE[variant.composition.density] ?? 0.55);
  const height = 0.2 * (Math.min(variant.composition.approx_vh, 100) / 100);
  const motion = 0.15 * variant.motion_density;
  return Number((focal + density + height + motion).toFixed(4));
}

export interface PlacedSection {
  readonly instance_id: string;
  readonly beat_id: string;
  readonly variant: VariantView;
  readonly arrangement_id: string;
  readonly rhythm_role: string;
  readonly intensity: number;
  readonly is_signature: boolean;
}

/**
 * True when every section on the page came from a scaffold.
 *
 * This is the one condition under which `no_signature_section` is not a defect but a fact about
 * the library: a signature section is `focal_weight == 3` **and** an arrangement that names a
 * `signature_move`, and only a human may write one (ARCHITECTURE §10). Until the library is
 * authored there is no arrangement in existence that could satisfy the rule, so a page built
 * entirely from scaffolds fails it by construction rather than by composition.
 *
 * Scoping it this narrowly is deliberate. It is not keyed on "is this a fixture build", which
 * would let a fixture build skip the rule even once graded sections existed; the moment one
 * graded arrangement is placed on the page, the rule is blocking again.
 */
export function isScaffoldOnly(sections: readonly PlacedSection[]): boolean {
  return sections.length > 0 && sections.every((section) => section.variant.status === 'scaffold');
}

export const ASSEMBLY_CODES = [
  'min_sections',
  'max_sections',
  'repeat_family',
  'repeat_novelty_class',
  'no_focal_moment',
  'focal_moment_not_first',
  'no_signature_section',
  'too_many_signature_sections',
  'adjacent_density_same',
  'background_weight_run',
  'rhythm_profile_breach',
  'adjacent_intensity_too_close',
  'no_relief_before_offer',
  'peak_not_first',
  'monotonic_decline',
  'narrative_rule',
  'required_beat_unfilled',
] as const;
export type AssemblyCode = (typeof ASSEMBLY_CODES)[number];

export interface AssemblyViolation {
  readonly code: AssemblyCode;
  /** Machine-readable; the manifest templates a sentence from this rather than narrating one. */
  readonly detail: string;
  readonly instance_id?: string;
  readonly actual?: number;
  readonly expected?: number | string;
  readonly severity: 'blocking' | 'warning';
}

export interface CompositionLimits {
  readonly min_sections: number;
  readonly max_sections: number;
  readonly signature_min: number;
  readonly signature_max: number;
  readonly background_weight_run_max: number;
}

export const DEFAULT_LIMITS: CompositionLimits = {
  min_sections: 5,
  max_sections: 9,
  signature_min: 1,
  signature_max: 2,
  background_weight_run_max: 2,
};

export function validateComposition(
  sections: readonly PlacedSection[],
  limits: CompositionLimits = DEFAULT_LIMITS,
): AssemblyViolation[] {
  const out: AssemblyViolation[] = [];
  const scaffoldOnly = isScaffoldOnly(sections);

  if (sections.length < limits.min_sections) {
    out.push({
      code: 'min_sections',
      detail: 'the page has fewer sections than a page is allowed to have',
      actual: sections.length,
      expected: limits.min_sections,
      severity: 'blocking',
    });
  }
  if (sections.length > limits.max_sections) {
    out.push({
      code: 'max_sections',
      detail: 'the page has more sections than a page is allowed to have',
      actual: sections.length,
      expected: limits.max_sections,
      severity: 'blocking',
    });
  }

  const families = new Set<string>();
  const noveltyClasses = new Set<string>();
  for (const section of sections) {
    if (families.has(section.variant.family)) {
      out.push({
        code: 'repeat_family',
        detail: `the ${section.variant.family} family appears twice`,
        instance_id: section.instance_id,
        severity: 'blocking',
      });
    }
    families.add(section.variant.family);

    if (noveltyClasses.has(section.variant.novelty_class)) {
      out.push({
        code: 'repeat_novelty_class',
        detail: `two sections share the novelty class "${section.variant.novelty_class}"`,
        instance_id: section.instance_id,
        severity: 'blocking',
      });
    }
    noveltyClasses.add(section.variant.novelty_class);
  }

  const focal = sections.filter((section) => section.variant.composition.focal_weight === 3);
  if (focal.length === 0) {
    out.push({
      code: 'no_focal_moment',
      detail: 'no section carries focal weight 3, so the page has no moment',
      severity: 'blocking',
    });
  } else if (sections[0]?.variant.composition.focal_weight !== 3) {
    out.push({
      code: 'focal_moment_not_first',
      detail: 'the focal section is not the first one',
      instance_id: focal[0]?.instance_id,
      severity: 'blocking',
    });
  }

  const signatures = sections.filter((section) => section.is_signature);
  if (signatures.length < limits.signature_min) {
    out.push({
      code: 'no_signature_section',
      detail: scaffoldOnly
        ? 'every section on this page is a scaffold, and only a human may write a signature ' +
          'move, so no arrangement that could satisfy this rule exists yet'
        : 'a page needs at least one moment; no arrangement here names a signature move',
      actual: signatures.length,
      expected: limits.signature_min,
      // Blocking the moment any authored section is in play, which is every client build.
      severity: scaffoldOnly ? 'warning' : 'blocking',
    });
  }
  if (signatures.length > limits.signature_max) {
    out.push({
      code: 'too_many_signature_sections',
      detail: 'three or more signature sections means nothing is dominant',
      actual: signatures.length,
      expected: limits.signature_max,
      severity: 'blocking',
    });
  }

  for (let i = 1; i < sections.length; i += 1) {
    const previous = sections[i - 1];
    const current = sections[i];
    if (!previous || !current) continue;
    if (previous.variant.composition.density === current.variant.composition.density) {
      out.push({
        code: 'adjacent_density_same',
        detail: `two adjacent sections are both ${current.variant.composition.density}`,
        instance_id: current.instance_id,
        severity: 'warning',
      });
    }
  }

  let run = 1;
  for (let i = 1; i < sections.length; i += 1) {
    const previous = sections[i - 1];
    const current = sections[i];
    if (!previous || !current) continue;
    if (
      previous.variant.composition.background_weight ===
      current.variant.composition.background_weight
    ) {
      run += 1;
      if (run > limits.background_weight_run_max) {
        out.push({
          code: 'background_weight_run',
          detail: `${run} sections in a row share a background weight`,
          instance_id: current.instance_id,
          actual: run,
          expected: limits.background_weight_run_max,
          severity: 'warning',
        });
      }
    } else {
      run = 1;
    }
  }

  return out;
}

export function validateRhythm(
  sections: readonly PlacedSection[],
  archetype: ArchetypeView,
  bias: 'spacious' | 'neutral' | 'dense' = 'neutral',
): AssemblyViolation[] {
  const out: AssemblyViolation[] = [];
  const shift = bias === 'spacious' ? -0.1 : bias === 'dense' ? 0.05 : 0;
  const { intensity_targets: targets, tolerance } = archetype.rhythm_profile;

  sections.forEach((section, index) => {
    const target = targets[index];
    if (target === undefined) return;
    const adjusted = Math.max(0, Math.min(1, target + shift));
    if (Math.abs(section.intensity - adjusted) > tolerance) {
      out.push({
        code: 'rhythm_profile_breach',
        detail: `section ${index} sits at intensity ${section.intensity}, outside the profile`,
        instance_id: section.instance_id,
        actual: section.intensity,
        expected: adjusted,
        severity: 'warning',
      });
    }
  });

  for (let i = 1; i < sections.length; i += 1) {
    const previous = sections[i - 1];
    const current = sections[i];
    if (!previous || !current) continue;
    if (Math.abs(previous.intensity - current.intensity) < 0.1) {
      out.push({
        code: 'adjacent_intensity_too_close',
        detail: 'two adjacent sections are near-identical in intensity',
        instance_id: current.instance_id,
        actual: Math.abs(previous.intensity - current.intensity),
        expected: 0.1,
        severity: 'warning',
      });
    }
  }

  const offerIndex = sections.findIndex((section) => section.rhythm_role === 'offer');
  if (offerIndex > 0) {
    const reliefBefore = sections.slice(0, offerIndex).some((section) => section.intensity <= 0.3);
    if (!reliefBefore) {
      out.push({
        code: 'no_relief_before_offer',
        detail: 'nothing quiet precedes the offer, so the page arrives at the ask still shouting',
        severity: 'blocking',
      });
    }
  }

  const peak = Math.max(...sections.map((section) => section.intensity));
  if (sections.length > 0 && sections[0]?.intensity !== peak) {
    out.push({
      code: 'peak_not_first',
      detail: 'the loudest section is not the first one',
      actual: sections[0]?.intensity,
      expected: peak,
      severity: 'warning',
    });
  }

  const monotonic = sections.every(
    (section, index) => index === 0 || section.intensity <= (sections[index - 1]?.intensity ?? 1),
  );
  if (monotonic && sections.length > 2) {
    out.push({
      code: 'monotonic_decline',
      detail: 'the page only fades out; it has no second act',
      severity: 'warning',
    });
  }

  return out;
}

export function validateNarrative(
  sections: readonly PlacedSection[],
  archetype: ArchetypeView,
): AssemblyViolation[] {
  const out: AssemblyViolation[] = [];
  const indexOfBeat = (beat: string): number =>
    sections.findIndex((section) => section.beat_id === beat);

  for (const rule of archetype.narrative_rules) {
    switch (rule) {
      case 'evidence_after_mechanism': {
        const evidence = indexOfBeat('evidence');
        const mechanism = indexOfBeat('mechanism');
        if (evidence >= 0 && mechanism >= 0 && evidence < mechanism) {
          out.push({
            code: 'narrative_rule',
            detail: 'evidence appears before the mechanism it is evidence for',
            severity: 'blocking',
          });
        }
        break;
      }
      case 'no_proof_before_problem': {
        const proof = sections.findIndex((section) => section.variant.family === 'proof');
        const problem = indexOfBeat('problem');
        if (proof >= 0 && problem >= 0 && proof < problem) {
          out.push({
            code: 'narrative_rule',
            detail: 'proof appears before the problem it answers',
            severity: 'blocking',
          });
        }
        break;
      }
      case 'single_offer_beat': {
        const offers = sections.filter((section) => section.beat_id === 'offer');
        if (offers.length > 1) {
          out.push({
            code: 'narrative_rule',
            detail: `the page makes ${offers.length} offers`,
            actual: offers.length,
            expected: 1,
            severity: 'blocking',
          });
        }
        break;
      }
      case 'objection_immediately_precedes_offer': {
        const objection = indexOfBeat('objection');
        const offer = indexOfBeat('offer');
        if (objection >= 0 && offer >= 0 && offer - objection !== 1) {
          out.push({
            code: 'narrative_rule',
            detail: 'the objection beat does not immediately precede the offer',
            severity: 'blocking',
          });
        }
        break;
      }
      default:
        // An unknown rule is a library authoring error, surfaced rather than ignored.
        out.push({
          code: 'narrative_rule',
          detail: `the archetype declares an unknown narrative rule "${rule}"`,
          severity: 'blocking',
        });
    }
  }

  for (const beat of archetype.beats) {
    if (!beat.required) continue;
    if (!sections.some((section) => section.beat_id === beat.id)) {
      out.push({
        code: 'required_beat_unfilled',
        detail: `the required beat "${beat.id}" has no section`,
        severity: 'blocking',
      });
    }
  }

  return out;
}

export function validateAssembly(
  sections: readonly PlacedSection[],
  archetype: ArchetypeView,
  options: { bias?: 'spacious' | 'neutral' | 'dense'; limits?: CompositionLimits } = {},
): AssemblyViolation[] {
  return [
    ...validateComposition(sections, options.limits ?? DEFAULT_LIMITS),
    ...validateNarrative(sections, archetype),
    ...validateRhythm(sections, archetype, options.bias ?? 'neutral'),
  ];
}

export function blockingViolations(violations: readonly AssemblyViolation[]): AssemblyViolation[] {
  return violations.filter((violation) => violation.severity === 'blocking');
}
