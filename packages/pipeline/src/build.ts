/**
 * The build: the sixteen stages, wired (v4 §13, ARCHITECTURE §5).
 *
 * Everything here is deterministic given (registry, library, seed). The four model calls go
 * through the wrapper, whose schema enums *are* the eligible sets, so a model cannot name a
 * section that does not exist however it is prompted. The rest is code.
 *
 * The output is three documents, and it is worth being clear about which is which:
 *
 * - `SiteDefinition` is what renders;
 * - `DecisionManifest` is why, projected from the predicate snapshot;
 * - `GapReport` is what the owner can go and change, which is the same information read forwards.
 */
import { evaluatePredicates, stableHash, type PredicateSnapshot } from '@ada/contract';

import {
  compatFilter,
  computeEligibleSets,
  eligibleArchetypes,
  eligibleArrangements,
  eligibleVariants,
  rankCandidates,
  type CompatContext,
} from './eligibility.js';
import {
  allPredicates,
  type ArchetypeView,
  type LibraryView,
  type VariantView,
} from './library-view.js';
import {
  intensityOf,
  validateAssembly,
  blockingViolations,
  type PlacedSection,
} from './assembly.js';
import { buildManifest, ruledOutFor, type Decision, type DecisionManifest } from './manifest.js';
import { buildGapReport, type GapReport, type UnlockKind } from './gap-report.js';
import { runTier1, type SlopInput } from './antislop/tier1.js';
import { join } from 'node:path';

import { detectTier3, tier3Blocks, type BuildSample } from './antislop/tier3.js';
import { appendProposals, runTier2, tier2Records, type Tier2Result } from './antislop/tier2.js';
import {
  MemoryMemoStore,
  callRecord,
  select,
  type BudgetLedger,
  type ModelProvider,
} from './model/wrapper.js';
import {
  appendEvent,
  newRun,
  resolveBudgets,
  type Budgets,
  type ModelCallRecord,
  type PipelineState,
  type Substitution,
} from './state.js';

export interface SlotPlan {
  readonly slot: string;
  readonly kind: 'fact' | 'asset' | 'generated';
  readonly fact_id?: string;
  readonly asset_id?: string;
  readonly text?: string;
  readonly grounded_in?: readonly string[];
}

/**
 * What the caller must supply per variant so the populate stage can bind slots. Kept as an input
 * rather than derived, because a slot's *content* is a product decision and the pipeline's job is
 * to enforce that it is grounded, not to invent it.
 */
export type SlotPlanner = (input: {
  variant: VariantView;
  instanceId: string;
  beatId: string;
}) => readonly SlotPlan[];

export interface BuildInput {
  readonly runId: string;
  readonly siteId: string;
  readonly tenantId: string;
  readonly niche: string;
  readonly locale: string;
  readonly origin: string;
  readonly seed: number;
  /** Owner-declared. The pipeline never infers it (v4 §6). */
  readonly positioning: string;
  readonly registry: unknown;
  readonly library: LibraryView;
  readonly provider: ModelProvider;
  readonly slotPlanner: SlotPlanner;
  readonly seo: Record<string, unknown>;
  readonly assets: Record<string, unknown>;
  readonly legal: Record<string, string>;
  /** Scaffold sections are admitted only when this is a fixture build (ARCHITECTURE §10). */
  readonly allowScaffold?: boolean;
  /** Omitted, the ceilings come from `resolveBudgets()`: environment first, then the defaults. */
  readonly budgets?: Partial<Budgets>;
  /** The last hundred builds, for tier 3. Empty on a first build. */
  readonly recentBuilds?: readonly BuildSample[];
  /**
   * The tier-2 cliché judge. **Opt in.** Tier 2 cannot block and cannot change the output, so it
   * is the one model call in the run that buys nothing for this build — it exists to grow tier 1
   * for the next hundred. Making it default-on would spend budget on every build for a benefit
   * that accrues to a reviewer, and would make the fixture's call count depend on a tier that is
   * explicitly not reproducible.
   */
  readonly tier2Judge?: ModelProvider;
  /**
   * Where proposals are appended. Defaults to `_proposed/anti-slop-bans.jsonl` under the working
   * directory. Nothing reads this file back: promotion to tier 1 is a human editing `tier1.ts`.
   */
  readonly tier2ProposalPath?: string;
}

