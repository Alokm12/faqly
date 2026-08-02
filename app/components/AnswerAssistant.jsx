// AI Answer Assistant (Feature B) — the control under the answer field.
//
// It never saves. The rewrite replaces the text in the form and the merchant
// saves as usual, so undo is the same undo they already have: leave without
// saving. That also means a rewrite they dislike costs them nothing but a
// credit, which is why Undo below restores the previous text locally rather
// than calling the model again.
//
// ACCESSIBILITY
// The five modes are ordinary buttons with real labels, disabled while a
// request is in flight. The result is announced through an aria-live region
// rather than appearing silently in the textarea, because a screen-reader
// user has no other cue that the field they are editing just changed
// underneath them.

import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Icon, PALETTE } from "./ui";

const MODES = [
  { key: "improve", label: "Improve" },
  { key: "shorten", label: "Shorten" },
  { key: "expand", label: "Expand" },
  { key: "friendly", label: "Friendlier" },
  { key: "professional", label: "More formal" },
];

export function AnswerAssistant({ question, answer, onReplace }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  // The text as it was before the last rewrite, so Undo is instant and free.
  const [previous, setPrevious] = useState(null);
  const [status, setStatus] = useState(null);

  // Which submission we have already applied. Without this the effect
  // re-applies the same rewrite every time the component re-renders for an
  // unrelated reason — including after the merchant has edited it again.
  const appliedRef = useRef(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (appliedRef.current === fetcher.data) return;
    appliedRef.current = fetcher.data;

    if (fetcher.data.error) {
      setStatus({ tone: "error", text: fetcher.data.error });
      return;
    }
    if (fetcher.data.answer) {
      onReplace(fetcher.data.answer);
      setStatus({
        tone: "ok",
        text: "Answer rewritten. Review it, then save.",
      });
    }
  }, [fetcher.state, fetcher.data, onReplace]);

  const run = (mode) => {
    if (!answer.trim()) {
      setStatus({ tone: "error", text: "Write an answer first, then use the assistant." });
      return;
    }
    setPrevious(answer);
    setStatus(null);
    fetcher.submit(
      { mode, answer, question: question ?? "" },
      { method: "POST", action: "/app/ai/assist" },
    );
  };

  const undo = () => {
    if (previous === null) return;
    onReplace(previous);
    setPrevious(null);
    setStatus({ tone: "ok", text: "Reverted to your previous answer." });
  };

  return (
    <div
      style={{
        marginTop: "10px",
        padding: "12px 14px",
        border: "1px solid #E5E7EB",
        borderRadius: "11px",
        background: "#F9FAFB",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: PALETTE.indigo.text,
        }}
      >
        <Icon name="spark" size={13} />
        Rewrite with AI
      </span>

      <div
        role="group"
        aria-label="Rewrite this answer"
        style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}
      >
        {MODES.map((mode) => (
          <s-button
            key={mode.key}
            onClick={() => run(mode.key)}
            disabled={busy || undefined}
          >
            {mode.label}
          </s-button>
        ))}
        {previous !== null && !busy && (
          <s-button onClick={undo} accessibilityLabel="Undo the AI rewrite">
            Undo
          </s-button>
        )}
      </div>

      <p className="fq-row-sub" style={{ margin: 0 }}>
        Facts are preserved — only the wording changes. Each rewrite uses one AI
        credit.
      </p>

      {/* The only cue that the textarea changed, for anyone not watching it. */}
      <div aria-live="polite">
        {busy && (
          <span className="fq-quiet">
            <s-spinner size="base" accessibilityLabel="Rewriting answer" />
            Rewriting…
          </span>
        )}
        {!busy && status && (
          <span
            className="fq-quiet"
            style={{
              color: status.tone === "error" ? PALETTE.red.text : PALETTE.green.text,
            }}
          >
            <Icon name={status.tone === "error" ? "alert" : "check"} size={14} />
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
