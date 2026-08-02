// Presentational kit for the dashboard.
//
// WHY THIS FILE EXISTS
// The dashboard is the one screen in the app with a bespoke layout — a
// greeting header, a stat row, a trend chart, an activity rail and two
// comparison panels. Building that out of `s-section` alone would flatten
// it into five identical cards, so these primitives supply the surfaces,
// and the route supplies the data and the semantics.
//
// COLOUR AND TYPE COME FROM THE APP, NOT FROM THE MOCKUP
// Every value in `PALETTE` is already in use on the FAQs, Categories and
// Settings screens — indigo/green/amber/violet accents on the Tailwind-ish
// grey ramp — so this page reads as part of the same product. Type is
// Inter, loaded once in root.jsx by the admin itself; nothing here sets a
// font family.
//
// CONTRAST
// Accent colours appear twice, deliberately. `accent` is for fills, bars
// and icon chips, where contrast is judged against a tinted background.
// `text` is a darkened variant used for any accent-coloured *word*, because
// #059669 and #D97706 both fail 4.5:1 on white and #047857 / #B45309 pass.
// Never swap one for the other.
//
// COLOUR IS NEVER THE ONLY SIGNAL
// Every tone carries a word: a delta says "+3 this week", a hidden category
// says "Hidden", an attention row says what is wrong. Arrows and dots are
// aria-hidden decoration on top of that, not a substitute for it.

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

export const PALETTE = {
  indigo: { accent: "#4F46E5", text: "#4338CA", bg: "#EEF2FF", line: "#E0E7FF" },
  green: { accent: "#059669", text: "#047857", bg: "#ECFDF5", line: "#D1FAE5" },
  amber: { accent: "#D97706", text: "#B45309", bg: "#FFFBEB", line: "#FDE68A" },
  violet: { accent: "#7C3AED", text: "#6D28D9", bg: "#F5F3FF", line: "#EDE9FE" },
  red: { accent: "#DC2626", text: "#B91C1C", bg: "#FEF2F2", line: "#FECACA" },
  slate: { accent: "#6b7280", text: "#374151", bg: "#F9FAFB", line: "#E5E7EB" },
};

/** Delta / status tones → the accent family that renders them. */
const TONE_FAMILY = {
  positive: "green",
  caution: "amber",
  critical: "red",
  warning: "amber",
  info: "violet",
  neutral: "slate",
  action: "indigo",
  done: "green",
};

export function toneFamily(tone) {
  return PALETTE[TONE_FAMILY[tone] ?? "slate"];
}

const ARROW = { up: "↑", down: "↓", flat: "→" };

/* ------------------------------------------------------------------ */
/* Stylesheet                                                          */
/* ------------------------------------------------------------------ */

