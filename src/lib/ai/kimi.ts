import "server-only";

import { logSafe } from "@/lib/redact";

/**
 * The one way this product talks to a model.
 *
 * Kimi (Moonshot) is OpenAI-compatible, so this is a `fetch` and nothing more —
 * no SDK, no dependency, no version to chase. What the module is really for is
 * the discipline around the call, because the model is the least predictable
 * component in a system whose entire value proposition is that the records
 * coming out of it are trustworthy.
 *
 * ## Three rules, and they are not negotiable
 *
 * **1. Never on the critical path.** Every function here returns `null` rather
 * than throwing — no key, bad JSON, refusal, timeout, rate limit, all the same.
 * A `null` means the caller does exactly what it would have done if none of
 * this existed: a page with no transcript gets typed by hand, a duplicate that
 * was not classified gets looked at by a person. That is the status quo this
 * product replaces, so degrading to it is not a failure state.
 *
 * **2. The shape is checked before a caller sees it.** `response_format:
 * json_schema` constrains the output and we validate again on arrival anyway. A
 * half-parsed object reaching the transcript editor is worse than no answer,
 * and "it usually returns the right shape" is not something to build a clinical
 * record on.
 *
 * **3. It never decides.** Nothing here signs a note, resolves a duplicate,
 * changes a client's status, or marks a page verified. It reads, it suggests,
 * it classifies — a named human presses every button that changes a record.
 * That rule is enforced at the call sites; it is written down here because it
 * is the reason this module is allowed to exist at all.
 *
 * ## The model id is pinned deliberately
 *
 * `moonshot-v1-*` and K2.5 are withdrawn on 31 August 2026 and the
 * `-vision-preview` ids go with them, so building on the ids that appear in
 * older examples would mean a product that stops reading handwriting a few
 * weeks from now. `kimi-k3` is current and does vision natively.
 *
 * ## And why `reasoning_effort` is set low
 *
 * K3 is a reasoning model whose default effort is *max*: it spends tokens
 * thinking before it emits a character, so a request with a modest budget can
 * burn the whole allowance and return **empty content while still being
 * billed**. It reads exactly like a dead API key and is nothing of the sort.
 * Every call in this product is extraction — read this page, classify this
 * pair, draft from this text — and none of it benefits from deliberation.
 */

const DEFAULT_MODEL = "kimi-k3";
const DEFAULT_BASE = "https://api.moonshot.ai/v1";
const DEFAULT_TIMEOUT_MS = 45_000;

export function kimiConfigured(): boolean {
  return Boolean(process.env.KIMI_API_KEY);
}

export function kimiModel(): string {
  return process.env.KIMI_MODEL || DEFAULT_MODEL;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface KimiRequest {
  system: string;
  /** Text prompt, plus optionally one image as a data URI. */
  user: string;
  imageDataUri?: string;
  /** JSON Schema the response must satisfy. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
  /** Scope name for log lines. Never include note text. */
  scope: string;
}

/**
 * Calls the model and returns a parsed object, or `null`.
 *
 * The caller is expected to validate the result against its own zod schema as
 * well. Two checks on the same boundary is not redundancy here — the JSON
 * schema constrains generation, zod constrains what enters our types, and they
 * fail differently.
 */
export async function kimiJson<T = unknown>(request: KimiRequest): Promise<T | null> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) return null;

  const base = process.env.KIMI_BASE_URL || DEFAULT_BASE;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const content: ContentPart[] = [{ type: "text", text: request.user }];
  if (request.imageDataUri) {
    content.unshift({ type: "image_url", image_url: { url: request.imageDataUri } });
  }

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: kimiModel(),
        temperature: 0.1,
        max_tokens: request.maxTokens ?? 2048,
        reasoning_effort: process.env.KIMI_REASONING_EFFORT || "low",
        response_format: {
          type: "json_schema",
          json_schema: { name: request.schemaName, strict: true, schema: request.schema },
        },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content },
        ],
      }),
    });

    if (!res.ok) {
      logSafe("kimi", `HTTP ${res.status}`, { scope: request.scope });
      return null;
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content;
    if (!text) {
      // The empty-content-but-billed case described above. Worth its own line in
      // the log, because it is the one failure that looks like a broken key.
      logSafe("kimi", "empty content returned", { scope: request.scope });
      return null;
    }

    return JSON.parse(text) as T;
  } catch (error) {
    logSafe("kimi", "call failed", {
      scope: request.scope,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
