// "Generate with AI" — scope, count, and the submit that starts a generation.
//
// The scope toggle is a real radio group rather than styled buttons: a
// merchant using a screen reader hears "This product, 1 of 2" and can arrow
// between them, which is what the control actually is.
//
// The product picker is App Bridge's own `shopify.resourcePicker`. Building a
// bespoke product search here would mean paginating the Admin API and
// reimplementing a UI merchants already know — and it would go stale the
// moment Shopify changes theirs.

import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Card, CardHead, Slider, Icon, PALETTE } from "./ui";
import { AiCreditMeter } from "./AiCreditMeter";

const MIN_COUNT = 3;
const MAX_COUNT = 15;
const DEFAULT_COUNT = 8;

export function AiGenerateModal({ plan, generating, error, onGenerate, onCancel }) {
  const shopify = useAppBridge();
  const [scope, setScope] = useState("store");
  const [product, setProduct] = useState(null);
  const [count, setCount] = useState(DEFAULT_COUNT);

  // Switching back to whole-store shouldn't silently keep a product pinned —
  // the submit below reads `product` and would generate the wrong thing.
  useEffect(() => {
    if (scope === "store") setProduct(null);
  }, [scope]);

  const pickProduct = async () => {
    try {
      const picked = await shopify.resourcePicker({
        type: "product",
        multiple: false,
        action: "select",
      });
      if (picked?.length) {
        setProduct({ id: picked[0].id, title: picked[0].title });
      }
    } catch (pickerError) {
      // Cancelling the picker rejects in some App Bridge versions; that is
      // not an error worth showing anyone.
      console.warn("[Faqly] Product picker dismissed:", pickerError);
    }
  };

  const blocked = scope === "product" && !product;
  const exhausted = plan?.remaining === 0;

  return (
    <Card aria-labelledby="fq-ai-generate-heading">
      <CardHead
        id="fq-ai-generate-heading"
        title="Generate FAQs with AI"
        subtitle="Drafts are written from your real store data — policies, product details, prices. Anything the AI can't source is left as a placeholder for you to fill in."
      />

      {error && (
        <s-banner tone="critical" heading="Couldn't generate">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <fieldset className="fq-fieldset">
        <legend className="fq-legend">What should it write about?</legend>

        <div
          role="radiogroup"
          aria-label="Generation scope"
          style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
        >
          {[
            { value: "store", label: "Whole store", hint: "Shipping, returns, payment" },
            { value: "product", label: "This product", hint: "Details, variants, price" },
          ].map((option) => {
            const selected = scope === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setScope(option.value)}
                style={{
                  flex: "1 1 180px",
                  textAlign: "left",
                  cursor: "pointer",
                  font: "inherit",
                  padding: "12px 14px",
                  borderRadius: "11px",
                  background: selected ? PALETTE.indigo.bg : "#FFFFFF",
                  border: `1px solid ${selected ? PALETTE.indigo.accent : "#E5E7EB"}`,
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontSize: "13.5px",
                    fontWeight: 650,
                    color: selected ? PALETTE.indigo.text : "#111827",
                  }}
                >
                  {option.label}
                </span>
                <span style={{ display: "block", fontSize: "12.5px", color: "#6b7280" }}>
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>

        {scope === "product" && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <s-button onClick={pickProduct}>
              {product ? "Change product" : "Select product"}
            </s-button>
            <span className="fq-row-note">
              {product ? product.title : "No product selected yet"}
            </span>
          </div>
        )}

        <Slider
          id="fq-ai-count"
          label="How many FAQs"
          value={count}
          min={MIN_COUNT}
          max={MAX_COUNT}
          unit=""
          onChange={setCount}
        />
      </fieldset>

      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
          borderTop: "1px solid #F3F4F6",
          paddingTop: "14px",
        }}
      >
        <AiCreditMeter plan={plan} compact />
        <span style={{ flex: "1 1 auto" }} />
        <s-button onClick={onCancel} disabled={generating || undefined}>
          Cancel
        </s-button>
        <s-button
          variant="primary"
          disabled={blocked || generating || exhausted || undefined}
          loading={generating || undefined}
          onClick={() =>
            onGenerate({ productId: product?.id ?? null, count })
          }
        >
          {generating ? "Generating…" : `Generate ${count} FAQs`}
        </s-button>
      </div>

      {/* aria-live so the wait is announced, not just shown. Generation takes
          5-15 seconds and a silent spinner reads as a hung page. */}
      <div aria-live="polite">
        {generating && (
          <span className="fq-quiet">
            <s-spinner size="base" accessibilityLabel="Generating FAQs" />
            Writing {count} FAQs from your store data — this usually takes about
            ten seconds.
          </span>
        )}
        {!generating && exhausted && (
          <span className="fq-quiet" style={{ color: PALETTE.amber.text }}>
            <Icon name="alert" size={14} />
            You&apos;ve used all AI generations for this month. Upgrade to continue.
          </span>
        )}
      </div>
    </Card>
  );
}
