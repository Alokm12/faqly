import { useEffect, useMemo, useState } from "react";
import {
  useLoaderData,
  useFetcher,
  useSearchParams,
  useNavigate,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import {
  getFaqs,
  updateFaqFields,
  deleteFaq,
  reorderFaqs,
} from "../models/Faq.server";
import {
  getCategories,
  deleteCategory,
  reorderCategories,
} from "../models/Category.server";
import { FaqStatus } from "../models/faq-status";
import {
  getWidgetThemeStatus,
  buildWidgetDeepLink,
} from "../services/theme-widget.server";
import { PortalMenu } from "../components/PortalMenu";
import { AppStyles, Tag } from "../components/ui";
import { AiCreditMeter } from "../components/AiCreditMeter";
import { AiGenerateModal } from "../components/AiGenerateModal";
import { AiReviewList } from "../components/AiReviewList";
import { getPlan } from "../models/ShopPlan.server";
import { aiConfigured } from "../services/ai.server";

const APP_VERSION = "1.0.0";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const [faqs, categories, widget, plan] = await Promise.all([
    getFaqs(ctx),
    getCategories(ctx),
    // Never throws — returns { status: "unknown" } on any failure, which
    // renders no banner. See services/theme-widget.server.js.
    getWidgetThemeStatus(ctx.graphql),
    getPlan(ctx.shop),
  ]);
  return {
    faqs,
    categories,
    widget: {
      ...widget,
      deepLink: buildWidgetDeepLink(session.shop),
    },
    plan,
    // Resolved in the loader, not the component: the provider key must never
    // be referenced from code that ships to the browser. Only this boolean
    // crosses over.
    //
    // `plan` is also required — it comes back null when the Prisma client
    // predates the ShopPlan model, and an AI panel with no credit balance to
    // show is worse than no panel.
    aiEnabled: aiConfigured() && Boolean(plan),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  if (data.intent === "toggleStatus") {
    const newStatus =
      data.status === FaqStatus.PUBLISHED
        ? FaqStatus.DRAFT
        : FaqStatus.PUBLISHED;
    await updateFaqFields(data.id, { status: newStatus }, ctx);
    return {
      toast: newStatus === "PUBLISHED" ? "FAQ published" : "FAQ moved to draft",
    };
  }

  if (data.intent === "deleteFaq") {
    await deleteFaq(data.id, ctx);
    return { toast: "FAQ deleted" };
  }

  if (data.intent === "deleteCategory") {
    await deleteCategory(data.id, ctx);
    return { toast: "Category deleted", categoryDeleted: true };
  }

  if (data.intent === "move") {
    const allFaqs = await getFaqs(ctx);
    const categoryFaqs = allFaqs.filter(
      (f) => (f.categoryHandle || "") === (data.categoryHandle || ""),
    );
    const index = categoryFaqs.findIndex((f) => f.id === data.id);
    const targetIndex = data.direction === "up" ? index - 1 : index + 1;
    if (index === -1 || targetIndex < 0 || targetIndex >= categoryFaqs.length) {
      return null;
    }
    const reordered = [...categoryFaqs];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    // One transaction instead of N parallel writes: the previous
    // Promise.all fired a mutation per FAQ, which on a long list hit
    // Shopify's rate limit and could leave the order half-applied.
    await reorderFaqs(reordered.map((faq) => faq.id), ctx);
    return { toast: "Order updated" };
  }

  if (data.intent === "reorderDrop") {
    const orderedIds = JSON.parse(data.orderedIds || "[]");
    await reorderFaqs(orderedIds, ctx);
    return { toast: "Order updated" };
  }

  if (data.intent === "reorderCategories") {
    const orderedIds = JSON.parse(data.orderedIds || "[]");
    await reorderCategories(orderedIds, ctx);
    return { toast: "Category order updated" };
  }

  return null;
};

function truncate(str, length = 60) {
  if (!str) return "";
  return str.length <= length ? str : str.slice(0, length) + "…";
}

function scopeLabel(faq) {
  const productCount = faq.products?.length ?? 0;
  const collectionCount = faq.collections?.length ?? 0;
  if (productCount === 0 && collectionCount === 0) return "Store-wide";
  const parts = [];
  if (productCount) parts.push(`${productCount} product${productCount > 1 ? "s" : ""}`);
  if (collectionCount) parts.push(`${collectionCount} collection${collectionCount > 1 ? "s" : ""}`);
  return parts.join(", ");
}

const SORTERS = {
  custom: null,
  newest: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
  oldest: (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt),
  az: (a, b) => a.question.localeCompare(b.question),
};

function groupByCategory(faqs, categoryOrder, sortKey) {
  const groups = new Map();
  for (const faq of faqs) {
    const key = faq.categoryHandle || "__uncategorized__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(faq);
  }
  const sorter = SORTERS[sortKey];
  if (sorter) for (const list of groups.values()) list.sort(sorter);

  const ordered = [];
  for (const cat of categoryOrder) {
    if (groups.has(cat.handle)) {
      ordered.push({
        key: cat.handle,
        id: cat.id,
        name: cat.name,
        color: cat.color,
        iconImageUrl: cat.iconImageUrl,
        faqs: groups.get(cat.handle),
      });
    }
  }
  if (groups.has("__uncategorized__")) {
    ordered.push({
      key: "__uncategorized__",
      id: null,
      name: "Uncategorized",
      color: null,
      faqs: groups.get("__uncategorized__"),
    });
  }
  return ordered;
}

const EmptyFaqState = () => (
  <s-section accessibilityLabel="Empty state section">
    <s-grid gap="base" justifyItems="center" paddingBlock="large-400">
      <s-grid justifyItems="center" maxInlineSize="450px">
        <s-heading>Create your first FAQ</s-heading>
        <s-paragraph>
          Answer your customers&apos; most common questions right on your storefront.
        </s-paragraph>
        <s-stack gap="small-200" justifyContent="center" padding="base" paddingBlockEnd="none" direction="inline">
          <s-button href="/app/faqs/new" variant="primary">Create FAQ</s-button>
        </s-stack>
      </s-grid>
    </s-grid>
  </s-section>
);

const NoSearchResults = () => (
  <s-section accessibilityLabel="No search results">
    <s-grid gap="base" justifyItems="center" paddingBlock="large-400">
      <s-heading>No FAQs match your filters</s-heading>
      <s-paragraph>Try a different search term, or clear the filters above.</s-paragraph>
    </s-grid>
  </s-section>
);

/**
 * Shown only when we positively know the app block is absent from the live
 * theme ("missing"). "unknown" — no read_themes scope, API hiccup — renders
 * nothing, because a wrong "your widget is off" is worse than silence.
 *
 * The button is a Theme Editor deep link, so the merchant lands with the
 * block already staged instead of hunting for it in the Add block list.
 * target="_blank" is required: the admin renders us in an iframe, and the
 * theme editor refuses to load inside one.
 */
function WidgetNotInstalledBanner({ widget }) {
  if (widget?.status !== "missing" || !widget.deepLink) return null;

  return (
    <s-banner tone="warning" heading="Your FAQ widget isn't on your live theme yet">
      <s-paragraph>
        FAQs you create here won&apos;t appear on your storefront until the Faqly
        block is added to
        {widget.themeName ? ` your live theme (${widget.themeName})` : " your live theme"}.
        Adding it takes one click — then hit Save in the theme editor.
      </s-paragraph>
      <s-button slot="primary-action" href={widget.deepLink} target="_blank" variant="primary">
        Add widget to theme
      </s-button>
    </s-banner>
  );
}

function StatCard({ label, value, bg, accent }) {
  return (
    <div style={{ background: bg, borderRadius: "8px", padding: "16px", border: `1px solid ${accent}33` }}>
      <s-stack direction="block" gap="small-200">
        <s-text tone="subdued">{label}</s-text>
        <span style={{ fontSize: "28px", fontWeight: 600, color: accent }}>{value}</span>
      </s-stack>
    </div>
  );
}

function StatsRow({ faqs, categoryCount }) {
  const published = faqs.filter((f) => f.status === "PUBLISHED").length;
  const draft = faqs.length - published;
  const stats = [
    { label: "Total FAQs", value: faqs.length, bg: "#EEF2FF", accent: "#4F46E5" },
    { label: "Published", value: published, bg: "#ECFDF5", accent: "#059669" },
    { label: "Draft", value: draft, bg: "#FFFBEB", accent: "#D97706" },
    { label: "Categories", value: categoryCount, bg: "#F5F3FF", accent: "#7C3AED" },
  ];
  return (
    <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
      {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
    </s-grid>
  );
}

function DragHandle() {
  return (
    <span style={{ cursor: "grab", display: "inline-flex", userSelect: "none", padding: "4px" }}>
      <svg width="14" height="20" viewBox="0 0 14 20" fill="none">
        {[0, 1].map((col) =>
          [0, 1, 2].map((row) => (
            <circle key={`${col}-${row}`} cx={col === 0 ? 4 : 10} cy={4 + row * 6} r="1.6" fill="#9ca3af" />
          )),
        )}
      </svg>
    </span>
  );
}

const DRAG_OVER_STYLE = {
  outline: "2px solid #2C6ECB",
  outlineOffset: "-2px",
  borderRadius: "6px",
  boxShadow: "0 0 0 4px rgba(44, 110, 203, 0.12)",
};

function MoreOptionsMenu({ faq, onToggleStatus, onDelete }) {
  const isPublished = faq.status === "PUBLISHED";
  return (
    <PortalMenu
      items={[
        { label: "Edit", href: `/app/faqs/${faq.handle}` },
        { label: isPublished ? "Move to draft" : "Publish", onClick: onToggleStatus },
        {
          label: "Delete",
          destructive: true,
          onClick: () => {
            if (confirm(`Delete "${faq.question}"?`)) onDelete();
          },
        },
      ]}
    />
  );
}

/** Same pattern as MoreOptionsMenu, but for a category card: Edit + Delete only (categories don't have a draft/published concept). */
function CategoryMoreOptionsMenu({ categoryHandle, categoryName, onDelete }) {
  return (
    <PortalMenu
      items={[
        { label: "Edit category", href: `/app/categories/${categoryHandle}` },
        {
          label: "Delete category",
          destructive: true,
          onClick: () => {
            if (confirm(`Delete "${categoryName}"? FAQs in it will become Uncategorized.`)) onDelete();
          },
        },
      ]}
    />
  );
}

function DraggableFaqList({ faqs, sortKey, categoryHandle }) {
  const [localOrder, setLocalOrder] = useState(faqs);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const reorderFetcher = useFetcher();
  const moveFetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => { setLocalOrder(faqs); }, [faqs]);
  useEffect(() => {
    if (reorderFetcher.data?.toast) shopify.toast.show(reorderFetcher.data.toast);
  }, [reorderFetcher.data, shopify]);
  useEffect(() => {
    if (moveFetcher.data?.toast) shopify.toast.show(moveFetcher.data.toast);
  }, [moveFetcher.data, shopify]);

  const dragDisabled = sortKey !== "custom";

  const handleMove = (id, direction) => {
    moveFetcher.submit(
      { intent: "move", id, direction, categoryHandle: categoryHandle || "" },
      { method: "POST" },
    );
  };

  const handleDragStart = (id) => (e) => {
    if (dragDisabled) return;
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const handleDragOver = (id) => (e) => {
    if (dragDisabled || !draggedId) return;
    e.preventDefault();
    e.stopPropagation();
    if (id !== dragOverId) setDragOverId(id);
  };
  const handleDrop = (id) => (e) => {
    if (dragDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (!draggedId || draggedId === id) {
      setDraggedId(null); setDragOverId(null); return;
    }
    const fromIndex = localOrder.findIndex((f) => f.id === draggedId);
    const toIndex = localOrder.findIndex((f) => f.id === id);
    const reordered = [...localOrder];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setLocalOrder(reordered);
    setDraggedId(null); setDragOverId(null);
    reorderFetcher.submit(
      { intent: "reorderDrop", orderedIds: JSON.stringify(reordered.map((f) => f.id)) },
      { method: "POST" },
    );
  };
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };

  return (
    <s-table>
      <s-table-header-row>
        <s-table-header>&nbsp;</s-table-header>
        <s-table-header listSlot="primary">Question</s-table-header>
        <s-table-header>Scope</s-table-header>
        <s-table-header>Status</s-table-header>
        <s-table-header>Updated</s-table-header>
        <s-table-header>&nbsp;</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {localOrder.map((faq, index) => (
          <FaqRow
            key={faq.handle}
            faq={faq}
            dragDisabled={dragDisabled}
            isDragging={draggedId === faq.id}
            isDragOver={dragOverId === faq.id}
            onDragStart={handleDragStart(faq.id)}
            onDragOver={handleDragOver(faq.id)}
            onDrop={handleDrop(faq.id)}
            onDragEnd={handleDragEnd}
            isFirst={index === 0}
            isLast={index === localOrder.length - 1}
            onMove={(direction) => handleMove(faq.id, direction)}
          />
        ))}
      </s-table-body>
    </s-table>
  );
}

function FaqRow({ faq, dragDisabled, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd, isFirst, isLast, onMove }) {
  const statusFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => { if (statusFetcher.data?.toast) shopify.toast.show(statusFetcher.data.toast); }, [statusFetcher.data, shopify]);
  useEffect(() => { if (deleteFetcher.data?.toast) shopify.toast.show(deleteFetcher.data.toast); }, [deleteFetcher.data, shopify]);

  const isBusy = statusFetcher.state !== "idle" || deleteFetcher.state !== "idle";

  // The guards are why `isBusy` exists. Without them a second click while
  // the first request is still in flight fires the action again — harmless
  // for a status toggle, but a second delete submits an id that no longer
  // exists and surfaces as an error toast for a row the merchant already
  // successfully removed.
  const toggleStatus = () => {
    if (isBusy) return;
    statusFetcher.submit({ intent: "toggleStatus", id: faq.id, status: faq.status }, { method: "POST" });
  };
  const handleDelete = () => {
    if (isBusy) return;
    deleteFetcher.submit({ intent: "deleteFaq", id: faq.id }, { method: "POST" });
  };

  const isPublished = faq.status === "PUBLISHED";

  return (
    <s-table-row
      id={faq.handle}
      draggable={!dragDisabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        opacity: isDragging ? 0.35 : 1,
        transition: "opacity 0.12s ease",
        ...(isDragOver ? DRAG_OVER_STYLE : {}),
      }}
    >
      <s-table-cell>
        {/* Drag handle + up/down cluster: the handle is the primary way
            to reorder (grab and move), the tiny up/down arrows beside it
            are a compact, always-available fallback that also works by
            keyboard/screen reader — same reordering result either way. */}
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <span style={{ cursor: dragDisabled ? "default" : "grab" }}>
            <DragHandle />
          </span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <button
              type="button"
              aria-label="Move up"
              disabled={isFirst || dragDisabled}
              onClick={() => onMove("up")}
              style={{
                border: "none", background: "none", cursor: isFirst || dragDisabled ? "default" : "pointer",
                color: isFirst || dragDisabled ? "#d1d5db" : "#6b7280", padding: 0, lineHeight: 1, fontSize: "13px",
              }}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={isLast || dragDisabled}
              onClick={() => onMove("down")}
              style={{
                border: "none", background: "none", cursor: isLast || dragDisabled ? "default" : "pointer",
                color: isLast || dragDisabled ? "#d1d5db" : "#6b7280", padding: 0, lineHeight: 1, fontSize: "13px",
              }}
            >
              ▼
            </button>
          </div>
        </div>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-link href={`/app/faqs/${faq.handle}`}>{truncate(faq.question, 55)}</s-link>
          {/* Provenance, not decoration: a merchant reviewing what to publish
              needs to know which rows a model wrote. The word "AI" carries
              it, so the badge survives greyscale and a screen reader. */}
          {faq.source === "ai" && (
            <Tag tone={faq.aiConfidence === "low" ? "caution" : "info"}>
              {faq.aiConfidence === "low" ? "AI — needs review" : "AI"}
            </Tag>
          )}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={faq.isStoreWide ? "info" : "default"}>{scopeLabel(faq)}</s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={isPublished ? "success" : "warning"}>{isPublished ? "Published" : "Draft"}</s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-text tone="subdued">{new Date(faq.updatedAt).toDateString()}</s-text>
      </s-table-cell>
      <s-table-cell>
        <MoreOptionsMenu faq={faq} onToggleStatus={toggleStatus} onDelete={handleDelete} />
      </s-table-cell>
    </s-table-row>
  );
}

