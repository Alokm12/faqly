// Resource route: AI FAQ generation (Feature A).
//
// Two intents, deliberately separate:
//   "generate" — calls the model, returns drafts, writes NOTHING
//   "keep"     — writes the drafts the merchant chose to keep
//
// Splitting them is what makes the review step real. If generation wrote
// straight to the database, "Discard" would mean "delete something you never
// asked for", and a merchant who closed the tab mid-review would be left with
// FAQs they never saw. Nothing reaches the database until a human says so.
//
// There is no loader. This route is only ever posted to by the FAQ list page.

import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import { createManyFaqs, getFaqs } from "../models/Faq.server";
import { getCategories } from "../models/Category.server";
import { toUserMessage } from "../models/errors";
import { runAi, MAX_TOKENS, aiUserMessage } from "../services/ai.server";
import { getStoreContext, hasUsableContext } from "../services/store-context.server";
import { getPlan } from "../models/ShopPlan.server";

const MIN_COUNT = 3;
const MAX_COUNT = 15;
const DEFAULT_COUNT = 8;

/** Existing questions sent to the model so it doesn't duplicate them. */
const DEDUPE_SAMPLE = 60;

const SYSTEM_PROMPT = `You are an ecommerce FAQ writer for a Shopify store.

Rules:
- ONLY use facts present in the STORE DATA provided below. Never invent shipping
  times, prices, warranty terms, return windows, sizing, or policy details.
- If a needed fact is missing from STORE DATA, still write the FAQ but put
  "[MERCHANT: fill in]" where the fact belongs.
- Answers: 40-80 words, plain language, second person ("you"), no marketing fluff.
- Questions must be phrased the way a real shopper would type them.
- Do not duplicate any question in EXISTING FAQS.
- Output ONLY a JSON array. No preamble, no explanation, no markdown code fences.

Schema:
[{"question": string, "answer": string, "category": string,
  "confidence": "high" | "medium" | "low"}]

"confidence" reflects how well STORE DATA supported the answer:
"high" = fully grounded, "medium" = partly inferred, "low" = contains a
[MERCHANT: fill in] placeholder.`;

/**
 * Structured-output schema. Makes well-formed JSON the default rather than
 * something the prompt merely asks for; ai.server.js still parses defensively
 * in case the model wraps it anyway.
 */
const GENERATE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      question: { type: "string" },
      answer: { type: "string" },
      category: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["question", "answer", "category", "confidence"],
    additionalProperties: false,
  },
};

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, parsed));
}

/**
 * Maps the model's free-text category name onto a real category.
 *
 * Matched case-insensitively against what the shop already has; anything
 * unrecognised is left uncategorised. The generator deliberately cannot create
 * categories — a model inventing taxonomy is a mess to undo, and an
 * uncategorised draft is trivially fixed in the editor.
 */
function matchCategory(name, categories) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const hit = categories.find((c) => c.name.trim().toLowerCase() === wanted);
  return hit?.handle ?? null;
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  const formData = await request.formData();
  const intent = formData.get("intent");

  /* ---------------------------------------------------------------- */
  /* Write the kept drafts                                             */
  /* ---------------------------------------------------------------- */

  if (intent === "keep") {
    try {
      const drafts = JSON.parse(String(formData.get("drafts") ?? "[]"));
      if (!Array.isArray(drafts) || !drafts.length) {
        return { error: "Nothing to save." };
      }

      const categories = await getCategories(ctx);
      const rows = drafts.map((draft) => ({
        question: draft.question,
        answer: draft.answer,
        categoryHandle: matchCategory(draft.category, categories),
        source: "ai",
        aiConfidence: draft.confidence,
      }));

      const { created, failed } = await createManyFaqs(rows, ctx);
      return {
        saved: created.length,
        failed,
        toast:
          created.length === 1
            ? "1 draft FAQ added"
            : `${created.length} draft FAQs added`,
      };
    } catch (error) {
      return {
        error: toUserMessage(
          error,
          "Couldn't save those FAQs. Please try again.",
          "AI keep drafts",
        ),
      };
    }
  }

  /* ---------------------------------------------------------------- */
  /* Generate                                                          */
  /* ---------------------------------------------------------------- */

  const productId = String(formData.get("productId") ?? "").trim() || null;
  const count = clampCount(formData.get("count"));

  try {
    const [storeContext, existing, categories] = await Promise.all([
      getStoreContext(ctx, { productId }),
      getFaqs(ctx, { hydrate: false }),
      getCategories(ctx),
    ]);

    // Refuse before spending a credit rather than returning N placeholders.
    if (!hasUsableContext(storeContext)) {
      return {
        error:
          productId
            ? "We couldn't read enough about that product to write grounded FAQs. Try another product, or add your shipping and refund policies first."
            : "Add your shipping and refund policies in Shopify settings, or pick a product, so the AI has real facts to work from.",
      };
    }

    // Questions only — the model needs to know what already exists so it can
    // avoid repeating it, and sending full answers would triple the input
    // cost for no gain.
    const existingQuestions = existing
      .slice(0, DEDUPE_SAMPLE)
      .map((faq) => faq.question)
      .filter(Boolean);

    const userPrompt = [
      `STORE DATA:\n${JSON.stringify(storeContext, null, 2)}`,
      `\nEXISTING FAQS:\n${
        existingQuestions.length
          ? existingQuestions.map((q) => `- ${q}`).join("\n")
          : "(none)"
      }`,
      `\nAVAILABLE CATEGORIES:\n${
        categories.length
          ? categories.map((c) => `- ${c.name}`).join("\n")
          : "(none — leave category empty)"
      }`,
      `\nGenerate ${count} FAQs.`,
    ].join("\n");

    const parsed = await runAi({
      shop: ctx.shop,
      feature: "generate",
      system: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: MAX_TOKENS.generate,
      schema: GENERATE_SCHEMA,
    });

    // The model is asked for an array; a lone object is accepted rather than
    // discarded, since the content is still usable.
    const list = Array.isArray(parsed) ? parsed : [parsed];

    const drafts = list
      .filter((item) => item?.question && item?.answer)
      .slice(0, count)
      .map((item, index) => ({
        // Stable key for the review list's Keep/Edit/Discard state. Not an
        // id — nothing exists in the database yet.
        key: `draft-${index}`,
        question: String(item.question).trim(),
        answer: String(item.answer).trim(),
        category: String(item.category ?? "").trim(),
        categoryHandle: matchCategory(item.category, categories),
        confidence: ["high", "medium", "low"].includes(item.confidence)
          ? item.confidence
          : "low",
      }));

    if (!drafts.length) {
      return { error: aiUserMessage({}) };
    }

    const plan = await getPlan(ctx.shop);
    return { drafts, plan };
  } catch (error) {
    // aiUserMessage handles the AI-specific codes; toUserMessage catches
    // anything else (a Prisma failure, a bug) without leaking internals.
    return {
      error: error?.code
        ? aiUserMessage(error)
        : toUserMessage(error, aiUserMessage({}), "AI generate"),
      plan: await getPlan(ctx.shop).catch(() => null),
    };
  }
};
