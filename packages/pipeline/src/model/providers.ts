/**
 * Real model providers: OpenRouter, Omniroute, Anthropic, OpenAI, Gemini, Ollama.
 *
 * Each implements the same one-method `ModelProvider` the fakes do, so nothing downstream knows
 * which is answering. What differs between them is one thing that matters and one that does not:
 *
 * **Matters — how you force a JSON shape.** OpenAI takes `response_format.json_schema` with
 * `strict: true`. OpenRouter passes the same field through, but whether the underlying model
 * honours it varies by model, so it is a request rather than a guarantee. Anthropic has no
 * response-format field: the way to force a shape is a single tool with the schema as its input
 * and `tool_choice` pinned to it. Gemini takes `responseSchema`, but only an OpenAPI subset of
 * it — `additionalProperties` is rejected and has to be stripped. Ollama takes the schema
 * directly as `format`.
 *
 * **Does not matter — validation.** None of these is trusted. `wrapper.ts` parses, validates
 * against the eligible enums, and re-asks on failure, whatever the provider claimed to enforce.
 * A provider that ignores its own schema field fails the same way a provider that returns prose
 * does, which is why "support varies by model" is tolerable here and would not be elsewhere.
 *
 * **No retries in this file.** The wrapper owns the re-ask loop and counts every attempt against
 * the call budget. A provider that retried internally would spend budget the ledger cannot see.
 *
 * Nothing here has ever been called against a real endpoint by this repository: there are no
 * credentials in it, and the tests inject a fake `fetch`. What the tests assert is the request
 * each provider builds and how it reads a response back — which is the part that is wrong
 * quietly.
 */
import type { JsonSchemaObject } from '@ada/contract';

import { costOf, type PriceBook } from './pricing.js';
import type { ModelProvider, ModelRequest, ModelResponse } from './wrapper.js';

export const PROVIDER_NAMES = [
  'openrouter',
  'omniroute',
  'anthropic',
  'openai',
  'gemini',
  'ollama',
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** Injected so tests never touch the network, and so a timeout is always ours to set. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ProviderOptions {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly prices?: PriceBook;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
}

export class MissingCredentialError extends Error {
  constructor(provider: string, variable: string) {
    super(
      `${provider} needs an API key and none was given. Set ${variable}, or route this call ` +
        'type to a local model. No key is stored in this repository.',
    );
    this.name = 'MissingCredentialError';
  }
}

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    body: string,
  ) {
    super(`${provider} returned ${status}: ${body.slice(0, 400)}`);
    this.name = 'ProviderHttpError';
  }
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
}

async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: ProviderOptions,
): Promise<unknown> {
  const doFetch = options.fetch ?? (globalThis.fetch as FetchLike);
  // A request with no timeout is a run that hangs, and the wall-clock ceiling would only notice
  // at the next call — which never comes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProviderHttpError(provider, response.status, await response.text());
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a provider's own stop reason onto ours. Anything unrecognised becomes `error` rather than
 * `stop`: an unknown terminal state is not a successful one, and treating it as success would
 * hand the wrapper a truncated body to validate as if it were complete.
 */
function finishReason(raw: string | null | undefined): ModelResponse['finish_reason'] {
  switch (raw) {
    case 'stop':
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence':
    case 'STOP':
      return 'stop';
    case 'length':
    case 'max_tokens':
    case 'MAX_TOKENS':
      return 'length';
    case 'content_filter':
    case 'refusal':
    case 'SAFETY':
    case 'RECITATION':
    case 'PROHIBITED_CONTENT':
      return 'content_filter';
    default:
      return 'error';
  }
}

function schemaWithStrictness(schema: JsonSchemaObject): Record<string, unknown> {
  return { ...schema, additionalProperties: false };
}

// ---------------------------------------------------------------------------------------------
// OpenAI, and OpenRouter which speaks the same protocol
// ---------------------------------------------------------------------------------------------

function openAiStyle(
  provider: ProviderName,
  defaultBaseUrl: string,
  keyVariable: string,
  extraHeaders: (options: ProviderOptions) => Record<string, string>,
): (options: ProviderOptions) => ModelProvider {
  return (options) => ({
    name: provider,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (options.apiKey === undefined || options.apiKey === '') {
        throw new MissingCredentialError(provider, keyVariable);
      }

      const payload = await postJson(
        provider,
        `${options.baseUrl ?? defaultBaseUrl}/chat/completions`,
        { authorization: `Bearer ${options.apiKey}`, ...extraHeaders(options) },
        {
          model: options.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user === '' ? 'Answer now.' : request.user },
          ],
          // `strict: true` is what makes the schema binding rather than advisory. The wrapper
          // validates anyway; this just saves a re-ask on the models that honour it.
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'selection',
              strict: true,
              schema: schemaWithStrictness(request.schema),
            },
          },
          seed: request.seed,
          temperature: 0,
          max_tokens: options.maxOutputTokens ?? 2048,
        },
        options,
      );

      const body = payload as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const choice = body.choices?.[0];
      const usage: Usage = {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      };
      const model = body.model ?? options.model;

      return {
        text: choice?.message?.content ?? '',
        finish_reason: finishReason(choice?.finish_reason),
        cost_usd: costOf(provider, model, usage, options.prices ?? {}),
        model,
        provider,
      };
    },
  });
}

