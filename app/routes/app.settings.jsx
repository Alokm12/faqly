// Faqly settings.
//
// WHAT IS AND ISN'T ON THIS PAGE
// The layout follows a supplied design: a title block, a tab strip, and
// stacked cards with small uppercase legends. Three of that design's six
// tabs are here — General, SEO and Integrations — and they hold every
// setting the app actually has, restyled to match.
//
// The other three are absent on purpose:
//   AI Settings    the app has no model, no provider and no key. A tone
//                  picker that feeds nothing is a control that lies.
//   Languages      nothing in the schema stores a translation, so a
//                  "78% translated" bar would be an invented number.
//   Access & Roles staff access to an embedded app is Shopify's, not ours.
//                  Shipping our own user directory beside theirs would
//                  give merchants two answers to "who can edit this?" and
//                  only one of them would be enforced.
// Each becomes a tab the moment the feature behind it exists; the tab
// strip is data-driven precisely so that is a one-line change.
//
// WIDGET APPEARANCE LIVES IN THE THEME EDITOR
// The design's "Widget title" and "Search placeholder" fields are real
// settings — they are just not ours. extensions/faqly-widget defines them
// in its block schema, so the merchant sets them in the theme editor with
// a live preview. Duplicating them here would create a second source of
// truth that silently disagrees with the first. The Integrations tab links
// out to the right place instead.
//
// UNSAVED STATE
// Tabs are client state, not a URL param. A tab change must not re-run the
// loader, because the effect that syncs server data into the form would
// then wipe whatever the merchant had typed on the tab they just left.
// `?tab=` is still honoured on first render so links into a section work.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import {
  getSettings,
  saveSettings,
  APPEARANCE_RANGES,
  ACCENT_PRESETS,
} from "../models/Settings.server";
import { FaqStatus } from "../models/faq-status";
import { toUserMessage } from "../models/errors";
import { mirrorEnabled } from "../services/metaobject-sync.server";
import { getStorefrontFaqs } from "../services/storefront-faqs.server";
import {
  getWidgetThemeStatus,
  buildWidgetDeepLink,
} from "../services/theme-widget.server";
import {
  AppStyles,
  PreviewStyles,
  PageIntro,
  Tabs,
  TabPanel,
  SettingsCard,
  Field,
  ToggleList,
  ToggleRow,
  IntegrationRow,
  SaveBar,
  Callout,
  Tag,
  Icon,
  ColorSwatches,
  Slider,
  Disclosure,
  SegmentedControl,
  WidgetPreview,
} from "../components/ui";

const TABS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "seo", label: "SEO" },
  { id: "integrations", label: "Integrations" },
];

/** The roundness sliders shown before the "fine-tune" disclosure. */
const PRIMARY_RADII = ["radiusCard", "radiusWidget"];
const SECONDARY_RADII = ["radiusTabbar", "radiusPill", "radiusButton", "radiusIcon"];