// A single <style> element rather than inline styles for anything that
// needs a media query, :hover, :focus-visible or prefers-reduced-motion —
// none of which the style attribute can express. Inline styles are kept for
// the handful of values that are genuinely per-instance: a bar's height, a
// meter's width, a category's colour.
const STYLES = `
.fq { display: flex; flex-direction: column; gap: 16px; padding-bottom: 8px; }

.fq-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}

/* --- Hero ------------------------------------------------------- */
.fq-hero {
  display: flex; flex-wrap: wrap; gap: 16px 24px;
  align-items: flex-end; justify-content: space-between;
  padding: 24px;
  border: 1px solid #E0E7FF; border-radius: 16px;
  background: linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 52%, #ECFDF5 100%);
}
.fq-hero-greeting {
  margin: 0; font-size: 26px; line-height: 1.2; font-weight: 700;
  letter-spacing: -0.02em; color: #111827;
}
.fq-hero-name { color: #4338CA; }
.fq-hero-sub { margin: 6px 0 0; font-size: 14px; line-height: 1.45; color: #4B5563; }
.fq-hero-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
@media (max-width: 700px) {
  .fq-hero { padding: 20px; }
  .fq-hero-greeting { font-size: 22px; }
}

/* --- Card ------------------------------------------------------- */
.fq-card {
  background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 14px;
  padding: 20px; display: flex; flex-direction: column; gap: 16px;
  min-width: 0;
}
.fq-card-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.fq-card-title { margin: 0; font-size: 15px; font-weight: 650; color: #111827; letter-spacing: -0.01em; }
.fq-card-sub { margin: 4px 0 0; font-size: 13px; line-height: 1.45; color: #6b7280; }
.fq-chip {
  font-size: 12px; font-weight: 600; color: #374151;
  background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 999px;
  padding: 3px 10px; white-space: nowrap;
}

/* --- Stat grid -------------------------------------------------- */
.fq-stats { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 900px) { .fq-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 460px) { .fq-stats { grid-template-columns: minmax(0, 1fr); } }

.fq-stat { gap: 10px; padding: 18px; }
.fq-stat-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fq-stat-label {
  font-size: 11.5px; font-weight: 650; letter-spacing: 0.06em;
  text-transform: uppercase; color: #6b7280;
}
.fq-stat-badge {
  width: 26px; height: 26px; border-radius: 8px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
}
.fq-stat-value {
  font-size: 30px; line-height: 1.05; font-weight: 700;
  letter-spacing: -0.03em; color: #111827; font-variant-numeric: tabular-nums;
}
.fq-delta { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 550; }

/* --- Layout rows ------------------------------------------------ */
.fq-split { display: grid; gap: 16px; grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr); align-items: start; }
.fq-duo { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
@media (max-width: 1040px) {
  .fq-split, .fq-duo { grid-template-columns: minmax(0, 1fr); }
}

/* --- Segmented control ------------------------------------------ */
.fq-seg {
  display: inline-flex; gap: 2px; padding: 3px;
  background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 999px;
}
.fq-seg button {
  appearance: none; border: 0; cursor: pointer;
  font: inherit; font-size: 12.5px; font-weight: 600;
  padding: 5px 12px; border-radius: 999px;
  background: transparent; color: #4B5563;
  transition: background-color 120ms ease, color 120ms ease;
}
.fq-seg button:hover { background: #E5E7EB; color: #111827; }
.fq-seg button[aria-pressed="true"] {
  background: #FFFFFF; color: #111827;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.12);
}
.fq-seg button:focus-visible,
.fq-linkbtn:focus-visible {
  outline: 2px solid #4F46E5; outline-offset: 2px;
}

/* --- Chart ------------------------------------------------------ */
.fq-chart { display: flex; flex-direction: column; gap: 8px; }
.fq-bars { display: flex; align-items: flex-end; gap: 6px; height: 190px; }
.fq-bar-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; height: 100%; }
.fq-bar-value {
  height: 18px; font-size: 11.5px; font-weight: 650; color: #4338CA;
  text-align: center; opacity: 0; transition: opacity 120ms ease;
  font-variant-numeric: tabular-nums;
}
.fq-bar-col:hover .fq-bar-value { opacity: 1; }
.fq-bar-track { flex: 1 1 auto; display: flex; align-items: flex-end; }
.fq-bar {
  width: 100%; border-radius: 6px 6px 3px 3px;
  background: linear-gradient(180deg, #A5B4FC 0%, #6366F1 100%);
  transition: filter 120ms ease;
}
.fq-bar-col:hover .fq-bar { filter: saturate(1.25) brightness(0.96); }
.fq-bar-empty { width: 100%; height: 3px; border-radius: 2px; background: #E5E7EB; }
.fq-bar-labels { display: flex; gap: 6px; }
.fq-bar-label {
  flex: 1 1 0; min-width: 0; text-align: center;
  font-size: 11.5px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fq-chart-baseline { height: 1px; background: #E5E7EB; }

/* --- Lists ------------------------------------------------------ */
.fq-list { display: flex; flex-direction: column; }
.fq-list > * + * { border-top: 1px solid #F3F4F6; }
.fq-row { display: flex; gap: 12px; padding: 12px 0; align-items: flex-start; }
.fq-row:first-child { padding-top: 0; }
.fq-row:last-child { padding-bottom: 0; }
.fq-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.fq-row-title { font-size: 14px; font-weight: 600; color: #111827; line-height: 1.35; }
.fq-row-sub { font-size: 12.5px; color: #6b7280; line-height: 1.45; }
.fq-row-side {
  flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end;
  gap: 3px; text-align: right;
}
.fq-row-value { font-size: 15px; font-weight: 700; color: #111827; font-variant-numeric: tabular-nums; }
.fq-row-note { font-size: 12px; color: #6b7280; white-space: nowrap; }
.fq-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; margin-top: 6px; }
.fq-icon-chip {
  width: 28px; height: 28px; border-radius: 9px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
}
.fq-tag {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 650; border-radius: 6px; padding: 2px 7px;
  white-space: nowrap;
}
.fq-inline-links { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; font-size: 12.5px; }

/* The orphan check's live region. It is always in the DOM so that it can
   announce its own result; these two rules stop the empty case from
   spending a card gap and a divider on nothing. Hiding it is only ever
   reached *after* the answer came back clean, never at the moment content
   arrives, so no announcement is lost to display:none. */
.fq-orphan:empty { display: none; }
.fq-orphan:not(:empty) { border-top: 1px solid #F3F4F6; padding-top: 12px; }
.fq-orphan > .fq-row { padding: 0; }

/* --- Meters ----------------------------------------------------- */
.fq-meter { display: flex; flex-direction: column; gap: 7px; padding: 11px 0; }
.fq-meter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.fq-meter-name {
  font-size: 13.5px; font-weight: 600; color: #111827; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  display: flex; align-items: center; gap: 7px;
}
.fq-meter-value {
  font-size: 13.5px; font-weight: 700; color: #111827;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.fq-meter-track { height: 6px; border-radius: 999px; background: #F3F4F6; overflow: hidden; }
.fq-meter-fill { height: 100%; border-radius: 999px; min-width: 4px; }

/* --- Callout ---------------------------------------------------- */
.fq-callout { border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.fq-callout-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; }
.fq-callout-body { font-size: 13px; line-height: 1.5; color: #374151; }

/* --- Checklist -------------------------------------------------- */
.fq-steps { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 760px) { .fq-steps { grid-template-columns: minmax(0, 1fr); } }
.fq-step {
  display: flex; gap: 11px; align-items: flex-start;
  padding: 13px; border: 1px solid #E5E7EB; border-radius: 11px; background: #FFFFFF;
}
.fq-step-done { background: #F9FAFB; border-color: #E5E7EB; }
.fq-step-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.fq-progress-track { height: 7px; border-radius: 999px; background: #F3F4F6; overflow: hidden; }
.fq-progress-fill {
  height: 100%; border-radius: 999px; min-width: 7px;
  background: linear-gradient(90deg, #6366F1 0%, #4F46E5 100%);
}

/* --- Quick actions ---------------------------------------------- */
.fq-actions {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding: 14px 16px; border: 1px solid #E5E7EB; border-radius: 12px; background: #FFFFFF;
}

/* --- Empty / loading -------------------------------------------- */
.fq-quiet { display: flex; align-items: center; gap: 9px; font-size: 13px; color: #6b7280; }
.fq-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 28px 16px; }

.fq-footer { text-align: center; font-size: 12.5px; color: #6b7280; padding: 8px 0 4px; }

/* --- Settings: page intro --------------------------------------- */
.fq-intro { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 2px; }
.fq-intro h2 {
  margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: #111827;
}
.fq-intro p { margin: 0; font-size: 14px; line-height: 1.45; color: #4B5563; }

/* --- Settings: tabs ---------------------------------------------
   A real tablist: one tab stop for the whole strip, arrow keys between
   tabs. The 2px indicator is doubled by a font-weight change so the
   selected tab is not signalled by colour alone. */
.fq-tabs {
  display: flex; gap: 2px; overflow-x: auto; scrollbar-width: thin;
  border-bottom: 1px solid #E5E7EB; margin-bottom: 4px;
}
.fq-tabs button {
  appearance: none; background: none; border: 0; cursor: pointer; font: inherit;
  font-size: 14px; font-weight: 550; color: #6b7280; white-space: nowrap;
  padding: 10px 14px; border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color 120ms ease, border-color 120ms ease;
}
.fq-tabs button:hover { color: #111827; }
.fq-tabs button[aria-selected="true"] { color: #4338CA; border-bottom-color: #4F46E5; font-weight: 700; }
.fq-tabs button:focus-visible { outline: 2px solid #4F46E5; outline-offset: -2px; border-radius: 6px; }

/* --- Settings: section card ------------------------------------- */
.fq-legend {
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.07em;
  text-transform: uppercase; color: #6b7280; padding: 0; margin: 0 0 2px;
}
.fq-fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 16px; }

/* --- Settings: labelled field ----------------------------------- */
.fq-field { display: flex; flex-direction: column; gap: 6px; }
.fq-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.fq-field-label { font-size: 13.5px; font-weight: 600; color: #111827; }
.fq-field-hint { font-size: 12.5px; color: #6b7280; }

/* --- Settings: toggle row --------------------------------------- */
.fq-toggles > * + * { border-top: 1px solid #F3F4F6; }
.fq-toggle {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; padding: 14px 0;
}
.fq-toggle:first-child { padding-top: 0; }
.fq-toggle:last-child { padding-bottom: 0; }
.fq-toggle-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.fq-toggle-label { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; font-weight: 600; color: #111827; }
.fq-toggle-desc { font-size: 12.5px; line-height: 1.5; color: #6b7280; }
.fq-toggle-control { flex: 0 0 auto; padding-top: 2px; }

/* --- Settings: integration row ---------------------------------- */
.fq-integration {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px;
}
.fq-integration-main { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.fq-integration-name { font-size: 14.5px; font-weight: 650; color: #111827; }
.fq-integration-desc { font-size: 12.5px; line-height: 1.5; color: #6b7280; }
.fq-integration-side { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; }

/* --- Settings: save bar ----------------------------------------- */
.fq-savebar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; padding: 14px 16px;
}
.fq-savebar-note { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #6b7280; }

/* --- Settings: read-only value ---------------------------------- */
/* Wraps rather than scrolls. A scrolling box would need its own tab stop
   to satisfy WCAG 2.1.1, and there is no reason to spend one: the URL is
   short enough to show in full at any width. */
.fq-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px; color: #374151; background: #F9FAFB;
  border: 1px solid #E5E7EB; border-radius: 8px; padding: 9px 11px;
  overflow-wrap: anywhere; line-height: 1.5;
}

/* --- Appearance: two-column shell ------------------------------- */
.fq-appearance { display: grid; gap: 16px; grid-template-columns: minmax(0, 360px) minmax(0, 1fr); align-items: start; }
@media (max-width: 1040px) { .fq-appearance { grid-template-columns: minmax(0, 1fr); } }
.fq-appearance-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* --- Appearance: colour swatches -------------------------------- */
.fq-swatches { display: flex; flex-wrap: wrap; gap: 9px; }
.fq-swatch {
  width: 38px; height: 38px; border-radius: 10px; cursor: pointer; padding: 0;
  border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.12);
  position: relative;
}
.fq-swatch:focus-visible { outline: 2px solid #4F46E5; outline-offset: 2px; }
.fq-swatch[aria-pressed="true"] { border-color: #111827; }
/* The tick is a second, non-colour signal that a swatch is chosen — a ring
   alone is invisible to anyone who cannot separate the two greys. */
.fq-swatch[aria-pressed="true"]::after {
  content: ""; position: absolute; inset: 0; margin: auto;
  width: 11px; height: 6px; border-left: 2.5px solid #fff; border-bottom: 2.5px solid #fff;
  transform: rotate(-45deg) translate(1px, -2px);
}
.fq-custom-color { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* --- Appearance: sliders ---------------------------------------- */
.fq-slider { display: flex; flex-direction: column; gap: 6px; }
.fq-slider-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.fq-slider-name { font-size: 13.5px; font-weight: 600; color: #111827; }
.fq-slider-value { font-size: 13px; font-weight: 700; color: #4338CA; font-variant-numeric: tabular-nums; }
.fq-slider input[type="range"] { width: 100%; accent-color: #4F46E5; height: 20px; }
.fq-slider input[type="range"]:focus-visible { outline: 2px solid #4F46E5; outline-offset: 4px; border-radius: 4px; }

.fq-details { border-top: 1px solid #F3F4F6; padding-top: 14px; }
.fq-details > summary {
  cursor: pointer; font-size: 13px; font-weight: 600; color: #4338CA;
  list-style: none; display: flex; align-items: center; gap: 6px;
}
.fq-details > summary::-webkit-details-marker { display: none; }
.fq-details > summary::before { content: "▸"; font-size: 10px; }
.fq-details[open] > summary::before { content: "▾"; }
.fq-details > summary:focus-visible { outline: 2px solid #4F46E5; outline-offset: 3px; border-radius: 4px; }
.fq-details-body { display: flex; flex-direction: column; gap: 14px; padding-top: 14px; }

/* --- Appearance: preview ---------------------------------------- */
.fq-preview-card { padding: 0; overflow: hidden; gap: 0; }
.fq-preview-chrome {
  display: flex; align-items: center; gap: 10px; padding: 11px 14px;
  background: #F9FAFB; border-bottom: 1px solid #E5E7EB;
}
.fq-preview-dots { display: flex; gap: 5px; flex: 0 0 auto; }
.fq-preview-dots span { width: 9px; height: 9px; border-radius: 50%; }
.fq-preview-url {
  flex: 1 1 auto; min-width: 0; background: #FFFFFF; border: 1px solid #E5E7EB;
  border-radius: 7px; padding: 5px 10px; font-size: 11.5px; color: #6b7280;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fq-preview-stage { padding: 18px; background: #F3F4F6; overflow-x: auto; }
.fq-preview-stage[data-device="mobile"] { padding: 18px 8px; }
.fq-preview-frame { margin: 0 auto; transition: max-width 160ms ease; }
.fq-preview-stage[data-device="desktop"] .fq-preview-frame { max-width: 100%; }
.fq-preview-stage[data-device="mobile"] .fq-preview-frame { max-width: 360px; }

@media (prefers-reduced-motion: reduce) {
  .fq-seg button, .fq-bar, .fq-bar-value, .fq-tabs button, .fq-preview-frame { transition: none; }
}
`;

