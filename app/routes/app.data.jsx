// "Data & backup" page.
//
// Replaces the temporary /app/seed link. Three things live here:
//   • Export / import — merchant-facing data portability.
//   • Recover from metaobjects — the one-time rescue for FAQs written
//     before the database existed, and after a Shopify wipe.
//   • Diagnostics — what app-reserved definitions this store actually has.

import { useEffect, useRef, useState } from "react";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import { exportBackup, importBackup } from "../services/backup.server";
import { toUserMessage } from "../models/errors";
import {
  importFromMetaobjects,
  inspectDefinitions,
  mirrorEnabled,
  resyncAll,
} from "../services/metaobject-sync.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  const [faqCount, categoryCount, shopRecord, definitions] = await Promise.all([
    prisma.faq.count({ where: { shop: ctx.shop } }),
    prisma.category.count({ where: { shop: ctx.shop } }),
    prisma.shop.findUnique({ where: { domain: ctx.shop } }),
    inspectDefinitions(ctx),
  ]);

  return {
    shopDomain: ctx.shop,
    faqCount,
    categoryCount,
    mirrorOn: mirrorEnabled(),
    lastSyncAt: shopRecord?.lastSyncAt?.toISOString() ?? null,
    lastSyncError: shopRecord?.lastSyncError ?? null,
    definitions: definitions.map((d) => ({
      id: d.id,
      type: d.type,
      name: d.name,
      count: d.metaobjectsCount ?? 0,
    })),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "export") {
      const backup = await exportBackup(ctx);
      const filename = `faqly-backup-${ctx.shop.replace(/\..*$/, "")}-${
        new Date().toISOString().slice(0, 10)
      }.json`;

      // Returned as a downloadable Response rather than JSON data, so the
      // browser saves a file instead of the route re-rendering.
      return new Response(JSON.stringify(backup, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (intent === "import") {
      const raw = formData.get("payload");
      const mode = formData.get("mode") === "overwrite" ? "overwrite" : "skip";
      const stats = await importBackup(JSON.parse(raw), ctx, mode);
      return { toast: "Backup imported", stats };
    }

    if (intent === "recover") {
      const stats = await importFromMetaobjects(ctx);
      return { toast: "Recovery finished", recovery: stats };
    }

    if (intent === "resync") {
      const stats = await resyncAll(ctx);
      return { toast: stats.skipped ? "Mirror is off" : "Mirror rebuilt", resync: stats };
    }
  } catch (error) {
    // Validation the merchant can act on — a wrong file, a newer backup
    // version — is a UserError and comes through verbatim. A JSON parse
    // failure, a dead database or a Prisma mismatch does not: it is logged
    // in full server-side and shown as one sentence.
    return {
      error: toUserMessage(
        error,
        "Something went wrong. Please try again.",
        `Data action (${intent})`,
      ),
    };
  }

  return null;
};

export default function DataPage() {
  const {
    shopDomain,
    faqCount,
    categoryCount,
    mirrorOn,
    lastSyncAt,
    lastSyncError,
    definitions,
  } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const fileInputRef = useRef(null);
  const [importMode, setImportMode] = useState("skip");

  const busy = navigation.state !== "idle";

  useEffect(() => {
    if (actionData?.toast) shopify.toast.show(actionData.toast);
  }, [actionData, shopify]);

  const handleExport = () => {
    // A normal form POST (not fetcher) so the browser handles the download.
    submit({ intent: "export" }, { method: "POST" });
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    submit({ intent: "import", payload: text, mode: importMode }, { method: "POST" });
    // Reset so re-selecting the same file fires change again.
    event.target.value = "";
  };

  // Matches the discovery logic in metaobject-sync.server.js: the entries
  // may live under a previous app id ("app--<old_id>--faq"), not under this
  // app's "$app:" namespace.
  const pick = (suffix) =>
    definitions
      .filter((d) => new RegExp(`(^|--)${suffix}$`).test(d.type))
      .sort((a, b) => b.count - a.count)[0];

  const faqDefinition = pick("faq");
  const categoryDefinition = pick("faq_category");

  return (
    <s-page heading="Data & backup">
      <s-link slot="breadcrumbs" href="/app/faqs">
        ← FAQs
      </s-link>

      <s-stack direction="block" gap="base">
        {actionData?.error ? (
          <s-banner tone="critical" heading="Action failed">
            <s-paragraph>{actionData.error}</s-paragraph>
          </s-banner>
        ) : null}

        {/* --- Current state --- */}
        <s-section heading="What's stored">
          <s-stack direction="block" gap="small-200">
            <s-text>
              {faqCount} FAQ{faqCount === 1 ? "" : "s"} and {categoryCount}{" "}
              categor{categoryCount === 1 ? "y" : "ies"} saved for {shopDomain}.
            </s-text>
            <s-text tone="subdued">
              This data lives in Faqly&apos;s own database. Uninstalling the app no
              longer deletes it — reinstall and everything comes back.
            </s-text>
          </s-stack>
        </s-section>

        {/* --- Export / import --- */}
        <s-section heading="Export & import">
          <s-stack direction="block" gap="base">
            <s-text tone="subdued">
              Download a JSON copy of every FAQ, category and setting. Keep one
              before any big edit.
            </s-text>
            <s-stack direction="inline" gap="small-200">
              <s-button onClick={handleExport} disabled={busy}>
                Download backup
              </s-button>
              <s-button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                Restore from file
              </s-button>
            </s-stack>

            <s-select
              label="If a FAQ already exists"
              value={importMode}
              onChange={(e) => setImportMode(e.target.value)}
            >
              <s-option value="skip">Keep what&apos;s here (safe)</s-option>
              <s-option value="overwrite">Overwrite with the backup</s-option>
            </s-select>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFile}
              style={{ display: "none" }}
            />

            {actionData?.stats ? (
              <s-banner tone="success" heading="Import complete">
                <s-paragraph>
                  {actionData.stats.faqsImported} FAQs and{" "}
                  {actionData.stats.categoriesImported} categories imported.{" "}
                  {actionData.stats.faqsSkipped} FAQs skipped.
                  {actionData.stats.targetingReset
                    ? " Product targeting was cleared because this backup came from a different store."
                    : ""}
                </s-paragraph>
              </s-banner>
            ) : null}
          </s-stack>
        </s-section>

        {/* --- Recovery --- */}
        <s-section heading="Recover FAQs from Shopify metaobjects">
          <s-stack direction="block" gap="base">
            <s-text tone="subdued">
              Earlier versions of Faqly stored FAQs in Shopify metaobjects,
              which Shopify deletes when an app is uninstalled. Run this once to
              pull anything still there into the database. It never overwrites
              an existing FAQ, so it&apos;s safe to run twice.
            </s-text>

            <s-stack direction="block" gap="small-200">
              <s-text>
                FAQ definition:{" "}
                {faqDefinition
                  ? `${faqDefinition.type} — ${faqDefinition.count} entries`
                  : "not found on this store"}
              </s-text>
              <s-text>
                Category definition:{" "}
                {categoryDefinition
                  ? `${categoryDefinition.type} — ${categoryDefinition.count} entries`
                  : "not found on this store"}
              </s-text>
            </s-stack>

            <s-button
              onClick={() => submit({ intent: "recover" }, { method: "POST" })}
              disabled={busy}
            >
              Recover now
            </s-button>

            {actionData?.recovery ? (
              <s-banner
                tone={actionData.recovery.error ? "warning" : "success"}
                heading={
                  actionData.recovery.error
                    ? "Recovery finished with errors"
                    : "Recovery finished"
                }
              >
                <s-paragraph>
                  Found {actionData.recovery.faqsFound} FAQs and{" "}
                  {actionData.recovery.categoriesFound} categories in
                  metaobjects. Imported {actionData.recovery.faqsImported} FAQs
                  and {actionData.recovery.categoriesImported} categories.
                </s-paragraph>
                {actionData.recovery.faqType ? (
                  <s-paragraph>
                    Read from: {actionData.recovery.faqType}
                  </s-paragraph>
                ) : null}
                {actionData.recovery.error ? (
                  <s-paragraph>{actionData.recovery.error}</s-paragraph>
                ) : null}
              </s-banner>
            ) : null}
          </s-stack>
        </s-section>

        {/* --- Mirror --- */}
        <s-section heading="Storefront metaobject mirror">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>Mirror</s-text>
              <s-badge tone={mirrorOn ? "success" : "neutral"}>
                {mirrorOn ? "On" : "Off"}
              </s-badge>
            </s-stack>
            <s-text tone="subdued">
              Optional. Copies FAQs into Shopify metaobjects so a theme can
              render them in Liquid — needed later for indexable FAQ structured
              data. The storefront widget doesn&apos;t need it.
            </s-text>
            {lastSyncAt ? (
              <s-text tone="subdued">
                Last full rebuild: {new Date(lastSyncAt).toLocaleString()}
              </s-text>
            ) : null}
            {lastSyncError ? (
              <s-banner tone="warning" heading="Last mirror write failed">
                <s-paragraph>{lastSyncError}</s-paragraph>
                <s-paragraph>
                  Your FAQs are unaffected — only the optional Shopify copy is
                  out of date.
                </s-paragraph>
              </s-banner>
            ) : null}
            <s-button
              variant="secondary"
              onClick={() => submit({ intent: "resync" }, { method: "POST" })}
              disabled={busy || !mirrorOn}
            >
              Rebuild mirror
            </s-button>
          </s-stack>
        </s-section>

        {/* --- Diagnostics --- */}
        <s-section heading="Diagnostics">
          <s-stack direction="block" gap="small-200">
            <s-text tone="subdued">
              App-reserved metaobject definitions visible to this app right now.
              If a definition you expect is missing, Shopify removed it — which
              is exactly why FAQs are no longer stored there.
            </s-text>
            {definitions.length ? (
              definitions.map((d) => (
                <s-text key={d.type}>
                  {d.type} — {d.count} entries
                </s-text>
              ))
            ) : (
              <s-text>No metaobject definitions found.</s-text>
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
