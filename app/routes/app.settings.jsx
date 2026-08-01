import { useEffect, useState } from "react";
import { useActionData, useLoaderData, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import { getSettings, saveSettings } from "../models/Settings.server";
import { FaqStatus } from "../models/faq-status";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const settings = await getSettings(ctx);
  return { settings, shopDomain: session.shop };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  try {
    await saveSettings(
      {
        poweredByVisible: data.poweredByVisible === "true",
        schemaEnabled: data.schemaEnabled === "true",
        feedbackEnabled: data.feedbackEnabled === "true",
        analyticsEnabled: data.analyticsEnabled === "true",
        defaultStatus: data.defaultStatus,
      },
      ctx,
    );
  } catch (error) {
    // saveSettings throws on metaobject userErrors. Letting that bubble
    // replaced the whole page with the React Router error boundary, which
    // gave no hint about what failed. Returned as data instead so the page
    // stays up and shows the reason.
    return { error: error.message || "Could not save settings" };
  }

  return { saved: true };
};

function ToggleRow({ label, description, badge, checked, onChange }) {
  return (
    <s-stack direction="inline" gap="base" alignItems="start" justifyContent="space-between">
      <s-stack direction="block" gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text>{label}</s-text>
          {badge && <s-badge tone="info">{badge}</s-badge>}
        </s-stack>
        {description && <s-text tone="subdued">{description}</s-text>}
      </s-stack>
      <s-switch checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </s-stack>
  );
}

export default function Settings() {
  const { settings: initialSettings, shopDomain } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [settings, setSettings] = useState(initialSettings);

  // Keeps the form in step with the server after a revalidation — without
  // this the local copy silently diverges if a save fails.
  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    if (actionData?.saved) {
      shopify.toast.show("Settings saved");
    }
  }, [actionData, shopify]);

  const handleSave = () => {
    submit(
      {
        poweredByVisible: String(settings.poweredByVisible),
        schemaEnabled: String(settings.schemaEnabled),
        feedbackEnabled: String(settings.feedbackEnabled),
        analyticsEnabled: String(settings.analyticsEnabled),
        defaultStatus: settings.defaultStatus,
      },
      { method: "POST" },
    );
  };

  const update = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

  const proxyUrl = `https://${shopDomain}/apps/faqly/faqs`;

  return (
    <s-page heading="Settings">
      <s-link slot="breadcrumbs" href="/app">
        ← FAQs
      </s-link>
      <s-button slot="primary-action" variant="primary" onClick={handleSave}>
        Save
      </s-button>

      <s-stack direction="block" gap="base">
        {actionData?.error ? (
          <s-banner tone="critical" heading="Settings not saved">
            <s-paragraph>{actionData.error}</s-paragraph>
          </s-banner>
        ) : null}

        {/* --- General --- */}
        <s-section heading="General">
          <s-stack direction="block" gap="base">
            <s-select
              label="Default status for new FAQs"
              details="Applies when creating a FAQ — you can always change it per-FAQ before publishing."
              value={settings.defaultStatus}
              onChange={(e) => update("defaultStatus", e.target.value)}
            >
              <s-option value={FaqStatus.DRAFT}>Draft</s-option>
              <s-option value={FaqStatus.PUBLISHED}>Published</s-option>
            </s-select>
          </s-stack>
        </s-section>

        {/* --- Branding --- */}
        <s-section heading="Branding">
          <ToggleRow
            label={'Show "Powered by Faqly"'}
            description="A small attribution line under the FAQ widget on your storefront."
            checked={settings.poweredByVisible}
            onChange={(v) => update("poweredByVisible", v)}
          />
        </s-section>

        {/* --- SEO --- */}
        <s-section heading="SEO">
          <ToggleRow
            label="FAQ structured data (FAQPage JSON-LD)"
            description="Helps FAQs show up directly in Google search results. Requires the SEO structured-data feature to be built — this toggle saves your preference for when it ships."
            badge="Coming soon"
            checked={settings.schemaEnabled}
            onChange={(v) => update("schemaEnabled", v)}
          />
        </s-section>

        {/* --- Engagement --- */}
        <s-section heading="Engagement">
          <ToggleRow
            label={'"Was this helpful?" feedback'}
            description="Lets shoppers rate individual FAQ answers. Requires the feedback widget feature to be built — this toggle saves your preference for when it ships."
            badge="Coming soon"
            checked={settings.feedbackEnabled}
            onChange={(v) => update("feedbackEnabled", v)}
          />
        </s-section>

        {/* --- Analytics --- */}
        <s-section heading="Analytics">
          <ToggleRow
            label="Track FAQ views and searches"
            description="Powers the 'Most viewed FAQs' and search-analytics reports. Requires the analytics feature to be built — this toggle saves your preference for when it ships."
            badge="Coming soon"
            checked={settings.analyticsEnabled}
            onChange={(v) => update("analyticsEnabled", v)}
          />
        </s-section>

        {/* --- Integration info (read-only) --- */}
        <s-section heading="Storefront integration">
          <s-stack direction="block" gap="small-200">
            <s-text tone="subdued">
              Your FAQ widget's data endpoint (read-only — this is set up
              automatically, nothing to configure):
            </s-text>
            <s-text-field label="App Proxy endpoint" value={proxyUrl} readOnly />
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
