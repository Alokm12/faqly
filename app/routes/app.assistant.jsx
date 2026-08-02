// AI Assistant — a chat panel for the merchant, inside the admin.
//
// WHO THIS IS FOR
// The merchant, not the shopper. Your AI spec explicitly listed "storefront AI
// chat bot or any customer-facing AI" and "any AI call from browser or
// storefront JavaScript" under do-not-build, and this respects that: the chat
// runs entirely inside the authenticated admin, every call is server-side, and
// nothing here is reachable from a storefront.
//
// WHY IT IS GROUNDED THE SAME WAY THE GENERATOR IS
// The assistant can see the shop's existing FAQs, categories and policies, and
// is told to answer from those. A merchant asking "what am I missing?" needs
// an answer about *their* store, and an assistant that invents a returns
// window while sitting inside a tool for writing returns policies would be
// worse than no assistant.
//
// CONVERSATIONS ARE NOT PERSISTED
// History lives in component state for the length of the visit. Storing chat
// transcripts means a retention policy, an export path and a deletion path for
// data nobody asked us to keep — and the useful output (a drafted FAQ) already
// has a home in the FAQ table. Reloading the page starts fresh, by design.

import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import { getFaqs, createManyFaqs } from "../models/Faq.server";
import { getCategories } from "../models/Category.server";
import { getPlan } from "../models/ShopPlan.server";
import { toUserMessage } from "../models/errors";
import {
  runAi,
  MAX_TOKENS,
  aiUserMessage,
  aiConfigured,
} from "../services/ai.server";
import { getStoreContext } from "../services/store-context.server";
import {
  AppStyles,
  PageIntro,
  Card,
  CardHead,
  Callout,
  Tag,
  Icon,
  PALETTE,
} from "../components/ui";
import { AiCreditMeter } from "../components/AiCreditMeter";

/**
 * How many prior turns are resent. The Messages API is stateless, so every
 * turn re-bills the whole window — an uncapped conversation quietly grows the
 * input cost of each reply until it dwarfs the reply itself. Six turns is
 * enough for "no, shorter" to make sense.
 */
const HISTORY_TURNS = 6;

/** FAQ questions given to the model so it can see what already exists. */
const FAQ_SAMPLE = 80;

const SYSTEM_PROMPT = `You are the FAQ assistant inside Faqly, a Shopify app. You are talking to the
merchant who runs the store — never to a shopper.

Rules:
- ONLY state facts present in STORE DATA or EXISTING FAQS below. Never invent
  shipping times, prices, return windows, warranty terms, or policy details.
- If a fact is missing, say so plainly and ask the merchant for it.
- Be brief. Two or three sentences unless asked for more.
- When the merchant asks you to write, draft, or suggest FAQs, put them in
  "suggestedFaqs". When they ask a question, answer in "reply" and leave
  "suggestedFaqs" empty.
- Answers you draft: 40-80 words, plain language, second person ("you").
- If a drafted answer needs a fact you do not have, write
  "[MERCHANT: fill in]" where it belongs and mark that FAQ "low" confidence.
- Never suggest a question that already exists in EXISTING FAQS.
- Output ONLY a JSON object. No preamble, no markdown code fences.

Schema:
{"reply": string,
 "suggestedFaqs": [{"question": string, "answer": string,
                    "category": string, "confidence": "high"|"medium"|"low"}]}

"confidence" reflects how well STORE DATA supported the answer: "high" = fully
grounded, "medium" = partly inferred, "low" = contains a [MERCHANT: fill in]
placeholder.`;

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    suggestedFaqs: {
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
    },
  },
  required: ["reply", "suggestedFaqs"],
  additionalProperties: false,
};

const STARTERS = [
  "What FAQs am I missing?",
  "Write 3 FAQs about shipping",
  "Which of my answers are too long?",
  "Draft an FAQ about international delivery",
];

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const plan = await getPlan(ctx.shop);

  return {
    plan,
    starters: STARTERS,
    // The provider key is never referenced outside app/services — only this
    // boolean crosses to the browser.
    aiEnabled: aiConfigured() && Boolean(plan),
  };
};