const DEVICES = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  // getWidgetThemeStatus resolves to { status: "unknown" } on a missing
  // scope or a network blip rather than throwing, so the Integrations tab
  // can say "we couldn't check" instead of taking the page down with it.
  //
  // The preview is fed by the same function the storefront calls, with no
  // product or collection context, so what a merchant sees on the
  // Appearance tab is literally what the widget receives on a page with no
  // targeting — not a mock-up of it.
  const [settings, theme, storefront] = await Promise.all([
    getSettings(ctx),
    getWidgetThemeStatus(ctx.graphql),
    getStorefrontFaqs(ctx.shop, { productId: null, collectionIds: [] }),
  ]);

  return {
    settings,
    shopDomain: session.shop,
    theme: { ...theme, deepLink: buildWidgetDeepLink(session.shop) },
    mirrorOn: mirrorEnabled(),
    // Trimmed hard: the preview shows one group's first three answers, and
    // a store with hundreds of published FAQs should not ship all of them
    // to the admin to render three.
    preview: {
      categories: storefront.categories.slice(0, 4).map((category) => ({
        key: category.key,
        name: category.name,
        icon: category.icon,
        faqs: category.faqs.slice(0, 3).map((faq) => ({
          question: faq.question,
          answer: faq.answer.length > 180 ? `${faq.answer.slice(0, 180)}…` : faq.answer,
        })),
      })),
    },
    ranges: APPEARANCE_RANGES,
    presets: ACCENT_PRESETS,
  };
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

        // Appearance is passed through as the raw form strings on purpose.
        // saveSettings → sanitizeAppearance is the one place that parses,
        // clamps and hex-checks them, and re-doing any of that here would
        // create a second set of bounds to keep in step with the sliders.
        accentColor: data.accentColor,
        fontSize: data.fontSize,
        radiusWidget: data.radiusWidget,
        radiusTabbar: data.radiusTabbar,
        radiusPill: data.radiusPill,
        radiusCard: data.radiusCard,
        radiusButton: data.radiusButton,
        radiusIcon: data.radiusIcon,
        searchEnabled: data.searchEnabled === "true",
        searchPlaceholder: data.searchPlaceholder,
      },
      ctx,
    );
  } catch (error) {
    // Returned as data rather than thrown: letting it bubble replaces the
    // whole page with the React Router error boundary, which gives no hint
    // about what failed. This way the page stays up and keeps the form.
    //
    // toUserMessage is what stops the banner from becoming a Prisma dump.
    // A schema mismatch used to render its entire invocation — every
    // column, every argument, the shop domain — into the admin, which told
    // the merchant nothing they could act on. The detail goes to the
    // server log now; they get a sentence.
    return {
      error: toUserMessage(error, "Could not save settings. Please try again.", "Save settings"),
    };
  }

  return { saved: true };
};

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

/**
 * These three toggles save a preference for behaviour that has not been
 * built. The badge is not decoration — without it the switches read as
 * live controls, and a merchant who turns one on and sees no change on
 * their storefront has been misled by the UI.
 */
function SoonBadge() {
  return <Tag tone="info">Coming soon</Tag>;
}

/* ------------------------------------------------------------------ */
/* General                                                             */
/* ------------------------------------------------------------------ */

