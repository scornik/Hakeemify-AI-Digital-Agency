import { describe, expect, it, vi } from 'vitest';

import {
  MissingBaseUrlError,
  MissingCredentialError,
  PROVIDER_FACTORIES,
  PROVIDER_NAMES,
  ProviderHttpError,
  anthropicProvider,
  geminiProvider,
  ollamaProvider,
  omniRouteProvider,
  openAiProvider,
  openRouterProvider,
  type FetchLike,
} from '../src/model/providers.js';
import {
  COPY_STAGE,
  EmptyRouteError,
  NoProviderAnsweredError,
  SELECTION_STAGES,
  UnknownStageError,
  assertRoutesKnown,
  routedProvider,
  selectionAndCopyRoutes,
} from '../src/model/router.js';
import {
  PriceBookError,
  UnpricedModelError,
  costOf,
  loadPriceBook,
  parsePriceBook,
} from '../src/model/pricing.js';
import { obedientProvider } from '../src/model/fake.js';
import type { ModelProvider, ModelRequest } from '../src/model/wrapper.js';

const request: ModelRequest = {
  schema: {
    type: 'object',
    properties: { variant: { type: 'string', enum: ['hero/a', 'hero/b'] } },
    required: ['variant'],
    additionalProperties: false,
  },
  system: 'Choose one.',
  user: '',
  seed: 7,
};

/** A fetch that records what it was sent and replies with a canned body. */
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  };
  return { calls, fetchLike, sent: () => JSON.parse(String(calls[0]?.init.body)) };
}

const PRICES = { 'openai/m': { inputPerMillion: 1, outputPerMillion: 2 } };

