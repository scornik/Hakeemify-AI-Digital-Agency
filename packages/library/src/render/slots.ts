/**
 * Resolving a slot to the value the renderer may print.
 *
 * The rule the whole system rests on: a slot prints a fact, an asset, or generated copy that
 * already passed the `grounded_in` leash. There is no fourth case, and there is no default. A
 * slot that cannot be resolved throws, because the alternative is a page that ships with a
 * plausible-looking blank where a claim should be.
 */
import type { AssetRef, FactRow, SiteDefinition, SlotValue } from './site.js';

export class UnresolvedSlotError extends Error {
  constructor(path: string, detail: string) {
    super(`slot ${path} cannot be resolved: ${detail}`);
    this.name = 'UnresolvedSlotError';
  }
}

export interface SlotContext {
  readonly definition: SiteDefinition;
  readonly facts: Record<string, FactRow>;
  readonly pageId: string;
  readonly instanceId: string;
}

function factValue(context: SlotContext, slot: SlotValue, path: string): unknown {
  const id = slot.fact_id ?? '';
  const fact = context.facts[id];
  if (!fact) throw new UnresolvedSlotError(path, `no fact "${id}" in the registry`);
  return fact.value;
}

/** The text a slot prints. Objects and arrays are the caller's problem, not this function's. */
export function slotText(
  context: SlotContext,
  slots: Record<string, SlotValue>,
  name: string,
): string {
  const path = `pages.${context.pageId}.sections.${context.instanceId}.slots.${name}`;
  const slot = slots[name];
  if (!slot) throw new UnresolvedSlotError(path, 'the section did not bind this slot');

  if (slot.kind === 'generated') {
    if (typeof slot.text !== 'string')
      throw new UnresolvedSlotError(path, 'generated slot has no text');
    return slot.text;
  }
  if (slot.kind === 'fact') {
    const value = factValue(context, slot, path);
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    throw new UnresolvedSlotError(path, `fact "${slot.fact_id}" is not printable as text`);
  }
  throw new UnresolvedSlotError(path, `a ${slot.kind} slot is not text`);
}

/** A list slot: services, credentials, questions. Returns the raw records for the component. */
export function slotList(
  context: SlotContext,
  slots: Record<string, SlotValue>,
  name: string,
): Record<string, unknown>[] {
  const path = `pages.${context.pageId}.sections.${context.instanceId}.slots.${name}`;
  const slot = slots[name];
  if (!slot) throw new UnresolvedSlotError(path, 'the section did not bind this slot');
  if (slot.kind !== 'fact') throw new UnresolvedSlotError(path, 'a list slot must bind to a fact');

  const value = factValue(context, slot, path);
  if (!Array.isArray(value)) throw new UnresolvedSlotError(path, 'the cited fact is not a list');
  return value as Record<string, unknown>[];
}

export function slotAsset(
  context: SlotContext,
  slots: Record<string, SlotValue>,
  name: string,
): AssetRef {
  const path = `pages.${context.pageId}.sections.${context.instanceId}.slots.${name}`;
  const slot = slots[name];
  if (!slot) throw new UnresolvedSlotError(path, 'the section did not bind this slot');
  if (slot.kind !== 'asset') throw new UnresolvedSlotError(path, 'not an asset slot');

  const asset = context.definition.assets[slot.asset_id ?? ''];
  if (!asset) throw new UnresolvedSlotError(path, `no asset "${slot.asset_id}" in the definition`);
  if (!asset.grade_id) {
    // `ungraded_asset` is a blocking tier-1 check. Failing here means the gate never sees it.
    throw new UnresolvedSlotError(path, `asset "${asset.asset_id}" carries no art direction grade`);
  }
  return asset;
}

export function hasSlot(slots: Record<string, SlotValue>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(slots, name);
}

/**
 * The attributes every editable field carries. Stamped by the section, addressed by the gate,
 * the repair loop, telemetry and the post-V1 editor — all four use the same id.
 */
export function fieldAttrs(
  context: SlotContext,
  name: string,
): { 'data-sd-path': string; 'data-sd-slot': string } {
  return {
    'data-sd-path': `pages.${context.pageId}.sections.${context.instanceId}.slots.${name}`,
    'data-sd-slot': name,
  };
}