/** Injected once per page by the route that uses this kit. */
export function AppStyles() {
  // eslint-disable-next-line react/no-danger
  return <style dangerouslySetInnerHTML={{ __html: STYLES }} />;
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

// Inline paths rather than `s-icon` so the glyph can inherit an accent
// colour and sit inside a 26px chip. Every one is decoration beside a text
// label, so they are all aria-hidden and none is ever the only signal.
const PATHS = {
  doc: "M6 2h6l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6 0v5h5",
  check: "m4 10.5 4 4 8-8",
  eye: "M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10Zm8.5 2.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z",
  pencil: "M13.5 3.5 16.5 6.5 7 16H4v-3l9.5-9.5Z",
  tag: "M3 3h6l8 8-6 6-8-8V3Zm2.8 2.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z",
  alert: "M10 3 18 17H2L10 3Zm0 5v4m0 2.5v.5",
  clock: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3v4l2.8 1.6",
  spark: "M10 2.5 11.6 7 16 8.5 11.6 10 10 14.5 8.4 10 4 8.5 8.4 7 10 2.5Zm5.5 7.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z",
  folder: "M2.5 5.5A1.5 1.5 0 0 1 4 4h3.6l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z",
  arrow: "M4 10h11m-4.5-4.5L15 10l-4.5 4.5",
  link: "M8.2 11.8a3 3 0 0 0 4.3 0l2.6-2.6a3 3 0 0 0-4.3-4.3l-1 1M11.8 8.2a3 3 0 0 0-4.3 0l-2.6 2.6a3 3 0 0 0 4.3 4.3l1-1",
  layers: "m10 2.5 7 3.8-7 3.8-7-3.8 7-3.8Zm7 7.5-7 3.8L3 10m14 3.7-7 3.8-7-3.8",
  globe: "M10 2.8a7.2 7.2 0 1 0 0 14.4 7.2 7.2 0 0 0 0-14.4Zm0 0c-2 1.9-3 4.3-3 7.2s1 5.3 3 7.2m0-14.4c2 1.9 3 4.3 3 7.2s-1 5.3-3 7.2M3.2 7.8h13.6M3.2 12.2h13.6",
  layout: "M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11ZM3 7.5h14M7.5 7.5V17",
};

export function Icon({ name, size = 15, strokeWidth = 1.8, fill = "none" }) {
  const d = PATHS[name] ?? PATHS.doc;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "0 0 auto" }}
    >
      <path d={d} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({ children, className = "", ...rest }) {
  return (
    <section className={`fq-card ${className}`.trim()} {...rest}>
      {children}
    </section>
  );
}

