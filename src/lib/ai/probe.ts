import "server-only";

import { deflateSync } from "node:zlib";
import { kimiConfigured, kimiModel } from "@/lib/ai/kimi";

/**
 * Does the handwriting reader actually work?
 *
 * `readHandwriting` cannot answer this, and that is by design: every failure —
 * absent key, rejected key, withdrawn model, empty response, timeout — comes
 * back as `null` so the workspace degrades to typing rather than to an error
 * page. Excellent for a clinician mid-session, useless for whoever has to
 * decide whether to promise the feature to customers.
 *
 * So this makes the call itself and reports what happened. It duplicates a
 * little of `kimiJson`'s request shape on purpose, because what it exists to
 * observe is precisely what `kimiJson` throws away.
 *
 * The distinctions matter operationally. A missing key is a five-second fix; a
 * 401 means the key is wrong or revoked; a 404 on the model id means the pinned
 * model was withdrawn — `moonshot-v1-*` and the `-vision-preview` ids go on 31
 * August 2026, which will break this silently on a working key. And an empty
 * completion on a 200 is the trap documented in `kimi.ts`: K3 reasons before it
 * writes, so a tight budget burns the allowance and returns nothing while still
 * billing. That reads exactly like a dead key and is nothing of the sort.
 */

export type ProbeFailure =
  | "NO_KEY"
  | "UNAUTHORIZED"
  | "MODEL_UNAVAILABLE"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "EMPTY_CONTENT"
  | "BAD_SHAPE"
  | "UNREADABLE"
  | "TIMEOUT"
  | "NETWORK";

export type ReaderProbe =
  | { ok: true; model: string; readBack: string; ms: number }
  | { ok: false; reason: ProbeFailure; detail: string; model: string; ms: number };

/** What the generated test image says, and what the model must read back. */
const PROBE_WORD = "NOTE OK";

// ── A test image, generated rather than committed ───────────────────────────
//
// Checking in a PNG would work and would also be a small opaque binary nobody
// can review. This is a 5x7 bitmap of the five letters needed, scaled up and
// encoded as a greyscale PNG — about fifty lines, and every part of it is
// legible in a diff.

const GLYPHS: Record<string, string[]> = {
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

const SCALE = 12;
const PAD = 24;

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** Greyscale PNG of PROBE_WORD: black text on white, no antialiasing. */
function probeImageDataUri(): string {
  const cols = PROBE_WORD.length * 6 - 1; // 5 wide + 1 space, none after the last
  const width = cols * SCALE + PAD * 2;
  const height = 7 * SCALE + PAD * 2;

  // Each scanline is prefixed with filter byte 0, which is what "no filter"
  // means in PNG — not an absence of the byte.
  const stride = width + 1;
  const raw = Buffer.alloc(stride * height, 0xff);
  for (let y = 0; y < height; y++) raw[y * stride] = 0;

  PROBE_WORD.split("").forEach((ch, index) => {
    const glyph = GLYPHS[ch.toUpperCase()];
    if (!glyph) return;
    glyph.forEach((row, gy) => {
      row.split("").forEach((bit, gx) => {
        if (bit !== "1") return;
        const x0 = PAD + (index * 6 + gx) * SCALE;
        const y0 = PAD + gy * SCALE;
        for (let dy = 0; dy < SCALE; dy++) {
          const rowStart = (y0 + dy) * stride + 1;
          raw.fill(0x00, rowStart + x0, rowStart + x0 + SCALE);
        }
      });
    });
  });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type 0 = greyscale
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Exported so a script can write the image out and a person can look at it. */
export { probeImageDataUri, PROBE_WORD };

// ── The probe ───────────────────────────────────────────────────────────────

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "confidence"],
        properties: {
          text: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

export async function probeHandwritingReader(): Promise<ReaderProbe> {
  const model = kimiModel();
  const started = Date.now();
  const ms = () => Date.now() - started;

  if (!kimiConfigured()) {
    return { ok: false, reason: "NO_KEY", detail: "KIMI_API_KEY is not set.", model, ms: ms() };
  }

  const base = process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.KIMI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 512,
        reasoning_effort: process.env.KIMI_REASONING_EFFORT || "low",
        response_format: {
          type: "json_schema",
          json_schema: { name: "handwriting_transcription", strict: true, schema: SCHEMA },
        },
        messages: [
          {
            role: "system",
            content:
              "You transcribe images of text. Return every legible word. Do not interpret or correct.",
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: probeImageDataUri() } },
              { type: "text", text: "Transcribe the text in this image." },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      // The body can carry the provider's own explanation, which is worth
      // surfacing — it is about the account, never about a patient.
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      const reason: ProbeFailure =
        res.status === 401 || res.status === 403
          ? "UNAUTHORIZED"
          : res.status === 404
            ? "MODEL_UNAVAILABLE"
            : res.status === 429
              ? "RATE_LIMITED"
              : "SERVER_ERROR";
      return { ok: false, reason, detail: `HTTP ${res.status}. ${detail}`, model, ms: ms() };
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      return {
        ok: false,
        reason: "EMPTY_CONTENT",
        detail:
          "The model answered 200 with no content. Usually the reasoning budget was spent before any output — raise max_tokens or lower KIMI_REASONING_EFFORT. The key is fine.",
        model,
        ms: ms(),
      };
    }

    let text: string;
    try {
      const parsed = JSON.parse(content) as { blocks?: { text?: string }[] };
      const blocks = parsed.blocks ?? [];
      text = blocks.map((b) => b?.text ?? "").join(" ").trim();
    } catch {
      return {
        ok: false,
        reason: "BAD_SHAPE",
        detail: `Reply was not the requested JSON: ${content.slice(0, 200)}`,
        model,
        ms: ms(),
      };
    }

    // Compared loosely on purpose. The question is "did it read the image",
    // not "did it match a string" — spacing and case are not the point.
    const normalised = text.toUpperCase().replace(/[^A-Z]/g, "");
    if (!normalised.includes("NOTE") && !normalised.includes("OK")) {
      return {
        ok: false,
        reason: "UNREADABLE",
        detail: `Connected and answered, but did not read the test image. Expected "${PROBE_WORD}", got "${text.slice(0, 120)}". Vision may not be enabled for this model.`,
        model,
        ms: ms(),
      };
    }

    return { ok: true, model, readBack: text.slice(0, 120), ms: ms() };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "TIMEOUT" : "NETWORK",
      detail: aborted
        ? "No response within 45 seconds."
        : `Could not reach ${base}: ${error instanceof Error ? error.message : String(error)}`,
      model,
      ms: ms(),
    };
  } finally {
    clearTimeout(timer);
  }
}
