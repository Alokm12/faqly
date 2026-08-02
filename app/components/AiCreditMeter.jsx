// "7 of 10 AI generations left this month".
//
// Shown wherever a Generate action is available, so the limit is never a
// surprise at the moment of clicking. The bar is decorative — `aria-hidden`,
// with the sentence beside it carrying the whole meaning — and the tone
// switches to a warning before the merchant runs out rather than after.

import { PALETTE, Icon } from "./ui";

export function AiCreditMeter({ plan, compact = false }) {
  if (!plan) return null;

  const { used, limit, remaining } = plan;
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  // Colour is a second signal only. "0 of 5 left" already says it.
  const family =
    remaining === 0
      ? PALETTE.red
      : remaining <= Math.max(1, Math.floor(limit * 0.2))
        ? PALETTE.amber
        : PALETTE.green;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
        ...(compact ? {} : { padding: "2px 0" }),
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12.5px",
          fontWeight: 600,
          color: family.text,
        }}
      >
        <Icon name="spark" size={13} />
        {remaining} of {limit} AI generations left this month
      </span>

      {!compact && (
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 90px",
            height: "5px",
            borderRadius: "999px",
            background: "#F3F4F6",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${percent}%`,
              borderRadius: "999px",
              background: family.accent,
            }}
          />
        </span>
      )}
    </div>
  );
}