function matchCategory(name, categories) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return categories.find((c) => c.name.trim().toLowerCase() === wanted)?.handle ?? null;
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  const formData = await request.formData();
  const intent = formData.get("intent");

  /* ---------------------------------------------------------------- */
  /* Save a suggested FAQ as a draft                                   */
  /* ---------------------------------------------------------------- */

  if (intent === "keep") {
    try {
      const drafts = JSON.parse(String(formData.get("drafts") ?? "[]"));
      if (!Array.isArray(drafts) || !drafts.length) {
        return { error: "Nothing to save." };
      }
      const categories = await getCategories(ctx);
      const { created, failed } = await createManyFaqs(
        drafts.map((d) => ({
          question: d.question,
          answer: d.answer,
          categoryHandle: matchCategory(d.category, categories),
          source: "ai",
          aiConfidence: d.confidence,
        })),
        ctx,
      );
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
          "Couldn't save that FAQ. Please try again.",
          "Assistant keep",
        ),
      };
    }
  }

  /* ---------------------------------------------------------------- */
  /* Send a message                                                    */
  /* ---------------------------------------------------------------- */

  const message = String(formData.get("message") ?? "").trim();
  if (!message) return { error: "Type a message first." };

  let history = [];
  try {
    const parsed = JSON.parse(String(formData.get("history") ?? "[]"));
    if (Array.isArray(parsed)) {
      history = parsed
        .filter((turn) => turn?.role === "user" || turn?.role === "assistant")
        .filter((turn) => typeof turn.content === "string" && turn.content.trim())
        // Only the tail is resent — see HISTORY_TURNS.
        .slice(-HISTORY_TURNS * 2)
        .map((turn) => ({ role: turn.role, content: turn.content }));
    }
  } catch {
    // A malformed history is not worth failing the message over; the turn
    // simply starts without context.
    history = [];
  }

  try {
    const [storeContext, faqs] = await Promise.all([
      getStoreContext(ctx, { productId: null }),
      getFaqs(ctx, { hydrate: false }),
    ]);

    // Grounding goes in the FIRST user turn rather than the system prompt so
    // the stable instructions stay byte-identical across turns — that is what
    // keeps the prompt cache warm as the conversation grows.
    const grounding = [
      `STORE DATA:\n${JSON.stringify(storeContext, null, 2)}`,
      `\nEXISTING FAQS (${faqs.length} total):\n${
        faqs.length
          ? faqs
              .slice(0, FAQ_SAMPLE)
              .map((f) => `- ${f.question}`)
              .join("\n")
          : "(none yet)"
      }`,
    ].join("\n");

    const messages = [
      { role: "user", content: `${grounding}\n\n---\n\n${message}` },
    ];
    // Prior turns go before the current one; the grounding block rides on the
    // newest user turn so it always reflects the current state of the shop.
    if (history.length) {
      messages.unshift(...history);
      messages[messages.length - 1] = {
        role: "user",
        content: `${grounding}\n\n---\n\n${message}`,
      };
    }

    const parsed = await runAi({
      shop: ctx.shop,
      feature: "chat",
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: MAX_TOKENS.chat,
      schema: CHAT_SCHEMA,
    });

    const categories = await getCategories(ctx);
    const suggested = Array.isArray(parsed?.suggestedFaqs)
      ? parsed.suggestedFaqs
          .filter((f) => f?.question && f?.answer)
          .slice(0, 10)
          .map((f, index) => ({
            key: `sug-${Date.now()}-${index}`,
            question: String(f.question).trim(),
            answer: String(f.answer).trim(),
            category: String(f.category ?? "").trim(),
            categoryHandle: matchCategory(f.category, categories),
            confidence: ["high", "medium", "low"].includes(f.confidence)
              ? f.confidence
              : "low",
          }))
      : [];

    return {
      reply: String(parsed?.reply ?? "").trim() || "…",
      suggestedFaqs: suggested,
      plan: await getPlan(ctx.shop),
    };
  } catch (error) {
    return {
      error: error?.code
        ? aiUserMessage(error)
        : toUserMessage(error, aiUserMessage({}), "Assistant chat"),
      plan: await getPlan(ctx.shop).catch(() => null),
    };
  }
};

