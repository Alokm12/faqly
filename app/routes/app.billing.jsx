// Plans & billing.
//
// EVERY CHARGE GOES THROUGH SHOPIFY. `billing.request` returns a Shopify
// confirmation URL that the merchant approves inside their own admin; this app
// never sees a card, and an App Store app is not permitted to collect payment
// any other way. Cancelling likewise goes through `billing.cancel`, so the
// merchant's subscription list in Shopify always matches what this page shows.
//
// SHOPIFY IS THE SOURCE OF TRUTH. The loader reconciles the local ShopPlan row
// against the live subscription on every visit, so a merchant who cancelled
// from Shopify's admin sees Free here immediately rather than whatever we last
// cached.
//
// WHAT IS AND ISN'T PAYWALLED
// Only AI generations. Unlimited FAQs, categories, targeting, appearance and
// import/export are on Free and stay there — see the note in models/plans.js.

import { useState } from "react";
import { useLoaderData, useNavigation, useSubmit, useActionData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_IS_TEST, APP_URL } from "../shopify.server";
import { dataContext } from "../models/context.server";
import { reconcilePlan, planCatalogue } from "../models/ShopPlan.server";
import { PLAN_KEYS, PLAN_ORDER, formatPrice } from "../models/plans";
import { toUserMessage } from "../models/errors";
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

export const loader = async ({ request }) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  const plan = await reconcilePlan(ctx.shop, billing, { isTest: BILLING_IS_TEST });
  const currentKey = plan?.plan ?? PLAN_KEYS.FREE;

  return {
    plan,
    plans: planCatalogue(currentKey).sort(
      (a, b) => PLAN_ORDER.indexOf(a.key) - PLAN_ORDER.indexOf(b.key),
    ),
    // Test charges never bill anyone. Surfacing that stops the "did that
    // actually charge me?" question during development, and the banner
    // disappears by itself in production.
    isTestBilling: BILLING_IS_TEST,
  };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "subscribe") {
      const planName = String(formData.get("planName") ?? "");
      // Throws a redirect to Shopify's confirmation page — the merchant
      // approves the charge there, then Shopify sends them back to this route.
      return await billing.request({
        plan: planName,
        isTest: BILLING_IS_TEST,
        returnUrl: `${APP_URL}/app/billing?subscribed=1`,
      });
    }

    if (intent === "cancel") {
      const subscriptionId = String(formData.get("subscriptionId") ?? "");
      if (!subscriptionId) return { error: "No active subscription to cancel." };

      await billing.cancel({
        subscriptionId,
        isTest: BILLING_IS_TEST,
        // The merchant keeps what they paid for until the period ends rather
        // than losing it the moment they click cancel.
        prorate: false,
      });

      // Reconcile immediately so the page reflects Free without a round trip
      // through the webhook.
      await reconcilePlan(session.shop, billing, { isTest: BILLING_IS_TEST });
      return { toast: "Subscription cancelled. You're on the Free plan." };
    }

    return null;
  } catch (error) {
    // billing.request throws a Response to redirect — that is success, not a
    // failure, and it must be allowed through.
    if (error instanceof Response) throw error;
    return {
      error: toUserMessage(
        error,
        "Couldn't update your plan. Please try again.",
        `Billing (${intent})`,
      ),
    };
  }
};

/* ------------------------------------------------------------------ */

