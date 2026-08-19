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

/**
 * The only two names a key is read from. Anything else is invisible here.
 *
 * Both, because the same account's key gets saved under whichever name the
 * thing that needed it used first — a GitHub workflow written against
 * `MOONSHOT_API_KEY` and a client written against `KIMI_API_KEY` means a key
 * correctly set in one place is silently absent in the other. Accepting both
 * costs a line and removes a trap that cannot be seen from outside.
 */
export const KEY_VARIABLES = ["KIMI_API_KEY", "MOONSHOT_API_KEY"] as const;

/**
 * The off switch, and why removing the key is not one.
 *
 * `docs/BAA.md` names turning this vendor off as the first step before any
 * money is spent on agreements, because it is the party that receives the most
 * sensitive material — photographed notes and full submission text — and it
 * will not sign a BAA. The advice given was "unset `KIMI_API_KEY`". That advice
 * is **wrong on its own**: two variable names are read, so a deployment with
 * `MOONSHOT_API_KEY` also set stays fully live while the operator believes the
 * vendor is gone. Nothing on any screen would have contradicted them.
 *
 * Turning something off by removing things is fallible in a way turning it off
 * by *asserting* is not: you have to find every variable that might carry a key,
 * including one somebody adds next month. `AI_DISABLED=1` is one variable to add
 * and it wins over every key, present or future.
 *
 * It is checked in `kimiKeySource`, which is the single place a key is resolved,
 * so `kimiConfigured()`, `kimiJson()` and the probe endpoint all agree. There is
 * no path to the model that does not pass through here.
 */
export const AI_DISABLE_VARIABLE = "AI_DISABLED";

/** True when this deployment has been told not to talk to a model vendor. */
export function aiDisabled(): boolean {
  const raw = (process.env[AI_DISABLE_VARIABLE] ?? "").trim().toLowerCase();
  // Accepting the three things somebody types into a dashboard field. "0",
  // "false" and empty all mean not disabled, which is the default.
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Settings that are meant to hold a name, so the warning below can ignore them. */
const KNOWN_SETTINGS = new Set(["KIMI_MODEL", "KIMI_BASE_URL", "KIMI_REASONING_EFFORT"]);

/**
 * The key, which variable it came from, and its last four characters.
 *
 * `kimiConfigured()` only ever asked whether *a* key exists, never **which** —
 * so a stale key under the right name, with the good one under a name nothing
 * reads, reports itself as perfectly configured on every screen while every
 * call comes back 401. Four characters is what Stripe and AWS show for the same
 * reason: enough to recognise a key you are holding, useless to anyone else.
 */
export function kimiKeySource(): {
  key: string | null;
  variable: (typeof KEY_VARIABLES)[number] | null;
  fingerprint: string | null;
} {
  /*
   * The switch beats every key. Reported as "no key" to every caller, so each
   * one degrades down the path it already has rather than needing a second
   * concept — but `aiDisabled()` stays separately readable, because "turned off
   * on purpose" and "nobody configured it" are very different things to see on
   * a health check.
   */
  if (aiDisabled()) return { key: null, variable: null, fingerprint: null };

  for (const variable of KEY_VARIABLES) {
    const raw = process.env[variable] || "";
    /*
     * First whitespace-delimited token only.
     *
     * A key pasted twice into a dashboard field makes an `Authorization` value
     * containing a space, which is either rejected outright by `Headers` or
     * sent and refused as 401 — indistinguishable from a revoked key, and a
     * very easy mistake to make on a phone. Taking the first token turns it
     * into a non-event.
     */
    const key = raw.trim().split(/\s+/)[0];
    if (key) return { key, variable, fingerprint: key.slice(-4) };
  }
  return { key: null, variable: null, fingerprint: null };
}

/**
 * Variables that look like a key but sit under a name nothing reads.
 *
 * **Names only, never values.** This is the sentence that ends the round on day
 * one: "MOONSHOT_KEY is set, but this app reads only KIMI_API_KEY or
 * MOONSHOT_API_KEY." A variable nobody reads is otherwise completely silent —
 * it looks, from every screen and every log, exactly like not having set one.
 */
export function unreadKeyVariables(): string[] {
  return Object.keys(process.env)
    .filter(
      (name) =>
        /kimi|moonshot/i.test(name) &&
        !KNOWN_SETTINGS.has(name) &&
        !(KEY_VARIABLES as readonly string[]).includes(name) &&
        (process.env[name] ?? "").trim().length > 0
    )
    .sort();
}

/**
 * Which endpoint is being called, and this is not decoration.
 *
 * Moonshot runs two: `api.moonshot.ai` (international) and `api.moonshot.cn`
 * (China). A key issued on one is refused by the other with the *same* message
 * a revoked key gets. Four different problems, one sentence — so the endpoint
 * has to be reported next to the key or the message cannot be acted on.
 */
export function kimiBaseUrl(): string {
  return (process.env.KIMI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

export function kimiConfigured(): boolean {
  return Boolean(kimiKeySource().key);
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
  const apiKey = kimiKeySource().key;
  if (!apiKey) return null;

  const base = kimiBaseUrl();
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
        /*
         * No `temperature`. K3 accepts only the value 1 and refuses any other
         * outright, so sending 0.1 — a perfectly ordinary choice for extraction
         * — made every call fail on a working key. Omitting it takes the
         * default, which is what we wanted anyway.
         */
        max_tokens: request.maxTokens ?? 2048,
        reasoning_effort: process.env.KIMI_REASONING_EFFORT || "low",
        response_format: {
          type: "json_schema",
          /*
           * Not `strict: true`. Strict mode requires every property to appear
           * in `required` with `additionalProperties: false` throughout, so a
           * single optional field anywhere becomes a provider-side 400 that
           * presents as "the feature silently does nothing". The answer is
           * validated on arrival regardless, which buys the same safety.
           */
          json_schema: { name: request.schemaName, schema: request.schema },
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
