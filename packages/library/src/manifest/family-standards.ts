/**
 * Family-tiered authoring standards (v4 §11).
 *
 * Transcribed from the spec, not invented here. The hero is the LCP element and the first 40%
 * of the impression, so it gets more arrangements and more rubric items; proof and CTA get
 * their own extra rubric. These are the numbers the **entry gate** checks — nothing in this
 * file grades anything, it only says what a grade must contain before a variant may enter the
 * library.
 */
import { SECTION_FAMILIES, type SectionFamily } from '@ada/contract';

export interface FamilyStandard {
  readonly min_arrangements: number;
  readonly reviewers: number;
  /** Family-specific rubric keys, all of which must be present and true (v4 §11 entry gate). */
  readonly extra_rubric: readonly string[];
  /** Comparative, family-scoped. Recorded for P7; nothing in P3 computes an ELO. */
  readonly elo_floor_percentile?: number;
  /** v4 §11: the hero gets first call on the diversity budget. */
  readonly diversity_priority?: 'first';
}

const DEFAULT_STANDARD: FamilyStandard = {
  min_arrangements: 3,
  reviewers: 2,
  extra_rubric: [],
};

const OVERRIDES: Partial<Record<SectionFamily, FamilyStandard>> = {
  hero: {
    min_arrangements: 5,
    reviewers: 2,
    elo_floor_percentile: 75,
    diversity_priority: 'first',
    extra_rubric: [
      'works_with_4_word_headline',
      'works_with_12_word_headline',
      'works_with_no_photo',
      'mobile_cta_visible_without_scroll',
      'lcp_element_is_text_or_preloaded_image',
      'holds_up_at_intensity_1.0',
    ],
  },
  proof: {
    min_arrangements: 4,
    reviewers: 2,
    extra_rubric: ['degrades_to_fewer_items', 'no_implied_claim_without_fact'],
  },
  cta: {
    min_arrangements: 3,
    reviewers: 2,
    extra_rubric: ['label_is_specific_not_generic', 'works_under_every_positioning_register'],
  },
};

export const FAMILY_STANDARDS: Readonly<Record<SectionFamily, FamilyStandard>> = Object.fromEntries(
  SECTION_FAMILIES.map((family) => [family, OVERRIDES[family] ?? DEFAULT_STANDARD]),
) as Record<SectionFamily, FamilyStandard>;

export function familyStandard(family: SectionFamily): FamilyStandard {
  return FAMILY_STANDARDS[family];
}