/* ------------------------------------------------------------------ */

const CONFIDENCE_TONE = { high: "positive", medium: "caution", low: "critical" };

function SuggestedFaq({ faq, onKeep, saving }) {
  return (
    <div
      className="fq-card"
      style={{ gap: "10px", padding: "14px", background: "#FFFFFF" }}
    >
      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <span className="fq-row-title" style={{ flex: "1 1 200px" }}>
          {faq.question}
        </span>
        <Tag tone={CONFIDENCE_TONE[faq.confidence] ?? "critical"}>
          {faq.confidence} confidence
        </Tag>
      </div>
      <p className="fq-row-sub" style={{ margin: 0 }}>
        {faq.answer}
      </p>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        {faq.category && (
          <span className="fq-row-note">
            {faq.categoryHandle
              ? `Category: ${faq.category}`
              : `${faq.category} — no such category, will be uncategorized`}
          </span>
        )}
        <span style={{ flex: "1 1 auto" }} />
        <s-button
          onClick={() => onKeep(faq)}
          disabled={saving || undefined}
          accessibilityLabel={`Add "${faq.question}" as a draft FAQ`}
        >
          Add as draft
        </s-button>
      </div>
    </div>
  );
}

function Bubble({ turn, onKeep, saving }) {
  const isUser = turn.role === "user";
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: "8px",
      }}
    >
      <div
        style={{
          maxWidth: "min(680px, 88%)",
          padding: "11px 14px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          background: isUser ? PALETTE.indigo.accent : "#FFFFFF",
          color: isUser ? "#FFFFFF" : "#111827",
          border: isUser ? "none" : "1px solid #E5E7EB",
          fontSize: "13.5px",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {turn.content}
      </div>

      {turn.suggestedFaqs?.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            width: "min(680px, 88%)",
          }}
        >
          {turn.suggestedFaqs.map((faq) => (
            <SuggestedFaq key={faq.key} faq={faq} onKeep={onKeep} saving={saving} />
          ))}
        </div>
      )}
    </li>
  );
}