export interface BuildResult {
  readonly state: PipelineState;
  readonly siteDefinition: Record<string, unknown>;
  readonly siteDefinitionHash: string;
  readonly manifest: DecisionManifest;
  readonly gapReport: GapReport;
  readonly snapshot: PredicateSnapshot;
  readonly sections: readonly PlacedSection[];
  /**
   * Tier 2's verdict. Always present, so a caller can tell "the judge was not asked" from "the
   * judge found nothing" — which are the two readings of an absent field and mean opposite things.
   */
  readonly tier2: Tier2Result;
}

export class BuildFailed extends Error {
  constructor(
    message: string,
    readonly state: PipelineState,
  ) {
    super(message);
    this.name = 'BuildFailed';
  }
}

function requiresIndex(library: LibraryView): {
  archetypes: Map<string, readonly string[]>;
  artDirections: Map<string, readonly string[]>;
  positions: Map<string, readonly string[]>;
  variants: Map<string, readonly string[]>;
} {
  return {
    archetypes: new Map(library.archetypes.map((a) => [a.id, a.requires])),
    artDirections: new Map(library.artDirections.map((a) => [a.id, a.requires])),
    positions: new Map(library.positions.map((p) => [p.id, p.requires])),
    variants: new Map(library.variants.map((v) => [v.id, v.requires])),
  };
}

/** Stage 16's input and the telemetry key: the quantised shape of the page. */
export function sectionSequenceHash(sections: readonly PlacedSection[]): string {
  return sections.map((s) => `${s.variant.id}#${s.arrangement_id}`).join('|');
}

