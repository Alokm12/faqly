// Review step for AI-generated drafts.
//
// NOTHING HERE IS SAVED UNTIL THE MERCHANT SAYS SO. Every draft starts in a
// "pending" state; Keep marks it for insert, Discard drops it, Edit makes the
// text editable in place. Only kept drafts are posted back, and everything
// that arrives is a draft FAQ regardless — there is no publish path from this
// screen.
//
// ACCESSIBILITY
// Confidence is never colour alone: the badge carries the word, and a "low"
// draft additionally states in prose that it contains a placeholder. Each
// draft is a <li> in a labelled list, every control has a name that includes
// the question it acts on (so "Discard" is never ambiguous in a screen
// reader's element list), and the running count is announced via aria-live.

import { useState } from "react";
import { PALETTE, Icon, Tag, Card, CardHead } from "./ui";

const CONFIDENCE = {
  high: {
    tone: "positive",
    label: "High confidence",
    note: null,
  },
  medium: {
    tone: "caution",
    label: "Medium confidence",
    note: "Partly inferred — check the details before publishing.",
  },
  low: {
    tone: "critical",
    label: "Low confidence",
    note: "Contains a [MERCHANT: fill in] placeholder. Finish it before publishing.",
  },
};

function DraftRow({ draft, state, onKeep, onDiscard, onEdit, onChange }) {
  const confidence = CONFIDENCE[draft.confidence] ?? CONFIDENCE.low;
  const discarded = state.status === "discarded";
  const kept = state.status === "kept";

  return (
    <li
      className="fq-card"
      style={{
        gap: "12px",
        padding: "16px",
        opacity: discarded ? 0.5 : 1,
        borderColor: kept ? PALETTE.green.line : "#E5E7EB",
        background: kept ? PALETTE.green.bg : "#FFFFFF",
      }}
    >
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          {state.editing ? (
            <s-text-field
              label="Question"
              value={state.question}
              onChange={(event) => onChange("question", event.target.value)}
            />
          ) : (
            <span className="fq-row-title">{state.question}</span>
          )}
        </div>
        <Tag tone={confidence.tone}>{confidence.label}</Tag>
      </div>

      {state.editing ? (
        <s-text-area
          label="Answer"
          rows={4}
          value={state.answer}
          onChange={(event) => onChange("answer", event.target.value)}
        />
      ) : (
        <p className="fq-row-sub" style={{ margin: 0 }}>
          {state.answer}
        </p>
      )}

      {/* The placeholder warning is prose, not a colour — it survives being
          read aloud and being seen in greyscale. */}
      {confidence.note && (
        <p className="fq-row-sub" style={{ margin: 0, color: PALETTE.amber.text }}>
          {confidence.note}
        </p>
      )}

      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        {draft.category && (
          <span className="fq-row-note">
            Category: {draft.categoryHandle ? draft.category : `${draft.category} (not found — will be uncategorized)`}
          </span>
        )}
        <span style={{ flex: "1 1 auto" }} />

        {discarded ? (
          <s-button
            onClick={onKeep}
            accessibilityLabel={`Restore "${state.question}"`}
          >
            Restore
          </s-button>
        ) : (
          <>
            <s-button
              onClick={onEdit}
              accessibilityLabel={`${state.editing ? "Finish editing" : "Edit"} "${state.question}"`}
            >
              {state.editing ? "Done" : "Edit"}
            </s-button>
            <s-button
              onClick={onDiscard}
              tone="critical"
              accessibilityLabel={`Discard "${state.question}"`}
            >
              Discard
            </s-button>
            {!kept && (
              <s-button
                variant="primary"
                onClick={onKeep}
                accessibilityLabel={`Keep "${state.question}"`}
              >
                Keep
              </s-button>
            )}
            {kept && (
              <Tag tone="positive">
                <Icon name="check" size={12} />
                Keeping
              </Tag>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function AiReviewList({ drafts, saving, onSave, onCancel }) {
  // One entry per draft, keyed by the stable `key` the action assigned.
  // Everything starts as "kept" — the merchant reviewed by generating, and
  // making them click Keep eight times to accept a good batch is friction
  // with no safety benefit (nothing publishes from here).
  const [rows, setRows] = useState(() =>
    drafts.map((draft) => ({
      key: draft.key,
      status: "kept",
      editing: false,
      question: draft.question,
      answer: draft.answer,
    })),
  );

  const update = (key, patch) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const keeping = rows.filter((row) => row.status === "kept");

  const handleSave = () => {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    onSave(
      keeping.map((row) => {
        const draft = drafts.find((d) => d.key === row.key);
        const edited = byKey.get(row.key);
        return {
          question: edited.question,
          answer: edited.answer,
          category: draft.category,
          confidence: draft.confidence,
        };
      }),
    );
  };

  return (
    <Card aria-labelledby="fq-ai-review-heading">
      <CardHead
        id="fq-ai-review-heading"
        title={`${drafts.length} draft FAQ${drafts.length === 1 ? "" : "s"} ready to review`}
        subtitle="Nothing is saved until you choose. Everything you keep is added as a draft — none of it goes live."
        action={
          <s-button
            onClick={() =>
              setRows((current) => current.map((r) => ({ ...r, status: "kept" })))
            }
          >
            Keep all
          </s-button>
        }
      />

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {drafts.map((draft) => {
          const state = rows.find((row) => row.key === draft.key);
          if (!state) return null;
          return (
            <DraftRow
              key={draft.key}
              draft={draft}
              state={state}
              onKeep={() => update(draft.key, { status: "kept" })}
              onDiscard={() => update(draft.key, { status: "discarded", editing: false })}
              onEdit={() => update(draft.key, { editing: !state.editing })}
              onChange={(field, value) => update(draft.key, { [field]: value })}
            />
          );
        })}
      </ul>

      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          flexWrap: "wrap",
          borderTop: "1px solid #F3F4F6",
          paddingTop: "14px",
        }}
      >
        <span className="fq-row-note" aria-live="polite">
          {keeping.length} of {drafts.length} selected
        </span>
        <span style={{ flex: "1 1 auto" }} />
        <s-button onClick={onCancel} disabled={saving || undefined}>
          Discard all
        </s-button>
        <s-button
          variant="primary"
          onClick={handleSave}
          disabled={!keeping.length || saving || undefined}
          loading={saving || undefined}
        >
          Add {keeping.length} draft{keeping.length === 1 ? "" : "s"}
        </s-button>
      </div>
    </Card>
  );
}