export default function Assistant() {
  const { plan, starters, aiEnabled } = useLoaderData();
  const fetcher = useFetcher();
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState(null);
  const endRef = useRef(null);
  const appliedRef = useRef(null);

  const busy = fetcher.state !== "idle";
  const currentPlan = fetcher.data?.plan ?? plan;

  // Fold each response into the transcript exactly once. Without the guard an
  // unrelated re-render would append the same reply again.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (appliedRef.current === fetcher.data) return;
    appliedRef.current = fetcher.data;

    const data = fetcher.data;
    if (data.error) {
      setNotice({ tone: "error", text: data.error });
      return;
    }
    if (data.saved !== undefined) {
      setNotice({ tone: "ok", text: data.toast ?? "Draft added" });
      return;
    }
    if (data.reply) {
      setNotice(null);
      setTurns((current) => [
        ...current,
        {
          role: "assistant",
          content: data.reply,
          suggestedFaqs: data.suggestedFaqs ?? [],
        },
      ]);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const send = (text) => {
    const message = (text ?? draft).trim();
    if (!message || busy) return;

    const next = [...turns, { role: "user", content: message }];
    setTurns(next);
    setDraft("");
    setNotice(null);

    fetcher.submit(
      {
        intent: "chat",
        message,
        // Only text is resent; the suggested-FAQ cards stay client-side.
        history: JSON.stringify(
          turns.map((t) => ({ role: t.role, content: t.content })),
        ),
      },
      { method: "POST" },
    );
  };

  const keep = (faq) => {
    fetcher.submit(
      { intent: "keep", drafts: JSON.stringify([faq]) },
      { method: "POST" },
    );
  };

  if (!aiEnabled) {
    return (
      <s-page heading="AI Assistant">
        <s-link slot="breadcrumbs" href="/app/faqs">
          ← FAQs
        </s-link>
        <AppStyles />
        <div className="fq">
          <Card>
            <div className="fq-empty">
              <Icon name="spark" size={22} />
              <h3 className="fq-card-title" style={{ fontSize: "17px" }}>
                The assistant isn&apos;t switched on
              </h3>
              {/* The variable is named in .env.example rather than here, so
                  that grepping the client bundle for the key name stays a
                  meaningful leak check. */}
              <p className="fq-card-sub" style={{ maxWidth: "46ch" }}>
                Add your Anthropic API key to the app&apos;s environment — see{" "}
                <code>.env.example</code> — then restart. Everything else in
                Faqly works without it.
              </p>
            </div>
          </Card>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading="AI Assistant">
      <s-link slot="breadcrumbs" href="/app/faqs">
        ← FAQs
      </s-link>
      <s-link slot="secondary-actions" href="/app/billing">
        Plans & billing
      </s-link>

      <AppStyles />

      <div className="fq">
        <PageIntro title="AI Assistant">
          Ask about your FAQs, spot gaps, and draft new answers. It only knows
          what&apos;s in your store — your FAQs, categories and policies.
        </PageIntro>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            background: "#FFFFFF",
            border: "1px solid #E5E7EB",
            borderRadius: "12px",
            padding: "12px 16px",
          }}
        >
          <AiCreditMeter plan={currentPlan} />
          <span style={{ flex: "1 1 auto" }} />
          {turns.length > 0 && (
            <s-button onClick={() => setTurns([])} disabled={busy || undefined}>
              New conversation
            </s-button>
          )}
        </div>

        {notice && (
          <s-banner
            tone={notice.tone === "error" ? "critical" : "success"}
            heading={notice.text}
          />
        )}

        {currentPlan?.remaining === 0 && (
          <Callout tone="action" heading="You're out of AI generations">
            Each message uses one credit. Upgrade for more this month — every
            other Faqly feature keeps working.
            <span style={{ display: "block", marginTop: "10px" }}>
              <s-button variant="primary" href="/app/billing">
                See plans
              </s-button>
            </span>
          </Callout>
        )}

        <Card aria-labelledby="fq-chat-heading">
          <CardHead
            id="fq-chat-heading"
            title="Conversation"
            subtitle="Not saved — closing this page starts a fresh conversation."
          />

          {turns.length === 0 ? (
            <div className="fq-empty" style={{ padding: "18px 8px" }}>
              <Icon name="spark" size={20} />
              <p className="fq-card-sub" style={{ margin: 0 }}>
                Try one of these to start:
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  marginTop: "4px",
                }}
              >
                {starters.map((starter) => (
                  <s-button
                    key={starter}
                    onClick={() => send(starter)}
                    disabled={busy || currentPlan?.remaining === 0 || undefined}
                  >
                    {starter}
                  </s-button>
                ))}
              </div>
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                maxHeight: "52vh",
                overflowY: "auto",
              }}
            >
              {turns.map((turn, index) => (
                <Bubble
                  key={`${turn.role}-${index}`}
                  turn={turn}
                  onKeep={keep}
                  saving={busy}
                />
              ))}
              <li ref={endRef} />
            </ul>
          )}

          {/* The only cue for anyone not watching the transcript. */}
          <div aria-live="polite">
            {busy && (
              <span className="fq-quiet">
                <s-spinner size="base" accessibilityLabel="Thinking" />
                Thinking…
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <s-text-field
                label="Message"
                labelAccessibilityVisibility="exclusive"
                placeholder="Ask about your FAQs…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter is a newline — the convention
                  // every chat box uses.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
            </div>
            <s-button
              variant="primary"
              onClick={() => send()}
              disabled={
                busy || !draft.trim() || currentPlan?.remaining === 0 || undefined
              }
              loading={busy || undefined}
            >
              Send
            </s-button>
          </div>

          <p className="fq-row-note" style={{ margin: 0 }}>
            Each message uses one AI credit. The assistant answers from your own
            store data and says so when it doesn&apos;t know.
          </p>
        </Card>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