function UsageCard({ plan }) {
  if (!plan) return null;

  const percent = plan.limit ? Math.round((plan.used / plan.limit) * 100) : 0;
  const family =
    plan.remaining === 0
      ? PALETTE.red
      : plan.remaining <= Math.max(1, Math.floor(plan.limit * 0.2))
        ? PALETTE.amber
        : PALETTE.green;

  const resets = plan.cycleResetAt
    ? new Date(plan.cycleResetAt).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <Card aria-labelledby="fq-usage-heading">
      <CardHead
        id="fq-usage-heading"
        title="This month's AI usage"
        subtitle={
          resets
            ? `Your allowance resets on ${resets}. Unused generations don't roll over.`
            : "Unused generations don't roll over."
        }
        action={<Tag tone="info">{plan.planLabel} plan</Tag>}
      />

      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <span
          style={{
            fontSize: "30px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: family.text,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {plan.used}
        </span>
        <span className="fq-row-note">of {plan.limit} generations used</span>
      </div>

      {/* Decorative — the sentence above already states the numbers. */}
      <div className="fq-progress-track" aria-hidden="true">
        <div
          className="fq-progress-fill"
          style={{ width: `${percent}%`, background: family.accent }}
        />
      </div>

      {plan.remaining === 0 && (
        <Callout tone="action" heading="You're out of generations">
          Upgrade below for more this month, or wait until{" "}
          {resets ?? "your next cycle"} — everything else in Faqly keeps working
          either way.
        </Callout>
      )}
    </Card>
  );
}

function PlanCard({ plan, currentKey, busy, onSelect, onCancel, subscriptionId }) {
  const isCurrent = plan.key === currentKey;
  const isFree = plan.key === PLAN_KEYS.FREE;
  const isDowngrade =
    PLAN_ORDER.indexOf(plan.key) < PLAN_ORDER.indexOf(currentKey);

  return (
    <div
      className="fq-card"
      style={{
        gap: "14px",
        borderColor: isCurrent ? PALETTE.indigo.accent : "#E5E7EB",
        borderWidth: isCurrent ? "2px" : "1px",
        background: isCurrent ? PALETTE.indigo.bg : "#FFFFFF",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <h3 className="fq-card-title" style={{ fontSize: "17px" }}>
          {plan.label}
        </h3>
        {isCurrent && (
          <Tag tone="info">
            <Icon name="check" size={12} />
            Current plan
          </Tag>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
        <span
          style={{
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#111827",
          }}
        >
          {formatPrice(plan)}
        </span>
        {plan.amount > 0 && <span className="fq-row-note">per month</span>}
      </div>

      <p className="fq-card-sub" style={{ margin: 0 }}>
        {plan.tagline}
      </p>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "7px",
        }}
      >
        {plan.features.map((feature) => (
          <li
            key={feature}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
              fontSize: "13px",
              lineHeight: 1.45,
              color: "#374151",
            }}
          >
            <span style={{ color: PALETTE.green.accent, flex: "0 0 auto", marginTop: "1px" }}>
              <Icon name="check" size={14} />
            </span>
            {feature}
          </li>
        ))}
      </ul>

      <span style={{ flex: "1 1 auto" }} />

      {isCurrent ? (
        isFree ? (
          <s-button disabled>Your current plan</s-button>
        ) : (
          <s-button
            onClick={onCancel}
            disabled={busy || undefined}
            accessibilityLabel={`Cancel the ${plan.label} plan`}
          >
            Cancel subscription
          </s-button>
        )
      ) : isFree ? (
        // Downgrading to Free is cancelling; there is nothing to subscribe to.
        <s-button
          onClick={onCancel}
          disabled={busy || !subscriptionId || undefined}
          accessibilityLabel="Downgrade to the Free plan"
        >
          Downgrade to Free
        </s-button>
      ) : (
        <s-button
          variant="primary"
          onClick={() => onSelect(plan)}
          disabled={busy || undefined}
          accessibilityLabel={`${isDowngrade ? "Switch to" : "Upgrade to"} the ${plan.label} plan at ${formatPrice(plan)} per month`}
        >
          {isDowngrade ? `Switch to ${plan.label}` : `Upgrade to ${plan.label}`}
          {plan.trialDays > 0 && !isDowngrade ? ` — ${plan.trialDays} days free` : ""}
        </s-button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Billing() {
  const { plan, plans, isTestBilling } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const busy = navigation.state !== "idle";
  const currentKey = plan?.plan ?? PLAN_KEYS.FREE;

  const subscribe = (target) => {
    submit(
      { intent: "subscribe", planName: target.name },
      { method: "POST" },
    );
  };

  const cancel = () => {
    submit(
      { intent: "cancel", subscriptionId: plan?.subscriptionId ?? "" },
      { method: "POST" },
    );
    setConfirmingCancel(false);
  };

  return (
    <s-page heading="Plans & billing">
      <s-link slot="breadcrumbs" href="/app/faqs">
        ← FAQs
      </s-link>

      <AppStyles />

      <div className="fq">
        {actionData?.error && (
          <s-banner tone="critical" heading="Couldn't update your plan">
            <s-paragraph>{actionData.error}</s-paragraph>
          </s-banner>
        )}
        {actionData?.toast && (
          <s-banner tone="success" heading={actionData.toast} />
        )}

        <PageIntro title="Plans & billing">
          Faqly is free to use. Paid plans add monthly AI generations — every
          other feature is on every plan.
        </PageIntro>

        {isTestBilling && (
          <s-banner tone="info" heading="Development store — charges are test only">
            <s-paragraph>
              Subscribing here creates a test charge. Nothing is billed, and you
              can approve and cancel it as many times as you like.
            </s-paragraph>
          </s-banner>
        )}

        <UsageCard plan={plan} />

        {confirmingCancel && (
          <Callout tone="action" heading="Cancel your subscription?">
            You&apos;ll keep {plan?.planLabel} features until the end of the
            current billing period, then move to Free with 5 AI generations a
            month. Your FAQs, categories and settings are untouched.
            <span style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
              <s-button onClick={() => setConfirmingCancel(false)}>
                Keep my plan
              </s-button>
              <s-button tone="critical" onClick={cancel} disabled={busy || undefined}>
                Yes, cancel
              </s-button>
            </span>
          </Callout>
        )}

        <section aria-labelledby="fq-plans-heading">
          <h3
            id="fq-plans-heading"
            style={{
              margin: "0 0 10px",
              fontSize: "11.5px",
              fontWeight: 650,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#6b7280",
            }}
          >
            Choose a plan
          </h3>

          <div className="fq-stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {plans.map((entry) => (
              <PlanCard
                key={entry.key}
                plan={entry}
                currentKey={currentKey}
                busy={busy}
                subscriptionId={plan?.subscriptionId}
                onSelect={subscribe}
                onCancel={() => setConfirmingCancel(true)}
              />
            ))}
          </div>
        </section>

        <Card aria-labelledby="fq-billing-faq-heading">
          <CardHead
            id="fq-billing-faq-heading"
            title="How billing works"
            subtitle="Everything is handled by Shopify — Faqly never sees your card."
          />
          <div className="fq-toggles">
            {[
              [
                "You're charged through Shopify",
                "Subscriptions appear on your regular Shopify invoice alongside your other apps. Approving a plan happens on Shopify's own confirmation page.",
              ],
              [
                "Changing plans is immediate",
                "Upgrades take effect straight away and Shopify prorates the difference. Your used generations carry over — upgrading mid-month raises the ceiling rather than resetting the count.",
              ],
              [
                "Cancelling keeps your content",
                "You drop to Free at the end of the billing period. Every FAQ, category, and setting stays exactly as it is — only the monthly AI allowance changes.",
              ],
              [
                "Unused generations don't roll over",
                "The allowance resets 30 days after your first generation, and again every 30 days after that.",
              ],
            ].map(([title, body]) => (
              <div className="fq-toggle" key={title}>
                <div className="fq-toggle-main">
                  <span className="fq-toggle-label">{title}</span>
                  <span className="fq-toggle-desc">{body}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