describe('the OpenAI-style providers', () => {
  it('binds the schema with strict json_schema, not a prose instruction', async () => {
    const { fetchLike, sent } = fakeFetch({
      choices: [{ message: { content: '{"variant":"hero/a"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
      model: 'm',
    });
    const provider = openAiProvider({
      model: 'm',
      apiKey: 'k',
      fetch: fetchLike,
      prices: PRICES,
    });
    const response = await provider.complete(request);

    const payload = sent();
    expect(payload.response_format.type).toBe('json_schema');
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(payload.response_format.json_schema.schema.properties.variant.enum).toEqual([
      'hero/a',
      'hero/b',
    ]);
    // Temperature 0 and a seed: a decision that moves between identical runs is not a decision.
    expect(payload.temperature).toBe(0);
    expect(payload.seed).toBe(7);

    expect(response.text).toBe('{"variant":"hero/a"}');
    expect(response.cost_usd).toBeCloseTo(1000 / 1e6 + (500 / 1e6) * 2);
  });

  it('sends OpenRouter to its own base URL with the same protocol', async () => {
    const { fetchLike, calls } = fakeFetch({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      model: 'x',
    });
    await openRouterProvider({
      model: 'x',
      apiKey: 'k',
      fetch: fetchLike,
      prices: { 'openrouter/x': { inputPerMillion: 0, outputPerMillion: 0 } },
    }).complete(request);
    expect(calls[0]?.url).toContain('openrouter.ai');
  });

  it('refuses to call without a key, and names the variable to set', async () => {
    await expect(openAiProvider({ model: 'm' }).complete(request)).rejects.toThrow(
      MissingCredentialError,
    );
    await expect(openAiProvider({ model: 'm' }).complete(request)).rejects.toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it('throws on a non-2xx rather than returning an empty answer', async () => {
    // An empty answer would reach the wrapper as `unparseable_json` and burn a re-ask on what is
    // actually an outage.
    const { fetchLike } = fakeFetch({ error: 'rate limited' }, 429);
    await expect(
      openAiProvider({ model: 'm', apiKey: 'k', fetch: fetchLike }).complete(request),
    ).rejects.toThrow(ProviderHttpError);
  });
});

describe('the Anthropic provider', () => {
  it('forces the shape with a pinned tool, since there is no response_format', async () => {
    const { fetchLike, sent } = fakeFetch({
      content: [{ type: 'tool_use', input: { variant: 'hero/b' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'c',
    });
    const response = await anthropicProvider({
      model: 'c',
      apiKey: 'k',
      fetch: fetchLike,
      prices: { 'anthropic/c': { inputPerMillion: 3, outputPerMillion: 15 } },
    }).complete(request);

    const payload = sent();
    expect(payload.tool_choice).toEqual({ type: 'tool', name: 'selection' });
    expect(payload.tools[0].input_schema.properties.variant.enum).toEqual(['hero/a', 'hero/b']);

    // Re-serialised, so the wrapper sees the same JSON string it gets from every other provider.
    expect(JSON.parse(response.text)).toEqual({ variant: 'hero/b' });
    expect(response.finish_reason).toBe('stop');
  });

  it('surfaces a text block when the tool was not used, rather than an empty string', async () => {
    // Keeps the failure legible: `unparseable_json` on the actual words, not on emptiness.
    const { fetchLike } = fakeFetch({
      content: [{ type: 'text', text: 'I cannot choose.' }],
      stop_reason: 'end_turn',
      model: 'c',
    });
    const response = await anthropicProvider({
      model: 'c',
      apiKey: 'k',
      fetch: fetchLike,
      prices: { 'anthropic/c': { inputPerMillion: 0, outputPerMillion: 0 } },
    }).complete(request);
    expect(response.text).toBe('I cannot choose.');
  });
});

describe('the Ollama provider', () => {
  it('passes the schema as `format` and needs no key', async () => {
    const { fetchLike, sent } = fakeFetch({
      message: { content: '{"variant":"hero/a"}' },
      done: true,
      done_reason: 'stop',
      model: 'local',
    });
    const response = await ollamaProvider({ model: 'local', fetch: fetchLike }).complete(request);
    expect(sent().format.properties.variant.enum).toEqual(['hero/a', 'hero/b']);
    expect(response.finish_reason).toBe('stop');
  });

  it('costs nothing, which is why the wall-clock ceiling exists', async () => {
    const { fetchLike } = fakeFetch({ message: { content: '{}' }, done: true, model: 'local' });
    const response = await ollamaProvider({ model: 'local', fetch: fetchLike }).complete(request);
    expect(response.cost_usd).toBe(0);
  });

  it('treats done:true without a reason as a clean finish', async () => {
    const { fetchLike } = fakeFetch({ message: { content: '{}' }, done: true, model: 'local' });
    const response = await ollamaProvider({ model: 'local', fetch: fetchLike }).complete(request);
    expect(response.finish_reason).toBe('stop');
  });
});

describe('finish reasons', () => {
  it('maps an unrecognised stop reason to error, not to stop', async () => {
    // An unknown terminal state is not a successful one. Calling it `stop` would hand the
    // wrapper a truncated body to validate as though it were complete.
    const { fetchLike } = fakeFetch({
      choices: [{ message: { content: '{' }, finish_reason: 'something_new' }],
      model: 'm',
    });
    const response = await openAiProvider({
      model: 'm',
      apiKey: 'k',
      fetch: fetchLike,
      prices: PRICES,
    }).complete(request);
    expect(response.finish_reason).toBe('error');
  });

  it('maps a length stop to length, so the wrapper reports truncation', async () => {
    const { fetchLike } = fakeFetch({
      choices: [{ message: { content: '{' }, finish_reason: 'length' }],
      model: 'm',
    });
    const response = await openAiProvider({
      model: 'm',
      apiKey: 'k',
      fetch: fetchLike,
      prices: PRICES,
    }).complete(request);
    expect(response.finish_reason).toBe('length');
  });
});

describe('pricing', () => {
  it('refuses to cost a model it has no price for', () => {
    // A zero would let a run sail past a ceiling the operator believes is holding.
    expect(() => costOf('openai', 'unknown', { inputTokens: 1, outputTokens: 1 }, {})).toThrow(
      UnpricedModelError,
    );
  });

  it('says where to get the number', () => {
    let message = '';
    try {
      costOf('openai', 'unknown', { inputTokens: 1, outputTokens: 1 }, {});
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/ADA_PRICE_BOOK/);
    expect(message).toMatch(/pricing page/);
  });

  it('costs a local model at zero without consulting the book', () => {
    expect(costOf('ollama', 'anything', { inputTokens: 1e9, outputTokens: 1e9 }, {})).toBe(0);
  });

  it('is case-insensitive about the key', () => {
    const book = parsePriceBook('{"OpenAI/GPT-X": {"inputPerMillion": 2, "outputPerMillion": 4}}');
    expect(costOf('openai', 'gpt-x', { inputTokens: 1_000_000, outputTokens: 0 }, book)).toBe(2);
  });

  it('throws on a malformed book rather than degrading to empty', () => {
    // Degrading to empty is the same failure as a missing price, one step earlier and harder
    // to see.
    expect(() => parsePriceBook('not json')).toThrow(PriceBookError);
    expect(() => parsePriceBook('[]')).toThrow(PriceBookError);
    expect(() => parsePriceBook('{"a/b": {"inputPerMillion": "free"}}')).toThrow(PriceBookError);
    expect(() => parsePriceBook('{"a/b": {"inputPerMillion": -1, "outputPerMillion": 1}}')).toThrow(
      PriceBookError,
    );
  });

  it('treats an unset variable as an empty book', () => {
    expect(loadPriceBook({})).toEqual({});
    expect(parsePriceBook('')).toEqual({});
  });
});

describe('the router', () => {
  const failing = (name: string): ModelProvider => ({
    name,
    complete() {
      throw new Error(`${name} is down`);
    },
  });

  it('prefers the first provider in the chain', async () => {
    const first = obedientProvider('first');
    const spy = vi.spyOn(first, 'complete');
    await routedProvider('copy', {
      routes: { copy: [first, obedientProvider('second')] },
      fallback: [],
    }).complete(request);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('falls back when a provider could not answer at all', async () => {
    const seen: string[] = [];
    const response = await routedProvider('copy', {
      routes: { copy: [failing('down'), obedientProvider('up')] },
      fallback: [],
      onFallback: (_stage, attempt) => seen.push(attempt.provider),
    }).complete(request);
    expect(seen).toEqual(['down']);
    expect(response.provider).toBe('up');
  });

  it('does NOT fall back on a bad answer', async () => {
    // The rule the whole router rests on. Re-asking is the wrapper's job and it counts against
    // the call budget; a router that retried bad answers would multiply attempts by the chain
    // length behind the ledger's back, and both ceilings would stop meaning anything.
    const nonsense: ModelProvider = {
      name: 'nonsense',
      complete: () => ({
        text: 'not json at all',
        finish_reason: 'stop' as const,
        cost_usd: 0,
        model: 'n',
        provider: 'nonsense',
      }),
    };
    const second = obedientProvider('second');
    const spy = vi.spyOn(second, 'complete');

    const response = await routedProvider('copy', {
      routes: { copy: [nonsense, second] },
      fallback: [],
    }).complete(request);

    expect(response.text).toBe('not json at all');
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports every attempt when nothing answered', async () => {
    const router = routedProvider('copy', {
      routes: { copy: [failing('a'), failing('b')] },
      fallback: [],
    });
    await expect(router.complete(request)).rejects.toThrow(NoProviderAnsweredError);
    await expect(router.complete(request)).rejects.toThrow(/a \(a is down\).*b \(b is down\)/);
  });

  it('uses the fallback chain for a stage with no route', async () => {
    const response = await routedProvider('arrangement', {
      routes: {},
      fallback: [obedientProvider('default')],
    }).complete(request);
    expect(response.text).toBeTruthy();
  });

  it('refuses to build a router that has no provider at all', () => {
    expect(() => routedProvider('copy', { routes: {}, fallback: [] })).toThrow(EmptyRouteError);
  });
});

describe('the routing table', () => {
  it('rejects a stage the pipeline never calls', () => {
    // Without this a typo is invisible: the misspelled entry is never looked up, the real stage
    // silently takes the default chain, and a call quietly goes to the wrong model.
    expect(() => assertRoutesKnown({ beat_selectionn: [] })).toThrow(UnknownStageError);
    expect(() => assertRoutesKnown({ beat_selection: [] })).not.toThrow();
  });

  it('splits selections from copy, which is where the economics differ', () => {
    const cheap = obedientProvider('cheap');
    const good = obedientProvider('good');
    const routes = selectionAndCopyRoutes([cheap], [good]);

    expect(() => assertRoutesKnown(routes)).not.toThrow();
    for (const stage of SELECTION_STAGES) expect(routes[stage]).toEqual([cheap]);
    expect(routes[COPY_STAGE]).toEqual([good]);
  });

  it('names every stage the pipeline actually calls', () => {
    // These strings are matched against `request.stage` in build.ts. A stage missing here falls
    // through to the default chain forever and nobody notices.
    expect([...SELECTION_STAGES]).toEqual([
      'creative_direction',
      'page_archetype',
      'art_direction',
      'positioning',
      'beat_selection',
      'arrangement',
    ]);
  });
});

describe('the Gemini provider', () => {
  it('sends responseSchema and strips additionalProperties, which Gemini rejects', async () => {
    const { fetchLike, sent, calls } = fakeFetch({
      candidates: [
        { content: { parts: [{ text: '{"variant":"hero/a"}' }] }, finishReason: 'STOP' },
      ],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 },
      modelVersion: 'g',
    });
    const response = await geminiProvider({
      model: 'g',
      apiKey: 'k',
      fetch: fetchLike,
      prices: { 'gemini/g': { inputPerMillion: 1, outputPerMillion: 4 } },
    }).complete(request);

    const payload = sent();
    expect(payload.generationConfig.responseMimeType).toBe('application/json');
    expect(payload.generationConfig.responseSchema.properties.variant.enum).toEqual([
      'hero/a',
      'hero/b',
    ]);
    // Gemini's responseSchema is an OpenAPI subset; sending this field is an API error.
    expect(payload.generationConfig.responseSchema).not.toHaveProperty('additionalProperties');
    expect(calls[0]?.url).toContain(':generateContent');

    expect(response.text).toBe('{"variant":"hero/a"}');
    expect(response.cost_usd).toBeCloseTo((200 / 1e6) * 1 + (100 / 1e6) * 4);
  });

  it('concatenates parts rather than taking the first', async () => {
    // The field is a list. Taking parts[0] would truncate silently when it is not one part.
    const { fetchLike } = fakeFetch({
      candidates: [
        {
          content: { parts: [{ text: '{"variant"' }, { text: ':"hero/b"}' }] },
          finishReason: 'STOP',
        },
      ],
      modelVersion: 'g',
    });
    const response = await geminiProvider({
      model: 'g',
      apiKey: 'k',
      fetch: fetchLike,
      prices: { 'gemini/g': { inputPerMillion: 0, outputPerMillion: 0 } },
    }).complete(request);
    expect(JSON.parse(response.text)).toEqual({ variant: 'hero/b' });
  });

  it('maps Gemini’s uppercase finish reasons', async () => {
    for (const [raw, expected] of [
      ['STOP', 'stop'],
      ['MAX_TOKENS', 'length'],
      ['SAFETY', 'content_filter'],
      ['RECITATION', 'content_filter'],
    ] as const) {
      const { fetchLike } = fakeFetch({
        candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: raw }],
        modelVersion: 'g',
      });
      const response = await geminiProvider({
        model: 'g',
        apiKey: 'k',
        fetch: fetchLike,
        prices: { 'gemini/g': { inputPerMillion: 0, outputPerMillion: 0 } },
      }).complete(request);
      expect(response.finish_reason, raw).toBe(expected);
    }
  });

  it('refuses to call without a key', async () => {
    await expect(geminiProvider({ model: 'g' }).complete(request)).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });
});

describe('the Omniroute provider', () => {
  it('refuses to be built without an endpoint, rather than guessing a hostname', async () => {
    // I do not know this service's API. A guessed endpoint that 404s looks like an outage; a
    // missing one that says why does not.
    expect(() => omniRouteProvider({ model: 'm', apiKey: 'k' })).toThrow(MissingBaseUrlError);
    expect(() => omniRouteProvider({ model: 'm', apiKey: 'k' })).toThrow(/ADA_OMNIROUTE_BASE_URL/);
  });

  it('says outright that it assumes the OpenAI protocol', () => {
    // If that assumption is wrong the fix is a new adapter, not a different base URL, and the
    // error has to say so or somebody will spend an afternoon on the URL.
    let message = '';
    try {
      omniRouteProvider({ model: 'm', apiKey: 'k' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/OpenAI-protocol endpoint/);
    expect(message).toMatch(/adapter of its own/);
  });

  it('speaks the OpenAI protocol once given one', async () => {
    const { fetchLike, calls, sent } = fakeFetch({
      choices: [{ message: { content: '{"variant":"hero/a"}' }, finish_reason: 'stop' }],
      model: 'm',
    });
    const response = await omniRouteProvider({
      model: 'm',
      apiKey: 'k',
      baseUrl: 'https://omniroute.example/v1',
      fetch: fetchLike,
      prices: { 'omniroute/m': { inputPerMillion: 0, outputPerMillion: 0 } },
    }).complete(request);

    expect(calls[0]?.url).toBe('https://omniroute.example/v1/chat/completions');
    expect(sent().response_format.json_schema.strict).toBe(true);
    expect(response.provider).toBe('omniroute');
  });
});

describe('the provider registry', () => {
  it('lists every provider the owner named', () => {
    expect([...PROVIDER_NAMES].sort()).toEqual(
      ['anthropic', 'gemini', 'ollama', 'omniroute', 'openai', 'openrouter'].sort(),
    );
    for (const name of PROVIDER_NAMES) {
      expect(PROVIDER_FACTORIES[name], name).toBeTypeOf('function');
    }
  });
});