function CategorySectionHeader({ name, count, color, iconImageUrl, categoryHandle, onDragStart, onDragEnd, isDragging, isDragOver, onDeleteCategory }) {
  const tint = color ? `${color}1A` : "#F1F1F1";
  const border = color ? `${color}40` : "#E1E1E1";
  return (
    <div style={{
      background: tint, borderBottom: `1px solid ${border}`, borderRadius: "8px 8px 0 0",
      padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
      opacity: isDragging ? 0.4 : 1, ...(isDragOver ? DRAG_OVER_STYLE : {}),
    }}>
      <s-stack direction="inline" gap="small-200" alignItems="center">
        {onDragStart && (
          <span draggable="true" onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <DragHandle />
          </span>
        )}
        {iconImageUrl ? (
          <img src={iconImageUrl} alt="" style={{ width: "18px", height: "18px", borderRadius: "4px", objectFit: "cover", flexShrink: 0 }} />
        ) : (
          color && <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
        )}
        <span style={{ fontWeight: 700, fontSize: "16px" }}>{name}</span>
        <s-badge tone="success">Active</s-badge>
      </s-stack>
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-button href={categoryHandle ? `/app/faqs/new?category=${categoryHandle}` : "/app/faqs/new"} variant="primary">
          + Add new FAQ
        </s-button>
        {categoryHandle && (
          <CategoryMoreOptionsMenu categoryHandle={categoryHandle} categoryName={name} onDelete={onDeleteCategory} />
        )}
        <s-badge>{count}</s-badge>
      </s-stack>
    </div>
  );
}