export async function runBuild(input: BuildInput): Promise<BuildResult> {
  // One source for the ceilings. The previous literal here was a second copy of DEFAULT_BUDGETS
  // and would have drifted from it the first time either changed.
  const budgets = resolveBudgets(process.env, input.budgets ?? {});
  let state = newRun({
    run_id: input.runId,
    site_id: input.siteId,
    tenant_id: input.tenantId,
    seed: input.seed,
    niche: input.niche,
    registry: input.registry,
    positioning: input.positioning,
    budgets,
  });

  const ledger: BudgetLedger = {
    calls: 0,
    cost_usd: 0,
    max_calls: budgets.max_model_calls,
    max_cost_usd: budgets.max_cost_usd,
    started_at_ms: Date.now(),
    max_wall_clock_ms: budgets.max_wall_clock_ms,
  };
  const memo = new MemoryMemoStore();
  const modelCalls: ModelCallRecord[] = [];
  const substitutions: Substitution[] = [];
  const decisions: Decision[] = [];
  const scaffold = input.allowScaffold === true;

  // ---- 1-2. ingest + evaluate_predicates ---------------------------------------------------
  // One evaluation pass. Everything downstream reads the snapshot, never the registry, so two
  // stages can never disagree about what the evidence says.
  const snapshot = evaluatePredicates(allPredicates(input.library), input.registry);
  state = appendEvent(
    { ...state, stage: 'evaluate_predicates', snapshot },
    'StageCompleted',
    'evaluate_predicates',
    {
      evaluated: snapshot.length,
    },
  );

  const index = requiresIndex(input.library);
  const eligible = computeEligibleSets(input.library, snapshot, { allowScaffold: scaffold });
  state = appendEvent({ ...state, eligible }, 'StageCompleted', 'ingest');

  // ---- 3-4. playbook + positioning ---------------------------------------------------------
  const playbook = input.library.playbooks.find((p) => p.id === input.niche);
  if (!playbook) throw new BuildFailed(`no playbook for niche "${input.niche}"`, state);
  if (!playbook.supported_positions.includes(input.positioning)) {
    throw new BuildFailed(
      `positioning "${input.positioning}" is not supported by the ${playbook.id} playbook`,
      state,
    );
  }
  const positioning = input.library.positions.find((p) => p.id === input.positioning);
  if (!positioning) throw new BuildFailed(`no positioning asset "${input.positioning}"`, state);
  state = appendEvent(
    { ...state, playbook_id: playbook.id, stage: 'positioning' },
    'StageCompleted',
    'positioning',
  );

  // ---- 5. creative direction (model) -------------------------------------------------------
  const archetypeIds = eligibleArchetypes(input.library, snapshot, { allowScaffold: scaffold }).map(
    (a) => a.id,
  );
  const fallbackArchetype = archetypeIds.includes('service_clarity')
    ? 'service_clarity'
    : (archetypeIds[0] as string);

  const creativeFields = {
    design_system_id: eligible.design_systems,
    art_direction_id: eligible.art_directions,
    page_archetype: archetypeIds,
  };

  const started = Date.now();
  const creativeRequest = {
    stage: 'creative_direction',
    fields: creativeFields,
    promptFragments: [
      'Choose a design system, an art direction and a page archetype for this business.',
      `niche: ${input.niche}`,
      `positioning: ${input.positioning}`,
      `playbook prefers: ${playbook.preferred_archetypes.join(', ')}`,
    ],
    seed: input.seed,
    fallback: {
      design_system_id: eligible.design_systems[0] as string,
      art_direction_id: eligible.art_directions[0] as string,
      page_archetype: fallbackArchetype,
    },
  };
  const creativeOutcome = await select(creativeRequest, { provider: input.provider, memo, ledger });
  modelCalls.push(
    callRecord({
      call_id: `${input.runId}_cd`,
      stage: 'creative_direction',
      outcome: creativeOutcome,
      request: creativeRequest,
      duration_ms: Date.now() - started,
    }) as ModelCallRecord,
  );

  if (creativeOutcome.kind === 'budget_exceeded' || creativeOutcome.kind === 'stuck') {
    throw new BuildFailed(
      `creative direction ${creativeOutcome.kind}: ${creativeOutcome.reason}`,
      state,
    );
  }

  const direction = {
    design_system_id: creativeOutcome.value['design_system_id'] as string,
    art_direction_id: creativeOutcome.value['art_direction_id'] as string,
    page_archetype: creativeOutcome.value['page_archetype'] as string,
  };

  const ruledOutArchetypes = input.library.archetypes
    .map((a) => a.id)
    .filter((id) => !archetypeIds.includes(id));
  decisions.push({
    stage: 'page_archetype',
    chosen: direction.page_archetype,
    eligible_were: archetypeIds,
    ruled_out: ruledOutFor(ruledOutArchetypes, index.archetypes, snapshot),
    influenced_by: { positioning: input.positioning, playbook: playbook.id },
  });

  const ruledOutArtDirections = input.library.artDirections
    .map((a) => a.id)
    .filter((id) => !eligible.art_directions.includes(id));
  decisions.push({
    stage: 'art_direction',
    chosen: direction.art_direction_id,
    eligible_were: [...eligible.art_directions],
    ruled_out: ruledOutFor(ruledOutArtDirections, index.artDirections, snapshot),
    influenced_by: { positioning: input.positioning },
  });

  decisions.push({
    stage: 'positioning',
    chosen: input.positioning,
    eligible_were: [...eligible.positions],
    ruled_out: ruledOutFor(
      input.library.positions.map((p) => p.id).filter((id) => !eligible.positions.includes(id)),
      index.positions,
      snapshot,
    ),
    influenced_by: { declared_by: 'owner' },
  });

  const designSystem = input.library.designSystems.find((s) => s.id === direction.design_system_id);
  const artDirection = input.library.artDirections.find((a) => a.id === direction.art_direction_id);
  if (!designSystem || !artDirection) {
    throw new BuildFailed('creative direction selected an asset that is not in the library', state);
  }
  const archetype = input.library.archetypes.find((a) => a.id === direction.page_archetype);
  if (!archetype) throw new BuildFailed(`no archetype "${direction.page_archetype}"`, state);

  state = appendEvent(
    { ...state, creative_direction: direction },
    'StageCompleted',
    'creative_direction',
  );

  // ---- 6-7. compat filter + beat selection (model) -----------------------------------------
  const compatContext: CompatContext = { direction, designSystem, positioning, artDirection };
  const variants = eligibleVariants(input.library, snapshot, { allowScaffold: scaffold });

  const beatFields: Record<string, readonly string[]> = {};
  const beatFallback: Record<string, string> = {};
  const beatRetreat: Record<string, string> = {};
  const usedNoveltyClasses = new Set<string>();

  for (const [beatIndex, beat] of archetype.beats.entries()) {
    const role = archetype.rhythm_profile.roles[beatIndex] ?? null;
    const result = compatFilter(variants, beat.families, beat.id, role, compatContext);
    if (result.exhausted) {
      // Never relax `requires`. The next move is a sibling archetype, then failure.
      throw new BuildFailed(
        `beat "${beat.id}" has no eligible section after the full retreat order; the remaining ` +
          `move is a sibling archetype (${archetype.siblings.join(', ') || 'none'}), never relaxing requires`,
        state,
      );
    }
    const ranked = rankCandidates(result.candidates, {
      snapshot,
      playbookBoosts: playbook.section_boosts,
      usedNoveltyClasses,
    });
    beatFields[beat.id] = ranked.map((v) => v.id);
    beatFallback[beat.id] = ranked[0]?.id as string;
    beatRetreat[beat.id] = result.retreatedTo;
  }

  const beatRequest = {
    stage: 'beat_selection',
    fields: beatFields,
    promptFragments: [
      'Choose one section variant for each beat of the page.',
      `archetype: ${archetype.id}`,
      `positioning: ${input.positioning}`,
    ],
    seed: input.seed,
    fallback: beatFallback,
  };
  const beatStarted = Date.now();
  const beatOutcome = await select(beatRequest, { provider: input.provider, memo, ledger });
  modelCalls.push(
    callRecord({
      call_id: `${input.runId}_beats`,
      stage: 'beat_selection',
      outcome: beatOutcome,
      request: beatRequest,
      duration_ms: Date.now() - beatStarted,
    }) as ModelCallRecord,
  );
  if (beatOutcome.kind === 'budget_exceeded' || beatOutcome.kind === 'stuck') {
    throw new BuildFailed(`beat selection ${beatOutcome.kind}: ${beatOutcome.reason}`, state);
  }

  // ---- 8. arrangement (model) --------------------------------------------------------------
  const chosenVariants = new Map<string, VariantView>();
  const arrangementFields: Record<string, readonly string[]> = {};
  const arrangementFallback: Record<string, string> = {};
  const instanceIdFor = (beatId: string): string => `s_${beatId}`;

  for (const beat of archetype.beats) {
    const variantId = beatOutcome.value[beat.id] as string;
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) throw new BuildFailed(`beat selection chose unknown variant ${variantId}`, state);
    chosenVariants.set(beat.id, variant);

    const options = eligibleArrangements(variant, snapshot);
    if (options.length === 0) {
      throw new BuildFailed(
        `variant ${variant.id} has no arrangement the registry satisfies`,
        state,
      );
    }
    arrangementFields[instanceIdFor(beat.id)] = options.map((a) => a.id);
    arrangementFallback[instanceIdFor(beat.id)] = options[0]?.id as string;
  }

  const arrangementRequest = {
    stage: 'arrangement',
    fields: arrangementFields,
    promptFragments: ['Choose one arrangement for each selected section.', `seed: ${input.seed}`],
    seed: input.seed,
    fallback: arrangementFallback,
  };
  const arrStarted = Date.now();
  const arrangementOutcome = await select(arrangementRequest, {
    provider: input.provider,
    memo,
    ledger,
  });
  modelCalls.push(
    callRecord({
      call_id: `${input.runId}_arr`,
      stage: 'arrangement',
      outcome: arrangementOutcome,
      request: arrangementRequest,
      duration_ms: Date.now() - arrStarted,
    }) as ModelCallRecord,
  );
  if (arrangementOutcome.kind === 'budget_exceeded' || arrangementOutcome.kind === 'stuck') {
    throw new BuildFailed(
      `arrangement ${arrangementOutcome.kind}: ${arrangementOutcome.reason}`,
      state,
    );
  }

  // ---- 9. assemble -------------------------------------------------------------------------
  const sections: PlacedSection[] = archetype.beats.map((beat, beatIndex) => {
    const variant = chosenVariants.get(beat.id) as VariantView;
    const instanceId = instanceIdFor(beat.id);
    const arrangementId = arrangementOutcome.value[instanceId] as string;
    const arrangement = variant.arrangements.find((a) => a.id === arrangementId);
    return {
      instance_id: instanceId,
      beat_id: beat.id,
      variant,
      arrangement_id: arrangementId,
      rhythm_role: archetype.rhythm_profile.roles[beatIndex] ?? 'explanation',
      intensity: intensityOf(variant),
      is_signature: variant.composition.focal_weight === 3 && arrangement?.signature_move !== null,
    };
  });

  const assemblyViolations = validateAssembly(sections, archetype, {
    bias: positioning.rhythm_bias,
  });
  const blocking = blockingViolations(assemblyViolations);
  if (blocking.length > 0) {
    throw new BuildFailed(
      `assembly rejected the page: ${blocking.map((v) => `${v.code} (${v.detail})`).join('; ')}`,
      state,
    );
  }
  state = appendEvent(state, 'StageCompleted', 'assemble', {
    warnings: assemblyViolations.length - blocking.length,
  });

  // ---- 10. populate ------------------------------------------------------------------------
  const siteSections: Record<string, unknown> = {};
  const copyForSlop: Record<string, string> = {};
  const generatedCopy: string[] = [];

  for (const section of sections) {
    const plans = input.slotPlanner({
      variant: section.variant,
      instanceId: section.instance_id,
      beatId: section.beat_id,
    });
    const slots: Record<string, unknown> = {};

    for (const plan of plans) {
      if (plan.kind === 'fact') slots[plan.slot] = { kind: 'fact', fact_id: plan.fact_id };
      else if (plan.kind === 'asset') slots[plan.slot] = { kind: 'asset', asset_id: plan.asset_id };
      else {
        slots[plan.slot] = {
          kind: 'generated',
          text: plan.text ?? '',
          grounded_in: plan.grounded_in ?? [],
        };
        copyForSlop[`${section.instance_id}.${plan.slot}`] = plan.text ?? '';
        generatedCopy.push(plan.text ?? '');
      }
    }

    siteSections[section.instance_id] = {
      family: section.variant.family,
      instance_id: section.instance_id,
      variant_id: section.variant.id,
      arrangement_id: section.arrangement_id,
      schema_version: 1,
      slots,
      motion: {
        pattern: section.variant.motion_pattern,
        tier: 'tier_0',
        trigger: 'load',
        density: section.variant.motion_density,
        budget_ms: 0,
        main_thread_ms_est: 0,
        reduced_motion_fallback: 'poster',
      },
      computed: {
        intensity: section.intensity,
        focal_weight: section.variant.composition.focal_weight,
        density: section.variant.composition.density,
        approx_vh: section.variant.composition.approx_vh,
        background_weight: section.variant.composition.background_weight,
        is_signature: section.is_signature,
      },
    };
  }

  // ---- 11. anti-slop, tiers 1 and 3 --------------------------------------------------------
  const slopInput: SlopInput = {
    copy: copyForSlop,
    designSystem: {
      heading_font: 'reference-heading',
      body_font: 'reference-body',
      radius_applied_uniformly: false,
      radius_value: 2,
    },
    sections: sections.map((section) => ({
      instance_id: section.instance_id,
      family: section.variant.family,
      background: section.variant.composition.background_weight,
      hues: [],
      align: 'left',
      cta_count: section.variant.family === 'cta' ? 1 : 0,
      media: section.variant.composition.background_weight === 'image' ? 'photo' : 'none',
      item_count: 0,
      item_media: 'none',
      list_markers: [],
      effect_ids: [],
      css_classes: [],
    })),
    assets: Object.values(input.assets).map((asset) => {
      const record = asset as Record<string, unknown>;
      return {
        asset_id: String(record['asset_id']),
        grade_id: (record['grade_id'] as string) ?? null,
        aspect: Number(record['aspect']),
        tags: (record['tags'] as string[]) ?? [],
        ai_generated: record['ai_generated'] === true,
      };
    }),
    artDirection: {
      grade_id: artDirection.grade_id,
      allowed_aspects: [1.5, 0.8],
      forbidden_tags: ['stock_gesture'],
    },
  };

  const tier1 = runTier1(slopInput);
  if (tier1.hasFatal) {
    throw new BuildFailed(
      `anti-slop tier 1 blocked the build: ${tier1.violations
        .filter((v) => v.severity === 'blocking')
        .map((v) => v.id)
        .join(', ')}`,
      state,
    );
  }

  const sequenceHash = sectionSequenceHash(sections);
  const candidate: BuildSample = {
    build_id: input.runId,
    copy: generatedCopy,
    section_sequence_hash: sequenceHash,
    proper_nouns: [],
  };
  const tier3Flags = detectTier3(input.recentBuilds ?? []);
  const tier3Hits = tier3Blocks(candidate, tier3Flags);
  if (tier3Hits.length > 0) {
    throw new BuildFailed(
      `anti-slop tier 3 blocked the build: ${tier3Hits.map((f) => f.value).join('; ')}`,
      state,
    );
  }
  // Tier 2 runs last of the three and after both blocking tiers have passed. Judging copy that
  // tier 1 was about to reject would spend a call to produce advice about a build that is not
  // shipping.
  const tier2: Tier2Result =
    input.tier2Judge === undefined
      ? {
          judged: false,
          proposals: [],
          skipped: 'no tier-2 judge was configured for this run',
          cost_usd: 0,
        }
      : // `copyForSlop`, not `generatedCopy`: the flat array has no slot, and a proposal that
        // cannot say where a phrase came from is not reviewable.
        await runTier2({ provider: input.tier2Judge, copy: copyForSlop, ledger });

  if (tier2.proposals.length > 0) {
    // Written here rather than returned for the caller to write, because a proposal queue that
    // depends on every caller remembering to flush it is a queue that stays empty.
    const written = appendProposals(
      input.tier2ProposalPath ?? join('_proposed', 'anti-slop-bans.jsonl'),
      tier2Records(tier2, { runId: input.runId, niche: input.niche }),
    );
    state = appendEvent(state, 'StageCompleted', 'anti_slop', {
      tier2_proposals: tier2.proposals.length,
      tier2_appended: written,
    });
  }

  state = appendEvent(state, 'StageCompleted', 'anti_slop', {
    tier1_warnings: tier1.violations.length,
    tier3_flags: tier3Flags.length,
    // Recorded as a tri-state, not a count: a zero that means "not asked" and a zero that means
    // "nothing found" are the same number and different facts.
    tier2_judged: tier2.judged,
    tier2_proposals: tier2.proposals.length,
    ...(tier2.skipped === undefined ? {} : { tier2_skipped: tier2.skipped }),
  });

  // ---- SiteDefinition ----------------------------------------------------------------------
  const siteDefinition: Record<string, unknown> = {
    schema_version: 1,
    site: {
      id: input.siteId,
      tenant_id: input.tenantId,
      niche: input.niche,
      positioning: input.positioning,
      locale: input.locale,
    },
    pinned: {
      design_system: `${designSystem.id}@${designSystem.version}`,
      art_direction: `${artDirection.id}@${artDirection.version}`,
      playbook: `${playbook.id}@${playbook.version}`,
      library: input.library.commit,
      gate_policy: 'launch@1',
    },
    pages: {
      home: {
        route: '/',
        archetype: archetype.id,
        seo: input.seo,
        order: sections.map((s) => s.instance_id),
        sections: siteSections,
      },
    },
    assets: input.assets,
    legal: input.legal,
    seed: input.seed,
  };

  const siteDefinitionHash = stableHash(siteDefinition);

  // ---- 14-15. manifest + gap report --------------------------------------------------------
  for (const [beatId, retreat] of Object.entries(beatRetreat)) {
    if (retreat === 'none') continue;
    substitutions.push({
      stage: 'compat_filter',
      from: `beat:${beatId}`,
      to: chosenVariants.get(beatId)?.id ?? 'unknown',
      reason: `retreated_to_${retreat}`,
    });
  }

  const manifest = buildManifest({
    build_id: input.runId,
    seed: input.seed,
    pinned: siteDefinition['pinned'] as Record<string, string>,
    decisions,
    snapshot,
    substitutions,
  });

  const ruledOut: { kind: UnlockKind; id: string; requires: readonly string[] }[] = [
    ...input.library.positions
      .filter((p) => !eligible.positions.includes(p.id))
      .map((p) => ({ kind: 'positions' as const, id: p.id, requires: p.requires })),
    ...input.library.archetypes
      .filter((a) => !archetypeIds.includes(a.id))
      .map((a: ArchetypeView) => ({ kind: 'archetypes' as const, id: a.id, requires: a.requires })),
    ...input.library.artDirections
      .filter((a) => !eligible.art_directions.includes(a.id))
      .map((a) => ({ kind: 'art_directions' as const, id: a.id, requires: a.requires })),
    ...input.library.variants
      .filter((v) => !eligible.variants.includes(v.id) && v.requires.length > 0)
      .map((v) => ({ kind: 'sections' as const, id: v.id, requires: v.requires })),
  ];

  const gapReport = buildGapReport({
    build_id: input.runId,
    snapshot,
    ruledOut,
    currentlyUsing: {
      archetype: archetype.id,
      art_direction: artDirection.id,
      positioning: input.positioning,
    },
    missingRequired: [],
  });

  state = appendEvent(
    {
      ...state,
      site_definition: siteDefinition,
      model_calls: modelCalls,
      substitutions,
      cost_usd: ledger.cost_usd,
      status: 'FINISHED',
    },
    'StageCompleted',
    'gap_report',
    { unlocks: gapReport.unlocks.length },
  );

  return {
    state,
    siteDefinition,
    siteDefinitionHash,
    manifest,
    gapReport,
    snapshot,
    sections,
    tier2,
  };
}
