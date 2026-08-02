// The single entry point for every Anthropic call in this app.
//
// NOTHING ELSE MAY IMPORT @anthropic-ai/sdk. Routes call `runAi`; this file
// owns the key, the model, the timeout, the quota check and the usage log.
// One file means the "does the API key ever reach the browser?" review is a
// single grep, and swapping models later is a two-line change instead of a
// hunt.
//
// The `.server.js` suffix is load-bearing: React Router strips these modules
// out of the client bundle entirely, so `process.env.ANTHROPIC_API_KEY` cannot
// end up in anything a shopper or a merchant's browser downloads.
//
// ORDER OF OPERATIONS (deliberate)
//   1. quota check      — throws before a socket is opened, so an exhausted
//                         shop costs nothing
//   2. API call         — hard 30s ceiling, see the AbortController note
//   3. usage log        — written on success AND failure, before rethrowing
//   4. credit consumed  — only when a call actually reached Anthropic
//   5. JSON parse       — defensively, see parseJsonPayload

import Anthropic from "@anthropic-ai/sdk";
import prisma from "../db.server";
import { UserError } from "../models/errors";
import { assertQuota, consumeCredit } from "../models/ShopPlan.server";

/* ------------------------------------------------------------------ */
/* Model and cost — change these two blocks and nothing else           */
/* ------------------------------------------------------------------ */

// Exported deliberately, not incidentally: AI_MODEL, AI_PRICING, AI_ERRORS
// and parseJsonPayload are this module's testable surface, and AI_MODEL /
// AI_PRICING are what a future usage-and-spend report would read. Anything
// here that stops being referenced by either should be made module-local.
export const AI_MODEL = "claude-haiku-4-5-20251001";

/**
 * USD per million tokens, matching the model above. If you change AI_MODEL,
 * change these in the same commit — a stale rate silently under- or
 * over-reports every row in AiUsage from then on.
 */
export const AI_PRICING = { inputPerMTok: 1, outputPerMTok: 5 };

/** Factual rewriting and extraction, not creative writing. */
const TEMPERATURE = 0.3;

export const MAX_TOKENS = { generate: 3000, assist: 1000, chat: 2000 };

/** Hard ceiling on a single AI request, including SDK retries. */
const TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export const AI_ERRORS = {
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  TIMEOUT: "AI_TIMEOUT",
  INVALID_JSON: "AI_INVALID_JSON",
  UNAVAILABLE: "AI_UNAVAILABLE",
  NOT_CONFIGURED: "AI_NOT_CONFIGURED",
};

/**
 * The only three strings a merchant ever sees from this subsystem.
 *
 * A raw provider message must never reach the admin: it leaks model IDs and
 * request shapes, and it tells the merchant nothing they can act on. Anything
 * unrecognised collapses to the generic line and the real error goes to the
 * server log.
 */
const USER_MESSAGES = {
  [AI_ERRORS.QUOTA_EXCEEDED]:
    "You've used all AI generations for this month. Upgrade to continue.",
  [AI_ERRORS.TIMEOUT]: "That took too long. Please try again.",
  DEFAULT: "Couldn't generate right now — your FAQs are unchanged.",
};

function aiError(code, cause) {
  const error = new UserError(USER_MESSAGES[code] ?? USER_MESSAGES.DEFAULT);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

let client = null;

function getClient() {
  // eslint-disable-next-line no-undef
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Not a UserError with a bespoke message: a missing key is an operator
    // mistake, not something the merchant can fix, so they get the generic
    // line and the reason goes to the log.
    console.error(
      "[Faqly] ANTHROPIC_API_KEY is not set — AI features are disabled. " +
        "Add it to .env (see .env.example) and restart the dev server.",
    );
    throw aiError(AI_ERRORS.NOT_CONFIGURED);
  }
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/** True when the key is present. Lets routes hide AI UI rather than fail it. */
export function aiConfigured() {
  // eslint-disable-next-line no-undef
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/* ------------------------------------------------------------------ */
/* Response handling                                                   */
/* ------------------------------------------------------------------ */

/**
 * Concatenates every text block in the response.
 *
 * Filters by `type` rather than indexing `content[0]`. A response can lead
 * with a non-text block, and `content[0].text` would then be `undefined` —
 * which surfaces as a confusing parse error rather than an obvious one.
 */
function extractText(message) {
  return (message?.content ?? [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Parses model output that is *supposed* to be JSON, and usually is.
 *
 * Three escalating attempts, because "output only JSON" is an instruction and
 * not a guarantee: models occasionally wrap the payload in a markdown fence or
 * prepend a sentence. Structured outputs (below) make this rare, but the
 * fallback stays because a silent parse failure would show the merchant the
 * generic error for output that was 99% usable.
 */
export function parseJsonPayload(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw aiError(AI_ERRORS.INVALID_JSON);

  // 1. As-is.
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }

  // 2. Stripped of a ```json … ``` fence.
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  if (unfenced !== text) {
    try {
      return JSON.parse(unfenced);
    } catch {
      // fall through
    }
  }

  // 3. The outermost [...] or {...} inside whatever else came back.
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ]) {
    const start = unfenced.indexOf(open);
    const end = unfenced.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // try the other bracket type
      }
    }
  }

  throw aiError(AI_ERRORS.INVALID_JSON);
}