/**
 * `titleId` is wired to the card's `aria-labelledby` by the caller, so each
 * panel is a landmark a screen reader can jump between by name. The heading
 * level is passed in rather than hard-coded: the page owns its outline.
 */
export function CardHead({ id, title, subtitle, action, level = "h3" }) {
  const Heading = level;
  return (
    <div className="fq-card-head">
      <div style={{ minWidth: 0 }}>
        <Heading className="fq-card-title" id={id}>
          {title}
        </Heading>
        {subtitle && <p className="fq-card-sub">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Chip({ children }) {
  return <span className="fq-chip">{children}</span>;
}

export function Tag({ tone = "neutral", children }) {
  const family = toneFamily(tone);
  return (
    <span
      className="fq-tag"
      style={{ background: family.bg, color: family.text, border: `1px solid ${family.line}` }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                           */
/* ------------------------------------------------------------------ */

export function StatCard({ label, value, family, delta }) {
  const accent = PALETTE[family] ?? PALETTE.slate;
  const deltaTone = toneFamily(delta?.tone);

  return (
    <div className="fq-card fq-stat">
      <div className="fq-stat-head">
        <span className="fq-stat-label">{label}</span>
        <span className="fq-stat-badge" style={{ background: accent.bg }} aria-hidden="true">
          <span
            style={{
              width: "9px",
              height: "9px",
              borderRadius: "50%",
              background: accent.accent,
            }}
          />
        </span>
      </div>

      <span className="fq-stat-value">{value}</span>

      {delta && (
        <span className="fq-delta" style={{ color: deltaTone.text }}>
          {/* Decoration on top of the sentence beside it — the text below
              already says which way things went. */}
          <span aria-hidden="true">{ARROW[delta.direction] ?? ARROW.flat}</span>
          {delta.text}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

/**
 * Real <button>s in a labelled group, with `aria-pressed` carrying the
 * selected state. Tab moves to the group, then each option is reachable —
 * no roving-tabindex machinery to get subtly wrong, and no dependency on
 * colour to say which one is on (the pressed state is announced).
 */
export function SegmentedControl({ label, options, value, onChange }) {
  return (
    <div className="fq-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trend chart                                                         */
/* ------------------------------------------------------------------ */

/**
 * A CSS bar chart, plus the same numbers as a visually hidden table.
 *
 * The bars are `aria-hidden`: a stack of divs conveys nothing to a screen
 * reader, and twelve focusable columns would add twelve tab stops to reach
 * information the table states outright. Sighted mouse users get the value
 * on hover; everyone else gets the table, which is also what a text-only
 * or high-contrast rendering falls back to.
 */
export function BarChart({ series, max, caption }) {
  return (
    <div className="fq-chart">
      <div className="fq-bars" aria-hidden="true">
        {series.map((point) => {
          const share = max > 0 ? (point.value / max) * 100 : 0;
          return (
            <div className="fq-bar-col" key={point.key}>
              <span className="fq-bar-value">{point.value}</span>
              <span className="fq-bar-track">
                {point.value > 0 ? (
                  // The only per-instance value here, and the only reason
                  // this is not a class: a percentage cannot be a token.
                  <span className="fq-bar" style={{ height: `${Math.max(4, share)}%` }} />
                ) : (
                  <span className="fq-bar-empty" />
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="fq-chart-baseline" aria-hidden="true" />

      <div className="fq-bar-labels" aria-hidden="true">
        {series.map((point) => (
          <span className="fq-bar-label" key={point.key}>
            {point.label}
          </span>
        ))}
      </div>

      <table className="fq-sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">FAQs added</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.fullLabel}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meter row                                                           */
/* ------------------------------------------------------------------ */

/**
 * The bar is `aria-hidden` because the count it encodes is printed as text
 * immediately beside it — announcing both would read the same figure twice.
 */
export function MeterRow({ name, count, max, color, note, dotColor }) {
  const share = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="fq-meter">
      <div className="fq-meter-head">
        <span className="fq-meter-name">
          {dotColor && (
            <span
              aria-hidden="true"
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: dotColor,
                flex: "0 0 auto",
              }}
            />
          )}
          {name}
        </span>
        <span className="fq-meter-value">
          {note}
          {note && " "}
          {count}
        </span>
      </div>
      <div className="fq-meter-track" aria-hidden="true">
        <div
          className="fq-meter-fill"
          style={{ width: `${count > 0 ? Math.max(4, share) : 0}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Callout                                                             */
/* ------------------------------------------------------------------ */

export function Callout({ tone = "action", heading, children, footer }) {
  const family = toneFamily(tone);
  return (
    <div
      className="fq-callout"
      style={{ background: family.bg, border: `1px solid ${family.line}` }}
    >
      <span className="fq-callout-head" style={{ color: family.text }}>
        <Icon name={tone === "done" ? "check" : "spark"} size={14} />
        {heading}
      </span>
      <p className="fq-callout-body">{children}</p>
      {footer}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progress bar                                                        */
/* ------------------------------------------------------------------ */

/**
 * Decorative, and marked so: the "2 of 4 complete" sentence rendered next
 * to it is what actually gets announced.
 */
export function ProgressBar({ completed, total }) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="fq-progress-track" aria-hidden="true">
      <div className="fq-progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

/* ================================================================== */
/* Settings primitives                                                 */
/* ================================================================== */

/**
 * Page intro — the big title and one-line description above the tabs.
 *
 * `s-page` already renders "Settings" in the admin title bar, so this
 * heading is an h2. Repeating the word is deliberate: the title bar
 * scrolls away with the breadcrumb, and the design's intro block is what
 * orients you once it has.
 */
export function PageIntro({ title, children }) {
  return (
    <div className="fq-intro">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

/**
 * A proper ARIA tablist, not a row of buttons that look like one.
 *
 * Roving tabindex: only the selected tab is in the tab order, and Left /
 * Right / Home / End move between them, which is what a screen reader user
 * is told to expect the moment they hear "tab, 1 of 3". Activation is
 * automatic (selection follows focus) because switching panels here is
 * instant and lossless — nothing is fetched and no edit is discarded.
 *
 * @param {{id: string, label: string}[]} tabs
 */
export function Tabs({ tabs, value, onChange, label = "Settings sections" }) {
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === value));

  const onKeyDown = (event) => {
    const keys = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(tabs[next].id);
    // Focus has to follow selection or the next arrow press restarts from
    // whichever tab the browser still thinks is focused.
    document.getElementById(`fq-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div className="fq-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`fq-tab-${tab.id}`}
            aria-selected={selected}
            // Only the selected tab's panel is mounted, so only the
            // selected tab may claim to control one — pointing the others
            // at ids that are not in the document is invalid ARIA.
            aria-controls={selected ? `fq-panel-${tab.id}` : undefined}
            // Roving tabindex, and the reason the key handler lives on the
            // tabs rather than on the tablist: the tablist itself is never
            // focusable, so a listener there would only ever see events
            // that bubbled up from here anyway.
            tabIndex={selected ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The panel half of the tablist. `tabIndex={0}` is required by APG for a
 * panel with no focusable child, and harmless when it has one.
 */
export function TabPanel({ id, children }) {
  return (
    <div
      role="tabpanel"
      id={`fq-panel-${id}`}
      aria-labelledby={`fq-tab-${id}`}
      tabIndex={0}
      className="fq"
    >
      {children}
    </div>
  );
}

/**
 * A settings card with the design's small uppercase legend.
 *
 * It is a real <fieldset>/<legend>, not a styled div: the legend then names
 * every control inside it, so "Enable FAQ schema" is announced as part of
 * "Structured data" rather than floating free.
 */
export function SettingsCard({ legend, children }) {
  return (
    <div className="fq-card">
      <fieldset className="fq-fieldset">
        <legend className="fq-legend">{legend}</legend>
        {children}
      </fieldset>
    </div>
  );
}

/** A labelled control with an optional right-aligned hint. */
export function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="fq-field">
      <div className="fq-field-head">
        <label className="fq-field-label" htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <span className="fq-field-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Wraps a run of ToggleRows so they get hairline separators. */
export function ToggleList({ children }) {
  return <div className="fq-toggles">{children}</div>;
}

/**
 * One switch with its label, description and optional badge.
 *
 * The description sits in the visible layout (the design wants it under
 * the label, not inside the control) and is tied back to the switch with
 * `aria-describedby`, so the "what does this actually do" sentence is
 * announced with the control rather than being left as loose text that a
 * screen reader may skip past.
 */
export function ToggleRow({ id, label, description, badge, checked, onChange, disabled }) {
  const describedBy = description ? `${id}-desc` : undefined;
  return (
    <div className="fq-toggle">
      <div className="fq-toggle-main">
        <span className="fq-toggle-label">
          {label}
          {badge}
        </span>
        {description && (
          <span className="fq-toggle-desc" id={describedBy}>
            {description}
          </span>
        )}
      </div>
      <div className="fq-toggle-control">
        {/* labelAccessibilityVisibility="exclusive" keeps the switch's own
            label out of the layout while still naming it — the visible
            text above is the same string, and showing it twice would read
            it twice. */}
        <s-switch
          id={id}
          label={label}
          labelAccessibilityVisibility="exclusive"
          aria-describedby={describedBy}
          checked={checked}
          disabled={disabled || undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
      </div>
    </div>
  );
}

/**
 * An integration row: icon chip, name, description, and a status or action
 * on the right.
 *
 * Status is a <Tag> with a word in it, never a bare coloured dot — "Not
 * added" and "Live" have to survive being read aloud.
 */
export function IntegrationRow({ icon, family = "indigo", name, description, side }) {
  const accent = PALETTE[family] ?? PALETTE.slate;
  return (
    <div className="fq-integration">
      <span
        className="fq-icon-chip"
        style={{
          background: accent.bg,
          color: accent.text,
          width: "38px",
          height: "38px",
          borderRadius: "11px",
        }}
        aria-hidden="true"
      >
        <Icon name={icon} size={19} />
      </span>
      <div className="fq-integration-main">
        <span className="fq-integration-name">{name}</span>
        <span className="fq-integration-desc">{description}</span>
      </div>
      <div className="fq-integration-side">{side}</div>
    </div>
  );
}

/**
 * The save row at the foot of an editable tab.
 *
 * `aria-live` on the note means "Unsaved changes" / "All changes saved" is
 * announced as it becomes true, which is the only cue a non-sighted user
 * gets that the button beside it is now worth pressing.
 */
/* ------------------------------------------------------------------ */
/* Appearance controls                                                 */
/* ------------------------------------------------------------------ */

/**
 * A colour swatch grid plus a native colour input.
 *
 * Real <button>s with `aria-pressed`, not radio-styled divs, and each one
 * is named by its colour rather than by its hex — "Violet" is what a
 * merchant is choosing; "#7C3AED" is how it is stored. The selected
 * swatch carries a tick as well as a ring so the state does not depend on
 * telling two shades of grey apart.
 */
export function ColorSwatches({ presets, value, onChange, inputId }) {
  const normalized = (value || "").toLowerCase();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div className="fq-swatches">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="fq-swatch"
            style={{ background: preset.value }}
            aria-pressed={preset.value.toLowerCase() === normalized}
            aria-label={`${preset.name} (${preset.value})`}
            onClick={() => onChange(preset.value)}
          />
        ))}
      </div>

      <div className="fq-custom-color">
        <label className="fq-field-label" htmlFor={inputId}>
          Custom
        </label>
        {/* A native colour input, so the OS picker and its own keyboard
            support come for free. The hex beside it is the value of
            record and stays readable when the swatch is dark. */}
        <input
          id={inputId}
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#4A5D3A"}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: "42px",
            height: "32px",
            padding: 0,
            border: "1px solid #E5E7EB",
            borderRadius: "8px",
            background: "none",
            cursor: "pointer",
          }}
        />
        <code style={{ fontSize: "12.5px", color: "#374151" }}>
          {(value || "").toUpperCase()}
        </code>
      </div>
    </div>
  );
}

/**
 * A native range input with its value printed beside the label.
 *
 * `type="range"` rather than a custom track: it is keyboard-operable,
 * announces itself as a slider with its min/max/now, and honours the
 * platform's own pointer behaviour. Nothing bespoke would match that for
 * the cost of some styling.
 */
export function Slider({ id, label, value, min, max, step = 1, unit = "px", onChange }) {
  return (
    <div className="fq-slider">
      <div className="fq-slider-head">
        <label className="fq-slider-name" htmlFor={id}>
          {label}
        </label>
        {/* aria-hidden because the input already announces its own value —
            without this a screen reader reads the number twice. */}
        <span className="fq-slider-value" aria-hidden="true">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={`${value}${unit}`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** Progressive disclosure for the settings most merchants never touch. */
export function Disclosure({ summary, children }) {
  return (
    <details className="fq-details">
      <summary>{summary}</summary>
      <div className="fq-details-body">{children}</div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Widget preview                                                      */
/* ------------------------------------------------------------------ */

// The preview's own stylesheet. It is a deliberate, trimmed re-creation of
// extensions/faqly-widget/assets/faqly-widget.css — not an import, because
// that file ships to the storefront and pulling it into the admin bundle
// would couple a merchant-facing deploy to an admin one.
//
// It reads the SAME custom property names the real widget does, so the
// values the sliders produce are the values the storefront will receive.
// If you change a radius or accent rule in the widget CSS, change it here
// too; anything that drifts makes the preview a liar.
const PREVIEW_STYLES = `
.fqp {
  --fqp-accent: #4A5D3A; --fqp-font: 16px;
  --fqp-r-widget: 21px; --fqp-r-tabbar: 50px; --fqp-r-pill: 40px;
  --fqp-r-card: 14px; --fqp-r-icon: 50%;
  border-radius: var(--fqp-r-widget);
  background: linear-gradient(180deg, #EEF3E7 0%, #F6F8F2 100%);
  padding: 26px 20px; font-size: var(--fqp-font); color: #23301a;
  font-family: inherit;
}
.fqp-eyebrow {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: fit-content; margin: 0 auto 14px; padding: 5px 13px;
  border-radius: var(--fqp-r-pill);
  background: color-mix(in srgb, var(--fqp-accent) 12%, white);
  color: var(--fqp-accent); font-size: 0.7em; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase;
}
.fqp-eyebrow span { width: 5px; height: 5px; border-radius: 50%; background: var(--fqp-accent); }
.fqp-title {
  margin: 0 0 8px; text-align: center; line-height: 1.15;
  font-family: Georgia, "Times New Roman", serif; font-size: 1.6em; font-weight: 400;
}
.fqp-title i { color: var(--fqp-accent); }
.fqp-sub { margin: 0 auto 16px; max-width: 42ch; text-align: center; font-size: 0.8em; opacity: 0.75; line-height: 1.5; }
.fqp-search {
  display: flex; align-items: center; gap: 8px; max-width: 420px; margin: 0 auto 14px;
  background: #fff; border: 1px solid rgba(74, 93, 58, 0.12);
  border-radius: var(--fqp-r-card); padding: 9px 12px;
}
.fqp-search em { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--fqp-accent); opacity: 0.5; flex: 0 0 auto; }
.fqp-search span { font-size: 0.82em; opacity: 0.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fqp-pills {
  display: flex; gap: 5px; flex-wrap: wrap; justify-content: center;
  width: fit-content; margin: 0 auto 16px; padding: 5px;
  background: color-mix(in srgb, var(--fqp-accent) 6%, white);
  border-radius: var(--fqp-r-tabbar);
}
.fqp-pill {
  padding: 6px 14px; border-radius: var(--fqp-r-pill); font-size: 0.75em; font-weight: 600;
  background: transparent; color: #23301a; opacity: 0.7;
}
.fqp-pill[data-active="true"] { background: var(--fqp-accent); color: #fff; opacity: 1; }
.fqp-item {
  background: #fff; border: 1px solid rgba(74, 93, 58, 0.12);
  border-radius: var(--fqp-r-card); padding: 14px 16px; margin-bottom: 8px;
  display: flex; align-items: flex-start; gap: 12px;
}
.fqp-q { flex: 1 1 auto; min-width: 0; font-size: 0.9em; font-weight: 600; line-height: 1.4; }
.fqp-a { margin: 8px 0 0; font-size: 0.82em; line-height: 1.55; opacity: 0.72; }
.fqp-toggle {
  flex: 0 0 auto; width: 24px; height: 24px; border-radius: var(--fqp-r-icon);
  background: color-mix(in srgb, var(--fqp-accent) 12%, white); color: var(--fqp-accent);
  display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1;
}
.fqp-item[data-open="true"] .fqp-toggle { background: var(--fqp-accent); color: #fff; }
.fqp-credit { margin: 14px 0 0; text-align: center; font-size: 0.7em; opacity: 0.5; }
.fqp-empty { text-align: center; font-size: 0.85em; opacity: 0.6; padding: 22px 0; }
`;

export function PreviewStyles() {
  // eslint-disable-next-line react/no-danger
  return <style dangerouslySetInnerHTML={{ __html: PREVIEW_STYLES }} />;
}

/**
 * A static render of the storefront widget at the current appearance
 * values.
 *
 * Entirely inert — no accordion, no filtering, nothing focusable. That is
 * on purpose: a preview whose controls half-work invites a merchant to
 * test behaviour here and draw the wrong conclusion. `aria-hidden` and a
 * caption above it mean a screen reader is told what this is instead of
 * being walked through a second, fake copy of their FAQ list.
 */
export function WidgetPreview({ appearance, categories, poweredBy, device }) {
  const style = {
    "--fqp-accent": appearance.accentColor,
    "--fqp-font": `${appearance.fontSize}px`,
    "--fqp-r-widget": `${appearance.radiusWidget}px`,
    "--fqp-r-tabbar": `${appearance.radiusTabbar}px`,
    "--fqp-r-pill": `${appearance.radiusPill}px`,
    "--fqp-r-card": `${appearance.radiusCard}px`,
    "--fqp-r-icon": `${appearance.radiusIcon}%`,
  };

  const first = categories[0];
  const items = (first?.faqs ?? []).slice(0, 3);

  return (
    <div className="fq-preview-frame">
      <div className="fqp" style={style} aria-hidden="true">
        <div className="fqp-eyebrow">
          <span />
          Help Center
        </div>
        <h3 className="fqp-title">
          Frequently asked <i>questions</i>
        </h3>
        <p className="fqp-sub">
          Everything you need to know. Can&apos;t find an answer? Our team is
          always happy to help.
        </p>

        {appearance.searchEnabled && (
          <div className="fqp-search">
            <em />
            <span>{appearance.searchPlaceholder}</span>
          </div>
        )}

        {categories.length > 1 && (
          <div className="fqp-pills">
            <span className="fqp-pill" data-active="true">
              All
            </span>
            {categories.slice(0, 3).map((category) => (
              <span className="fqp-pill" key={category.key}>
                {category.icon ? `${category.icon} ` : ""}
                {category.name}
              </span>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <p className="fqp-empty">
            Publish an FAQ to see it previewed here.
          </p>
        ) : (
          items.map((faq, index) => (
            <div className="fqp-item" key={faq.question} data-open={index === 0}>
              <div className="fqp-q">
                {faq.question}
                {index === 0 && <p className="fqp-a">{faq.answer}</p>}
              </div>
              <span className="fqp-toggle">{index === 0 ? "×" : "+"}</span>
            </div>
          ))
        )}

        {poweredBy && <p className="fqp-credit">Powered by Faqly</p>}
      </div>
      <span className="fq-sr-only">
        Preview showing {device} width with your current appearance settings.
      </span>
    </div>
  );
}

export function SaveBar({ dirty, saving, onSave, onDiscard }) {
  return (
    <div className="fq-savebar">
      <span className="fq-savebar-note" aria-live="polite">
        {dirty ? (
          <>
            <Icon name="pencil" size={14} />
            You have unsaved changes
          </>
        ) : (
          <>
            <Icon name="check" size={14} />
            All changes saved
          </>
        )}
      </span>
      <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {dirty && (
          <s-button onClick={onDiscard} disabled={saving || undefined}>
            Discard
          </s-button>
        )}
        <s-button
          variant="primary"
          onClick={onSave}
          disabled={!dirty || saving || undefined}
          loading={saving || undefined}
        >
          Save settings
        </s-button>
      </span>
    </div>
  );
}