export const openAiProvider = openAiStyle(
  'openai',
  'https://api.openai.com/v1',
  'OPENAI_API_KEY',
  () => ({}),
);

export const openRouterProvider = openAiStyle(
  'openrouter',
  'https://openrouter.ai/api/v1',
  'OPENROUTER_API_KEY',
  () => ({}),
);

export class MissingBaseUrlError extends Error {
  constructor(provider: string, variable: string) {
    super(
      `${provider} has no default endpoint in this repository, so ${variable} (or the ` +
        '`baseUrl` option) must name one. It is registered as an OpenAI-protocol endpoint — ' +
        'chat/completions with response_format.json_schema. If it speaks a different protocol ' +
        'it will fail on the first call and needs an adapter of its own, not a base URL.',
    );
    this.name = 'MissingBaseUrlError';
  }
}

/**
 * Omniroute.
 *
 * **An assumption, stated rather than hidden.** I do not know this service's API. It is
 * registered as an OpenAI-protocol endpoint because that is what aggregators overwhelmingly
 * expose, and because being wrong that way fails loudly on the first call rather than quietly.
 * What I have not done is invent a hostname: there is no default base URL, and
 * `ADA_OMNIROUTE_BASE_URL` must name one. A guessed endpoint that 404s looks like an outage; a
 * missing one that says why does not.
 *
 * If it turns out to speak a different protocol, it needs its own adapter and this should be
 * deleted rather than patched.
 */
export function omniRouteProvider(options: ProviderOptions): ModelProvider {
  if (options.baseUrl === undefined || options.baseUrl === '') {
    throw new MissingBaseUrlError('omniroute', 'ADA_OMNIROUTE_BASE_URL');
  }
  return openAiStyle('omniroute', options.baseUrl, 'ADA_OMNIROUTE_API_KEY', () => ({}))(options);
}

// ---------------------------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------------------------

/**
 * Google's schema field is `responseSchema` and it takes an **OpenAPI subset**, not full JSON
 * Schema. `additionalProperties` is not in that subset and is rejected, so it is stripped here
 * rather than sent — which makes Gemini the one provider that cannot be told "no extra fields"
 * at the API level. That does not matter: `validateSelection` reports `unknown_field` whatever
 * the provider promised, which is the whole reason nothing downstream trusts its enforcement.
 */
function geminiSchema(schema: JsonSchemaObject): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(schema as unknown as Record<string, unknown>) };
  delete rest['additionalProperties'];
  return rest;
}

