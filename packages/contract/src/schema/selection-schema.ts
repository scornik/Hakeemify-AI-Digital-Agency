/**
 * Per-build JSON Schema generation (ARCHITECTURE §3).
 *
 * "For every model call, generate a strict JSON Schema whose enums are exactly the eligible
 * ids. The model cannot name an ineligible option because the grammar does not contain it.
 * This is the single most important mechanism in the system; it replaces prompt instruction
 * with structural impossibility."
 *
 * So this module never accepts a catalogue of everything plus a note about what is allowed.
 * It accepts the eligible set and emits a schema that admits nothing else. An empty eligible
 * set is a programming error and throws here rather than producing `enum: []`, which some
 * providers accept and then satisfy with an arbitrary string.
 */

export interface JsonSchemaObject {
  readonly $schema?: string;
  readonly type: 'object';
  readonly properties: Record<string, JsonSchemaNode>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
  readonly description?: string;
}

export type JsonSchemaNode =
  | { readonly type: 'string'; readonly enum: readonly string[]; readonly description?: string }
  | { readonly type: 'string'; readonly maxLength?: number; readonly description?: string }
  | {
      readonly type: 'array';
      readonly items: JsonSchemaNode;
      readonly minItems?: number;
      readonly maxItems?: number;
      readonly description?: string;
    }
  | JsonSchemaObject;

export class EmptyEligibleSetError extends Error {
  constructor(readonly field: string) {
    super(
      `no eligible ids for "${field}": a model call must never be issued with an empty set. ` +
        'Fall back deterministically instead.',
    );
    this.name = 'EmptyEligibleSetError';
  }
}

export interface EnumField {
  readonly name: string;
  /** The eligible ids, exactly. Order is normalised so the schema hashes stably. */
  readonly eligible: readonly string[];
  readonly description?: string;
}

function enumNode(field: EnumField): JsonSchemaNode {
  const unique = [...new Set(field.eligible)].sort();
  if (unique.length === 0) throw new EmptyEligibleSetError(field.name);
  return field.description === undefined
    ? { type: 'string', enum: unique }
    : { type: 'string', enum: unique, description: field.description };
}

/**
 * A strict object schema over enum-only fields. Used for creative direction, beat selection
 * and arrangement selection — every model call whose output is a choice rather than prose.
 */
export function buildSelectionSchema(fields: readonly EnumField[]): JsonSchemaObject {
  const properties: Record<string, JsonSchemaNode> = {};
  for (const field of fields) {
    properties[field.name] = enumNode(field);
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
    required: fields.map((f) => f.name),
    additionalProperties: false,
  };
}

/** Creative direction (pipeline stage 5): three ids, all drawn from eligible sets. */
export function buildCreativeDirectionSchema(eligible: {
  design_system_ids: readonly string[];
  art_direction_ids: readonly string[];
  page_archetypes: readonly string[];
}): JsonSchemaObject {
  return buildSelectionSchema([
    {
      name: 'design_system_id',
      eligible: eligible.design_system_ids,
      description: 'The design system to build on. Selected by id; tokens are never authored here.',
    },
    {
      name: 'art_direction_id',
      eligible: eligible.art_direction_ids,
      description: 'The imagery treatment. One per site.',
    },
    {
      name: 'page_archetype',
      eligible: eligible.page_archetypes,
      description: 'The story the page tells. Its beats are filled in a later call.',
    },
  ]);
}

/** Beat selection (stage 7): one variant id per beat, each from that beat's own eligible set. */
export function buildBeatSelectionSchema(
  beats: readonly { readonly beat_id: string; readonly eligible_variant_ids: readonly string[] }[],
): JsonSchemaObject {
  return buildSelectionSchema(
    beats.map((beat) => ({
      name: beat.beat_id,
      eligible: beat.eligible_variant_ids,
      description: `The section variant that fills the "${beat.beat_id}" beat.`,
    })),
  );
}

/** Arrangement selection (stage 8): one arrangement per chosen section instance. */
export function buildArrangementSchema(
  instances: readonly {
    readonly instance_id: string;
    readonly eligible_arrangement_ids: readonly string[];
  }[],
): JsonSchemaObject {
  return buildSelectionSchema(
    instances.map((instance) => ({
      name: instance.instance_id,
      eligible: instance.eligible_arrangement_ids,
      description: `The arrangement for section "${instance.instance_id}".`,
    })),
  );
}

export interface CopySlotSpec {
  readonly slot: string;
  readonly max_chars: number;
  /** The fact ids this slot is allowed to draw on. Enforced again by the invariant runner. */
  readonly grounded_in: readonly string[];
  readonly description?: string;
}

/**
 * Copy generation (stage 10). The only call whose output is prose rather than an id, and the
 * only one the leash applies to. The schema caps length; the invariant runner decides whether
 * what came back is grounded — a schema cannot express "every number resolves to a fact".
 */
export function buildCopySchema(slots: readonly CopySlotSpec[]): JsonSchemaObject {
  const properties: Record<string, JsonSchemaNode> = {};
  for (const slot of slots) {
    properties[slot.slot] = {
      type: 'string',
      maxLength: slot.max_chars,
      description:
        slot.description ??
        `Copy for "${slot.slot}". Every number, name, date or quotation must come from the ` +
          `supplied facts: ${slot.grounded_in.join(', ')}.`,
    };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
    required: slots.map((s) => s.slot),
    additionalProperties: false,
  };
}

/** Every enum in a schema, keyed by property name. The memo key and the tests both read this. */
export function enumsOf(schema: JsonSchemaObject): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const [name, node] of Object.entries(schema.properties)) {
    if ('enum' in node) out[name] = node.enum;
  }
  return out;
}