function costOf(usage) {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  return (
    (input / 1_000_000) * AI_PRICING.inputPerMTok +
    (output / 1_000_000) * AI_PRICING.outputPerMTok
  );
}

/**
 * Never allowed to throw. A usage row failing to write must not turn a
 * successful generation into an error the merchant sees.
 */
async function logUsage(row) {
  try {
    await prisma.aiUsage.create({ data: { ...row, model: AI_MODEL } });
  } catch (error) {
    console.error("[Faqly] Could not write AiUsage row:", error);
  }
}

/**
 * Maps an SDK exception to one of our codes.
 *
 * Timeouts and aborts are separated from everything else because they are the
 * one failure a merchant can usefully respond to (by trying again), and the
 * copy differs accordingly.
 *
 * MATCHED BY CLASS, NOT BY `error.name`. None of the SDK's error classes
 * assign `this.name`, so a real aborted request arrives with `name === "Error"`
 * — an earlier version of this function tested the name strings and therefore
 * mapped every 30-second timeout to the generic "couldn't generate" message.
 * `instanceof` is the only reliable test. The `name` checks that remain are for
 * a raw `DOMException` from the platform, which *does* set `name` to
 * "AbortError" and can surface if the signal fires outside the SDK.
 */
function classify(error) {
  if (
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return AI_ERRORS.TIMEOUT;
  }
  const name = error?.name ?? "";
  if (name === "AbortError" || name === "TimeoutError") {
    return AI_ERRORS.TIMEOUT;
  }
  return AI_ERRORS.UNAVAILABLE;
}

/** Exported for testing — the timeout/unavailable split drives merchant copy. */
export const __classifyForTest = classify;

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Runs one grounded AI request and returns the parsed JSON payload.
 *
 * @param {object}  options
 * @param {string}  options.shop        Shop domain — quota and logging key.
 * @param {string}  options.feature     "generate" | "assist".
 * @param {string}  options.system      System prompt.
 * @param {string}  [options.userPrompt] Single user message. Ignored when
 *   `messages` is supplied.
 * @param {Array}   [options.messages]  Full conversation, for the multi-turn
 *   assistant. The Messages API is stateless, so the whole history is resent
 *   every turn — the caller is responsible for trimming it (see
 *   app.assistant.jsx, which caps the window).
 * @param {number}  [options.maxTokens]
 * @param {object}  [options.schema]    JSON Schema for structured outputs.
 * @returns {Promise<any>} Parsed JSON.
 * @throws {UserError} With `.code` set to one of AI_ERRORS.
 */
export async function runAi({
  shop,
  feature,
  system,
  userPrompt,
  messages = null,
  maxTokens = MAX_TOKENS.generate,
  schema = null,
}) {
  // 1. Quota first. Deliberately before getClient() so an exhausted shop
  //    never opens a socket — see the acceptance criteria.
  await assertQuota(shop);

  const anthropic = getClient();

  // 2. One AbortController shared with the SDK. The SDK retries 429s and 5xx
  //    twice by default, so a per-attempt timeout would allow ~90s of wall
  //    clock; a shared signal aborts mid-retry and keeps 30s honest.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const started = Date.now();
  let message;
  try {
    message = await anthropic.messages.create(
      {
        model: AI_MODEL,
        max_tokens: maxTokens,
        temperature: TEMPERATURE,
        system,
        messages:
          Array.isArray(messages) && messages.length
            ? messages
            : [{ role: "user", content: userPrompt }],
        // Structured outputs make well-formed JSON the default rather than
        // something we hope for. parseJsonPayload stays as the safety net.
        ...(schema
          ? { output_config: { format: { type: "json_schema", schema } } }
          : {}),
      },
      { signal: controller.signal },
    );
  } catch (error) {
    const code = classify(error);
    await logUsage({ shop, feature, success: false, errorCode: code });
    console.error(`[Faqly] AI ${feature} failed (${code}):`, error);
    throw aiError(code, error);
  } finally {
    clearTimeout(timer);
  }

  // 3. Success: log real token counts and the computed cost, then burn the
  //    credit. Logged before parsing, because a parse failure still cost
  //    money and still has to appear in the audit trail.
  const usage = message.usage ?? {};
  await logUsage({
    shop,
    feature,
    success: true,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    costUsd: costOf(usage),
  });
  await consumeCredit(shop);

  console.log(
    `[Faqly] AI ${feature}: ${usage.input_tokens ?? 0} in / ` +
      `${usage.output_tokens ?? 0} out, ${Date.now() - started}ms`,
  );

  try {
    return parseJsonPayload(extractText(message));
  } catch (error) {
    // The call succeeded and is already logged as a success; this second row
    // records that the *output* was unusable, which is a different problem
    // from the request failing.
    await logUsage({
      shop,
      feature,
      success: false,
      errorCode: AI_ERRORS.INVALID_JSON,
    });
    console.error("[Faqly] AI returned unparseable JSON:", extractText(message));
    throw error;
  }
}

/** Friendly message for any error, AI-related or not. */
export function aiUserMessage(error) {
  if (error?.code && USER_MESSAGES[error.code]) return USER_MESSAGES[error.code];
  return USER_MESSAGES.DEFAULT;
}
