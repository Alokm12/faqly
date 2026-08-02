// Resource route: AI Answer Assistant (Feature B).
//
// Rewrites one existing answer and returns the new text. It never writes to
// the database — the editor drops the result into the answer field and the
// merchant saves (or doesn't) as usual. That keeps undo free: closing the
// editor without saving discards the rewrite, exactly like any other edit.

import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import { toUserMessage } from "../models/errors";
import { runAi, MAX_TOKENS, aiUserMessage } from "../services/ai.server";
import { getPlan } from "../models/ShopPlan.server";

/**
 * The five transformations, and what each one tells the model.
 *
 * Held here rather than passed from the client: the browser sends a key, and
 * an unrecognised key is rejected. A free-text instruction posted from the
 * page would be a prompt-injection hole in an app the merchant's staff share.
 */
export const ASSIST_MODES = {
  improve: {
    label: "Improve",
    instruction:
      "Improve clarity and flow. Fix grammar and awkward phrasing. Keep the length roughly the same.",
  },
  shorten: {
    label: "Shorten",
    instruction:
      "Make it shorter and tighter. Remove filler and repetition. Keep every fact.",
  },
  expand: {
    label: "Expand",
    instruction:
      "Add helpful detail that is already implied by the existing answer. Do not introduce any new fact.",
  },
  friendly: {
    label: "More friendly",
    instruction: "Rewrite in a warmer, more conversational tone.",
  },
  professional: {
    label: "More professional",
    instruction: "Rewrite in a more formal, professional tone.",
  },
};

const SYSTEM_PROMPT = `You rewrite a single Shopify store FAQ answer.
- Preserve every factual claim exactly. Do not add, remove, or alter facts.
- Apply only the requested transformation.
- Keep any [MERCHANT: fill in] placeholders intact.
- Output ONLY a JSON object: {"answer": string}. No fences, no preamble.`;

const ASSIST_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

/** Longest answer we will send. Beyond this the rewrite is not the problem. */
const MAX_INPUT_CHARS = 6000;

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  const formData = await request.formData();
  const mode = String(formData.get("mode") ?? "");
  const answer = String(formData.get("answer") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();

  const modeConfig = ASSIST_MODES[mode];
  if (!modeConfig) return { error: "Unknown rewrite option." };
  if (!answer) return { error: "Write an answer first, then use the assistant." };
  if (answer.length > MAX_INPUT_CHARS) {
    return { error: "That answer is too long to rewrite. Try shortening it first." };
  }

  try {
    const userPrompt = [
      question ? `QUESTION:\n${question}\n` : "",
      `CURRENT ANSWER:\n${answer}\n`,
      `TRANSFORMATION:\n${modeConfig.instruction}`,
    ].join("\n");

    const parsed = await runAi({
      shop: ctx.shop,
      feature: "assist",
      system: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: MAX_TOKENS.assist,
      schema: ASSIST_SCHEMA,
    });

    const rewritten = String(parsed?.answer ?? "").trim();
    if (!rewritten) return { error: aiUserMessage({}) };

    const plan = await getPlan(ctx.shop);
    return { answer: rewritten, mode, plan };
  } catch (error) {
    return {
      error: error?.code
        ? aiUserMessage(error)
        : toUserMessage(error, aiUserMessage({}), "AI assist"),
      plan: await getPlan(ctx.shop).catch(() => null),
    };
  }
};