export function geminiProvider(options: ProviderOptions): ModelProvider {
  return {
    name: 'gemini',
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (options.apiKey === undefined || options.apiKey === '') {
        throw new MissingCredentialError('gemini', 'GEMINI_API_KEY');
      }

      const base = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
      const payload = await postJson(
        'gemini',
        `${base}/models/${options.model}:generateContent`,
        { 'x-goog-api-key': options.apiKey },
        {
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [
            { role: 'user', parts: [{ text: request.user === '' ? 'Answer now.' : request.user }] },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: geminiSchema(request.schema),
            temperature: 0,
            maxOutputTokens: options.maxOutputTokens ?? 2048,
          },
        },
        options,
      );

      const body = payload as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        modelVersion?: string;
      };

      const candidate = body.candidates?.[0];
      // Parts are concatenated: a structured answer usually arrives as one, but the field is a
      // list and taking only the first would silently truncate when it is not.
      const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');
      const model = body.modelVersion ?? options.model;

      return {
        text,
        finish_reason: finishReason(candidate?.finishReason),
        cost_usd: costOf(
          'gemini',
          model,
          {
            inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
          },
          options.prices ?? {},
        ),
        model,
        provider: 'gemini',
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------------------------

/**
 * Anthropic has no response-format field. The way to force a shape is to offer exactly one tool
 * whose input schema is the selection schema and pin `tool_choice` to it, so the only move
 * available is to fill the schema in. The answer then arrives as a tool-use block rather than as
 * text, and is re-serialised here so the wrapper sees the same JSON string it gets from
 * everywhere else.
 */
export function anthropicProvider(options: ProviderOptions): ModelProvider {
  return {
    name: 'anthropic',
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (options.apiKey === undefined || options.apiKey === '') {
        throw new MissingCredentialError('anthropic', 'ANTHROPIC_API_KEY');
      }

      const payload = await postJson(
        'anthropic',
        `${options.baseUrl ?? 'https://api.anthropic.com/v1'}/messages`,
        { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: options.model,
          max_tokens: options.maxOutputTokens ?? 2048,
          temperature: 0,
          system: request.system,
          messages: [{ role: 'user', content: request.user === '' ? 'Answer now.' : request.user }],
          tools: [
            {
              name: 'selection',
              description: 'Record the selection. Every field must be one of its allowed values.',
              input_schema: schemaWithStrictness(request.schema),
            },
          ],
          tool_choice: { type: 'tool', name: 'selection' },
        },
        options,
      );

      const body = payload as {
        content?: { type: string; input?: unknown; text?: string }[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };

      const toolUse = body.content?.find((block) => block.type === 'tool_use');
      // Falling back to a text block rather than to '' keeps the failure legible: the wrapper
      // reports `unparseable_json` on the actual words returned, not on emptiness.
      const text =
        toolUse === undefined
          ? (body.content?.find((block) => block.type === 'text')?.text ?? '')
          : JSON.stringify(toolUse.input);

      const usage: Usage = {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
      const model = body.model ?? options.model;

      return {
        text,
        finish_reason: finishReason(body.stop_reason),
        cost_usd: costOf('anthropic', model, usage, options.prices ?? {}),
        model,
        provider: 'anthropic',
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------------------------

/**
 * Local inference. No key, no per-token cost — which is exactly why the budget guard needed a
 * wall-clock term: this provider can spend an hour and report $0.00.
 */
export function ollamaProvider(options: ProviderOptions): ModelProvider {
  return {
    name: 'ollama',
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const payload = await postJson(
        'ollama',
        `${options.baseUrl ?? 'http://127.0.0.1:11434'}/api/chat`,
        {},
        {
          model: options.model,
          stream: false,
          // Ollama takes the JSON schema directly.
          format: schemaWithStrictness(request.schema),
          options: { temperature: 0, seed: request.seed },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user === '' ? 'Answer now.' : request.user },
          ],
        },
        options,
      );

      const body = payload as {
        message?: { content?: string };
        done_reason?: string;
        done?: boolean;
        model?: string;
      };

      return {
        text: body.message?.content ?? '',
        // Ollama says `done_reason: 'stop'` on a clean finish and omits it in some versions;
        // `done: true` without a reason is still a clean finish.
        finish_reason: finishReason(body.done_reason ?? (body.done === true ? 'stop' : undefined)),
        cost_usd: 0,
        model: body.model ?? options.model,
        provider: 'ollama',
      };
    },
  };
}

export const PROVIDER_FACTORIES: Readonly<
  Record<ProviderName, (options: ProviderOptions) => ModelProvider>
> = {
  openai: openAiProvider,
  openrouter: openRouterProvider,
  omniroute: omniRouteProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
};
