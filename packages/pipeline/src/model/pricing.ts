/**
 * Model pricing — the thing the USD ceiling actually depends on.
 *
 * The budget guard in `wrapper.ts` stops a run at `max_cost_usd`. That guard is only as good as
 * the number each call reports, and a provider's HTTP response gives token counts, not money. So
 * something has to turn tokens into dollars, and that something is this file.
 *
 * **Prices are supplied, never baked in.** Every rate below would be a guess at a number that
 * changes without notice, and a stale price book does not fail — it quietly under-reports, and a
 * run sails past a ceiling the operator believes is holding. So the default book is empty and a
 * model with no entry is an **error**, not a zero. An operator supplies real rates from the
 * provider's own pricing page, through `ADA_PRICE_BOOK` or explicitly.
 *
 * The one exception is a local model, which genuinely costs nothing per token. That is why the
 * wall-clock ceiling exists: a local run is free and can still never finish.
 */

export interface ModelPrice {
  /** USD per million input tokens. */
  readonly inputPerMillion: number;
  /** USD per million output tokens. */
  readonly outputPerMillion: number;
}

export type PriceBook = Readonly<Record<string, ModelPrice>>;

export class UnpricedModelError extends Error {
  constructor(key: string) {
    super(
      `no price is recorded for ${key}, so its spend cannot be counted against the run ceiling. ` +
        'Add it to the price book (ADA_PRICE_BOOK, or the `prices` option) using the rate from ' +
        'the provider’s pricing page. A missing price is an error rather than zero because a ' +
        'zero would let a run pass a ceiling the operator believes is holding.',
    );
    this.name = 'UnpricedModelError';
  }
}

/** `provider/model`, lower-cased. One key shape so a router can look up across providers. */
export function priceKey(provider: string, model: string): string {
  return `${provider}/${model}`.toLowerCase();
}

/**
 * Local inference is free per token by construction, not by price lookup. Listed by provider
 * name rather than by model, because the set of local models is open.
 */
export const FREE_PROVIDERS: readonly string[] = ['ollama', 'local'];

export function costOf(
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
  prices: PriceBook,
): number {
  if (FREE_PROVIDERS.includes(provider.toLowerCase())) return 0;

  const key = priceKey(provider, model);
  const price = prices[key];
  if (price === undefined) throw new UnpricedModelError(key);

  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion
  );
}

export class PriceBookError extends Error {
  constructor(reason: string) {
    super(`ADA_PRICE_BOOK is not usable: ${reason}`);
    this.name = 'PriceBookError';
  }
}

/**
 * Parse a price book from JSON: `{"openai/gpt-x": {"inputPerMillion": 1.5, ...}}`.
 *
 * Malformed input throws. A price book that silently degrades to empty is the same failure as a
 * missing price, arriving one step earlier and harder to see.
 */
export function parsePriceBook(raw: string | undefined): PriceBook {
  if (raw === undefined || raw.trim() === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PriceBookError(error instanceof Error ? error.message : 'invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PriceBookError('expected an object of {"provider/model": {…}}');
  }

  const book: Record<string, ModelPrice> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as Partial<ModelPrice>;
    for (const field of ['inputPerMillion', 'outputPerMillion'] as const) {
      const amount = entry[field];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        throw new PriceBookError(`${key}.${field} must be a non-negative number`);
      }
    }
    book[key.toLowerCase()] = {
      inputPerMillion: entry.inputPerMillion as number,
      outputPerMillion: entry.outputPerMillion as number,
    };
  }
  return book;
}

export function loadPriceBook(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PriceBook {
  return parsePriceBook(env['ADA_PRICE_BOOK']);
}