function DraggableCategoryGroups({ groups, sortKey }) {
  const [order, setOrder] = useState(groups);
  const [draggedKey, setDraggedKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const reorderFetcher = useFetcher();
  const deleteCategoryFetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => { setOrder(groups); }, [groups]);
  useEffect(() => {
    if (reorderFetcher.data?.toast) shopify.toast.show(reorderFetcher.data.toast);
  }, [reorderFetcher.data, shopify]);
  useEffect(() => {
    if (deleteCategoryFetcher.data?.toast) shopify.toast.show(deleteCategoryFetcher.data.toast);
  }, [deleteCategoryFetcher.data, shopify]);

  const draggableGroups = order.filter((g) => g.id);
  const uncategorized = order.find((g) => !g.id);
  const dragDisabled = sortKey !== "custom";

  const handleDragStart = (key) => (e) => {
    if (dragDisabled) return;
    setDraggedKey(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
  };
  const handleDragOver = (key) => (e) => {
    if (dragDisabled || !draggedKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (key !== dragOverKey) setDragOverKey(key);
  };
  const handleDrop = (key) => (e) => {
    if (dragDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (!draggedKey || draggedKey === key) {
      setDraggedKey(null); setDragOverKey(null); return;
    }
    const fromIndex = draggableGroups.findIndex((g) => g.key === draggedKey);
    const toIndex = draggableGroups.findIndex((g) => g.key === key);
    const reordered = [...draggableGroups];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setOrder(uncategorized ? [...reordered, uncategorized] : reordered);
    setDraggedKey(null); setDragOverKey(null);
    reorderFetcher.submit(
      { intent: "reorderCategories", orderedIds: JSON.stringify(reordered.map((g) => g.id)) },
      { method: "POST" },
    );
  };
  const handleDragEnd = () => { setDraggedKey(null); setDragOverKey(null); };

  const handleDeleteCategory = (id) => {
    deleteCategoryFetcher.submit({ intent: "deleteCategory", id }, { method: "POST" });
  };

  return (
    <s-stack direction="block" gap="base">
      {order.map((group) => (
        <s-section key={group.key} padding="none">
          <div onDragOver={group.id ? handleDragOver(group.key) : undefined} onDrop={group.id ? handleDrop(group.key) : undefined}>
            <CategorySectionHeader
              name={group.name}
              count={group.faqs.length}
              color={group.color}
              iconImageUrl={group.iconImageUrl}
              categoryHandle={group.key !== "__uncategorized__" ? group.key : null}
              isDragging={draggedKey === group.key}
              isDragOver={dragOverKey === group.key}
              onDragStart={group.id ? handleDragStart(group.key) : undefined}
              onDragEnd={group.id ? handleDragEnd : undefined}
              onDeleteCategory={() => handleDeleteCategory(group.id)}
            />
          </div>
          <DraggableFaqList
            faqs={group.faqs}
            sortKey={sortKey}
            categoryHandle={group.key !== "__uncategorized__" ? group.key : ""}
          />
        </s-section>
      ))}
    </s-stack>
  );
}

function AppFooter() {
  return (
    <div style={{ textAlign: "center", padding: "24px 0 8px", fontSize: "12.5px", color: "#9ca3af" }}>
      Copyright © {new Date().getFullYear()} · <strong style={{ color: "#6b7280" }}>Faqly</strong> · Version {APP_VERSION}
      {" · "}
      {/* s-link, not a raw <a>: inside the embedded admin a plain anchor
          replaces the iframe location without the shop/host params the
          loader needs, so the link silently fails. */}
      <s-link href="/app/settings">Settings</s-link>
    </div>
  );
}

export default function Index() {
  const { faqs, categories, widget, plan, aiEnabled } = useLoaderData();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("custom");
  const [statusFilter, setStatusFilter] = useState("all");

  // "closed" → "picking" → "reviewing". The generated drafts live in this
  // fetcher's data until the merchant keeps them; nothing has touched the
  // database at this point.
  const [aiPanel, setAiPanel] = useState("closed");
  const aiFetcher = useFetcher();

  const aiBusy = aiFetcher.state !== "idle";
  const aiDrafts = aiFetcher.data?.drafts ?? null;
  const aiPlan = aiFetcher.data?.plan ?? plan;

  useEffect(() => {
    if (searchParams.get("deletedFaq")) {
      shopify.toast.show("FAQ deleted");
      navigate(".", { replace: true });
    }
  }, [searchParams, shopify, navigate]);

  // Drafts arriving flips the panel to review; a successful save closes it
  // and revalidates the list so the new rows appear.
  useEffect(() => {
    if (aiFetcher.state !== "idle" || !aiFetcher.data) return;
    if (aiFetcher.data.drafts) {
      setAiPanel("reviewing");
    } else if (aiFetcher.data.saved !== undefined) {
      shopify.toast.show(aiFetcher.data.toast ?? "Draft FAQs added");
      setAiPanel("closed");
      navigate(".", { replace: true });
    }
  }, [aiFetcher.state, aiFetcher.data, shopify, navigate]);

  const startGeneration = ({ productId, count }) => {
    aiFetcher.submit(
      { intent: "generate", productId: productId ?? "", count: String(count) },
      { method: "POST", action: "/app/ai/generate" },
    );
  };

  const keepDrafts = (kept) => {
    aiFetcher.submit(
      { intent: "keep", drafts: JSON.stringify(kept) },
      { method: "POST", action: "/app/ai/generate" },
    );
  };

  const filteredFaqs = useMemo(() => {
    let result = faqs;
    if (statusFilter !== "all") {
      result = result.filter((f) =>
        statusFilter === "published" ? f.status === "PUBLISHED" : f.status === "DRAFT",
      );
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(
        (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q),
      );
    }
    return result;
  }, [faqs, query, statusFilter]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position),
    [categories],
  );
  const grouped = groupByCategory(filteredFaqs, sortedCategories, sortKey);
  const isFiltering = query.trim().length > 0 || statusFilter !== "all";

  return (
    <s-page heading="FAQs">
      <s-link slot="secondary-actions" href="/app/categories">
        Manage categories
      </s-link>
      <s-button slot="primary-action" href="/app/faqs/new" variant="primary">
        Create FAQ
      </s-button>

      <AppStyles />

      {/* Outside the empty/non-empty branch on purpose: a store with zero
          FAQs still needs to know the block is missing, and a store with
          fifty needs it even more. */}
      <WidgetNotInstalledBanner widget={widget} />

      {/* The AI section sits above the list and outside the empty/non-empty
          branch: generating is most useful precisely when there are no FAQs
          yet. Hidden entirely without an API key rather than shown broken. */}
      {aiEnabled && (
        <div className="fq" style={{ marginBottom: "16px" }}>
          {aiPanel === "closed" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                background: "#FFFFFF",
                border: "1px solid #E5E7EB",
                borderRadius: "12px",
                padding: "14px 16px",
              }}
            >
              <AiCreditMeter plan={aiPlan} />
              <span style={{ flex: "1 1 auto" }} />
              {/* Out of credits is a dead end without somewhere to go, so the
                  button becomes the way out rather than just greying out. */}
              {aiPlan?.remaining === 0 ? (
                <s-button variant="primary" href="/app/billing">
                  Get more generations
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  icon="wand"
                  onClick={() => setAiPanel("picking")}
                >
                  Generate with AI
                </s-button>
              )}
            </div>
          )}

          {aiPanel === "picking" && (
            <AiGenerateModal
              plan={aiPlan}
              generating={aiBusy}
              error={aiFetcher.data?.error ?? null}
              onGenerate={startGeneration}
              onCancel={() => setAiPanel("closed")}
            />
          )}

          {aiPanel === "reviewing" && aiDrafts && (
            <AiReviewList
              drafts={aiDrafts}
              saving={aiBusy}
              onSave={keepDrafts}
              onCancel={() => setAiPanel("closed")}
            />
          )}
        </div>
      )}

      {faqs.length === 0 ? (
        <EmptyFaqState />
      ) : (
        <s-stack direction="block" gap="base">
          <StatsRow faqs={faqs} categoryCount={categories.length} />

          {/* Explicit flex row (not relying on s-stack's inline behavior,
              which was rendering stacked) — guarantees one line, with
              the search box flexible and the two dropdowns fixed-width. */}
          <div style={{ display: "flex", gap: "8px", alignItems: "stretch" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <s-text-field
                label="Search FAQs"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search for FAQ"
                icon="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                clearButton
                onClearButtonClick={() => setQuery("")}
              />
            </div>
            <div style={{ flex: "0 0 200px" }}>
              <s-select
                label="Order by"
                labelAccessibilityVisibility="exclusive"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
              >
                <s-option value="custom">Custom order (drag)</s-option>
                <s-option value="newest">Newest updated</s-option>
                <s-option value="oldest">Oldest updated</s-option>
                <s-option value="az">Question A–Z</s-option>
              </s-select>
            </div>
            <div style={{ flex: "0 0 170px" }}>
              <s-select
                label="FAQ status"
                labelAccessibilityVisibility="exclusive"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <s-option value="all">All statuses</s-option>
                <s-option value="published">Published</s-option>
                <s-option value="draft">Draft</s-option>
              </s-select>
            </div>
          </div>

          {sortKey !== "custom" && (
            <s-banner tone="info">
              Drag-to-reorder is off while sorted by a non-custom order. Switch &quot;Order by&quot; back to &quot;Custom order (drag)&quot; to reorder.
            </s-banner>
          )}

          {isFiltering && filteredFaqs.length === 0 ? (
            <NoSearchResults />
          ) : (
            <DraggableCategoryGroups groups={grouped} sortKey={sortKey} />
          )}

          <AppFooter />
        </s-stack>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