function GeneralTab({ settings, update }) {
  return (
    <>
      <SettingsCard legend="FAQ defaults">
        <Field
          label="Default status for new FAQs"
          hint="You can still change this per FAQ before publishing"
          htmlFor="defaultStatus"
        >
          <s-select
            id="defaultStatus"
            label="Default status for new FAQs"
            labelAccessibilityVisibility="exclusive"
            value={settings.defaultStatus}
            onChange={(event) => update("defaultStatus", event.target.value)}
          >
            <s-option value={FaqStatus.DRAFT}>Draft — hidden until you publish</s-option>
            <s-option value={FaqStatus.PUBLISHED}>Published — live immediately</s-option>
          </s-select>
        </Field>
      </SettingsCard>

      <SettingsCard legend="Branding">
        <ToggleList>
          <ToggleRow
            id="poweredByVisible"
            label={'Show "Powered by Faqly"'}
            description="A small attribution line under the FAQ widget on your storefront. Your theme block has its own credit setting too — whichever is off wins."
            checked={settings.poweredByVisible}
            onChange={(value) => update("poweredByVisible", value)}
          />
        </ToggleList>
      </SettingsCard>

      <SettingsCard legend="Data & privacy">
        <ToggleList>
          <ToggleRow
            id="analyticsEnabled"
            label="Collect anonymous view analytics"
            badge={<SoonBadge />}
            description="Would count FAQ views and searches to power performance reports. Nothing is collected today — this saves your preference for when the feature ships."
            checked={settings.analyticsEnabled}
            onChange={(value) => update("analyticsEnabled", value)}
          />
          <ToggleRow
            id="feedbackEnabled"
            label="Enable helpful / not helpful feedback"
            badge={<SoonBadge />}
            description="Would let shoppers rate individual answers. The widget shows no rating buttons today — this saves your preference for when the feature ships."
            checked={settings.feedbackEnabled}
            onChange={(value) => update("feedbackEnabled", value)}
          />
        </ToggleList>
      </SettingsCard>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

/**
 * Controls on the left, live preview on the right.
 *
 * The preview reads the working copy of `settings`, not the saved values,
 * so every slider updates it as it moves. That is the whole reason this
 * lives in the app rather than the theme editor: it is the one thing the
 * theme editor could not give us once appearance stopped being a theme
 * setting.
 */
function AppearanceTab({ settings, update, ranges, presets, preview, theme }) {
  const [device, setDevice] = useState("desktop");

  return (
    <>
      {theme.status === "missing" && (
        <Callout tone="action" heading="Not visible yet">
          These changes save fine, but nothing reaches shoppers until the Faqly
          block is on your live theme. The Integrations tab has a one-click link.
        </Callout>
      )}

      <div className="fq-appearance">
        <div className="fq-appearance-col">
          <SettingsCard legend="Accent colour">
            <ColorSwatches
              presets={presets}
              value={settings.accentColor}
              onChange={(value) => update("accentColor", value)}
              inputId="accentColorCustom"
            />
          </SettingsCard>

          <SettingsCard legend="Type & corners">
            <Slider
              id="fontSize"
              label={ranges.fontSize.label}
              value={settings.fontSize}
              min={ranges.fontSize.min}
              max={ranges.fontSize.max}
              unit={ranges.fontSize.unit}
              onChange={(value) => update("fontSize", value)}
            />

            {PRIMARY_RADII.map((key) => (
              <Slider
                key={key}
                id={key}
                label={`Roundness — ${ranges[key].label.toLowerCase()}`}
                value={settings[key]}
                min={ranges[key].min}
                max={ranges[key].max}
                unit={ranges[key].unit}
                onChange={(value) => update(key, value)}
              />
            ))}

            {/* The two above are what almost anyone wants to change. The
                remaining four are here rather than removed — the theme
                editor offered all six and dropping some would be a
                downgrade dressed up as a redesign. */}
            <Disclosure summary="Fine-tune the other corners">
              {SECONDARY_RADII.map((key) => (
                <Slider
                  key={key}
                  id={key}
                  label={ranges[key].label}
                  value={settings[key]}
                  min={ranges[key].min}
                  max={ranges[key].max}
                  unit={ranges[key].unit}
                  onChange={(value) => update(key, value)}
                />
              ))}
            </Disclosure>
          </SettingsCard>

          <SettingsCard legend="Widget options">
            <ToggleList>
              <ToggleRow
                id="searchEnabled"
                label="Show search bar"
                description="Lets shoppers filter your FAQs as they type, across both questions and answers."
                checked={settings.searchEnabled}
                onChange={(value) => update("searchEnabled", value)}
              />
            </ToggleList>

            {settings.searchEnabled && (
              <Field
                label="Search placeholder"
                hint={`${settings.searchPlaceholder.length}/80`}
                htmlFor="searchPlaceholder"
              >
                <s-text-field
                  id="searchPlaceholder"
                  label="Search placeholder"
                  labelAccessibilityVisibility="exclusive"
                  value={settings.searchPlaceholder}
                  maxLength={80}
                  onChange={(event) => update("searchPlaceholder", event.target.value)}
                />
              </Field>
            )}
          </SettingsCard>
        </div>

        <div className="fq-card fq-preview-card">
          <div className="fq-preview-chrome">
            <span className="fq-preview-dots" aria-hidden="true">
              <span style={{ background: "#F87171" }} />
              <span style={{ background: "#FBBF24" }} />
              <span style={{ background: "#34D399" }} />
            </span>
            <span className="fq-preview-url">Live preview — your published FAQs</span>
            <SegmentedControl
              label="Preview width"
              options={DEVICES}
              value={device}
              onChange={setDevice}
            />
          </div>

          <div className="fq-preview-stage" data-device={device}>
            <WidgetPreview
              appearance={settings}
              categories={preview.categories}
              poweredBy={settings.poweredByVisible}
              device={device}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* SEO                                                                 */
/* ------------------------------------------------------------------ */

function SeoTab({ settings, update }) {
  return (
    <>
      <SettingsCard legend="Structured data">
        <ToggleList>
          <ToggleRow
            id="schemaEnabled"
            label="Enable FAQ schema (JSON-LD)"
            badge={<SoonBadge />}
            description="Would add FAQPage markup so your answers can appear directly in Google results. No markup is output today — this saves your preference for when the feature ships."
            checked={settings.schemaEnabled}
            onChange={(value) => update("schemaEnabled", value)}
          />
        </ToggleList>

        {/* The design put a Google result preview here. A preview of markup
            that is not emitted would be the most convincing false claim on
            the page, so this says what the blocker actually is instead. */}
        <Callout tone="action" heading="Why this isn't on yet">
          Google only reliably indexes FAQ markup when the answer text is in the
          page HTML. The widget loads answers after the page does, so the markup
          has to wait for the server-rendered path — the metaobject mirror on the
          Integrations tab is the groundwork for it.
        </Callout>
      </SettingsCard>

      <SettingsCard legend="Page metadata">
        <p className="fq-toggle-desc" style={{ margin: 0 }}>
          Faqly renders inside a section of your own theme, so the page title and
          meta description belong to whichever page you placed the block on. Edit
          them in the Shopify admin under <strong>Online Store → Pages</strong>,
          or in the theme editor for a product or collection template.
        </p>
      </SettingsCard>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Integrations                                                        */
/* ------------------------------------------------------------------ */

function ProxyEndpoint({ url }) {
  const shopify = useAppBridge();
  const [copied, setCopied] = useState(false);

  // Restores the button label a couple of seconds after a copy, and
  // cancels that timer if the component goes away first.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      shopify.toast.show("Endpoint copied");
    } catch {
      // Clipboard access is blocked in some embedded contexts. The URL is
      // on screen and selectable, so failing quietly beats an error toast
      // for something the merchant can still do by hand.
      shopify.toast.show("Press ⌘C to copy");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <IntegrationRow
        icon="link"
        family="violet"
        name="App Proxy endpoint"
        description="Where your storefront widget reads FAQs from. Configured automatically — there is nothing to set up."
        side={
          <s-button onClick={copy}>{copied ? "Copied" : "Copy"}</s-button>
        }
      />
      <div className="fq-code">{url}</div>
    </div>
  );
}

function IntegrationsTab({ theme, mirrorOn, shopDomain }) {
  const proxyUrl = `https://${shopDomain}/apps/faqly/faqs`;

  // "unknown" is its own case throughout: a failed lookup must never be
  // rendered as "not installed".
  const widgetStatus =
    theme.status === "installed"
      ? { tone: "positive", label: "Live", icon: "check" }
      : theme.status === "missing"
        ? { tone: "caution", label: "Not added", icon: "alert" }
        : { tone: "neutral", label: "Couldn't check", icon: "alert" };

  return (
    <>
      <IntegrationRow
        icon="layout"
        family="indigo"
        name="Storefront widget"
        description={
          theme.status === "installed"
            ? `Placed on your live theme${theme.themeName ? ` (${theme.themeName})` : ""}. Title, placeholder text, colours and roundness are set in the theme editor.`
            : theme.status === "missing"
              ? "The Faqly block isn't on your live theme yet, so nothing shows to shoppers."
              : "We couldn't reach your theme just now. Open the editor to check."
        }
        side={
          <>
            <Tag tone={widgetStatus.tone}>
              <Icon name={widgetStatus.icon} size={12} />
              {widgetStatus.label}
            </Tag>
            {/* target="_blank" is required: the theme editor refuses to
                load inside the admin's iframe. */}
            {theme.deepLink && (
              <s-button href={theme.deepLink} target="_blank">
                {theme.status === "installed" ? "Customize" : "Add to theme"}
              </s-button>
            )}
          </>
        }
      />

      <ProxyEndpoint url={proxyUrl} />

      <IntegrationRow
        icon="layers"
        family="slate"
        name="Shopify metaobject mirror"
        description={
          mirrorOn
            ? "FAQs are copied into app-owned metaobjects as well as the database. The database stays the source of truth."
            : "Off. FAQs live in Faqly's database only, which is what the storefront widget reads. Turning the mirror on is a code change in metaobject-sync.server.js — it exists for a future server-rendered path."
        }
        side={<Tag tone={mirrorOn ? "positive" : "neutral"}>{mirrorOn ? "On" : "Off"}</Tag>}
      />

      <IntegrationRow
        icon="globe"
        family="slate"
        name="Third-party integrations"
        description="Klaviyo, Gorgias, GA4, Zapier and outgoing webhooks aren't built yet. They'll appear here as real connections when they are — not as buttons that do nothing."
        side={<Tag tone="neutral">Not available</Tag>}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

export default function Settings() {
  const {
    settings: serverSettings,
    shopDomain,
    theme,
    mirrorOn,
    preview,
    ranges,
    presets,
  } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();

  // Read once, on mount. Switching tabs afterwards never touches the URL —
  // see the note at the top of this file.
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get("tab");
    return TABS.some((t) => t.id === requested) ? requested : TABS[0].id;
  });

  const [settings, setSettings] = useState(serverSettings);
  const saving = navigation.state === "submitting";

  // The last values the server confirmed. Comparing against this — rather
  // than against the loader data directly — is what makes "dirty" survive
  // a revalidation that returns the same values we already have.
  const savedRef = useRef(serverSettings);

  useEffect(() => {
    savedRef.current = serverSettings;
    setSettings(serverSettings);
  }, [serverSettings]);

  useEffect(() => {
    if (actionData?.saved) shopify.toast.show("Settings saved");
  }, [actionData, shopify]);

  const dirty = useMemo(
    () =>
      Object.keys(settings).some((key) => settings[key] !== savedRef.current[key]),
    [settings],
  );

  // The browser's own "you have unsaved changes" prompt. Cheap insurance
  // against closing the tab mid-edit, and removed the moment it is clean.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));

  // One row in the database holds all of these, so one save writes all of
  // them regardless of which tab you were looking at. The button says
  // "Save settings", not "Save SEO settings", for exactly that reason.
  const handleSave = () => {
    submit(
      {
        poweredByVisible: String(settings.poweredByVisible),
        schemaEnabled: String(settings.schemaEnabled),
        feedbackEnabled: String(settings.feedbackEnabled),
        analyticsEnabled: String(settings.analyticsEnabled),
        defaultStatus: settings.defaultStatus,

        accentColor: settings.accentColor,
        fontSize: String(settings.fontSize),
        radiusWidget: String(settings.radiusWidget),
        radiusTabbar: String(settings.radiusTabbar),
        radiusPill: String(settings.radiusPill),
        radiusCard: String(settings.radiusCard),
        radiusButton: String(settings.radiusButton),
        radiusIcon: String(settings.radiusIcon),
        searchEnabled: String(settings.searchEnabled),
        searchPlaceholder: settings.searchPlaceholder,
      },
      { method: "POST" },
    );
  };

  const handleDiscard = () => setSettings(savedRef.current);

  return (
    <s-page heading="Settings">
      <s-link slot="breadcrumbs" href="/app/faqs">
        ← FAQs
      </s-link>

      <AppStyles />
      <PreviewStyles />

      <div className="fq">
        {actionData?.error && (
          <s-banner tone="critical" heading="Settings not saved">
            <s-paragraph>{actionData.error}</s-paragraph>
          </s-banner>
        )}

        <PageIntro title="Settings">
          Configure how Faqly behaves across your store.
        </PageIntro>

        <Tabs tabs={TABS} value={tab} onChange={setTab} />

        {/* Only the selected panel is rendered. Keeping all three mounted
            would put the hidden tabs' controls in the tab order, and a
            keyboard user would tab straight out of the visible panel into
            fields they cannot see. */}
        <TabPanel id={tab}>
          {tab === "general" && <GeneralTab settings={settings} update={update} />}
          {tab === "appearance" && (
            <AppearanceTab
              settings={settings}
              update={update}
              ranges={ranges}
              presets={presets}
              preview={preview}
              theme={theme}
            />
          )}
          {tab === "seo" && <SeoTab settings={settings} update={update} />}
          {tab === "integrations" && (
            <IntegrationsTab theme={theme} mirrorOn={mirrorOn} shopDomain={shopDomain} />
          )}
        </TabPanel>

        {/* The Integrations tab is entirely read-only, so it gets no save
            row — an always-disabled button is just clutter. */}
        {tab !== "integrations" && (
          <SaveBar
            dirty={dirty}
            saving={saving}
            onSave={handleSave}
            onDiscard={handleDiscard}
          />
        )}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
