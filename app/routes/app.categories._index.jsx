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
  getCategories,
  getCategoryFaqCounts,
  setCategoryVisibility,
  deleteCategory,
  reorderCategories,
} from "../models/Category.server";
import { PortalMenu } from "../components/PortalMenu";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  // Counts come from a single grouped query. Loading every FAQ (with its
  // product/collection hydration) just to count them was fine at 20 FAQs
  // and wasteful at 500.
  const [categories, countsByCategoryId] = await Promise.all([
    getCategories(ctx),
    getCategoryFaqCounts(ctx),
  ]);

  const categoriesWithCounts = categories.map((c) => ({
    ...c,
    faqCount: countsByCategoryId[c.id] ?? 0,
  }));

  const uncategorizedCount = countsByCategoryId.__general__ ?? 0;
  const totalFaqs = Object.values(countsByCategoryId).reduce((a, b) => a + b, 0);

  return {
    categories: categoriesWithCounts,
    totalFaqs,
    uncategorizedCount,
  };
};

/**
 * Persists the new order in one transaction. Previously this fanned out
 * into a concurrent write per category, so a partial failure left the list
 * in an order that matched neither the old nor the new arrangement.
 */
async function persistOrder(reordered, ctx) {
  await reorderCategories(reordered.map((category) => category.id), ctx);
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  // Chevron buttons: swap with the neighbour.
  if (data.intent === "move") {
    const categories = await getCategories(ctx);
    const index = categories.findIndex((c) => c.id === data.id);
    const targetIndex = data.direction === "up" ? index - 1 : index + 1;

    if (index === -1 || targetIndex < 0 || targetIndex >= categories.length) {
      return null;
    }

    const reordered = [...categories];
    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ];

    await persistOrder(reordered, ctx);
    return { toast: "Order updated" };
  }

  // Drag and drop: lift one category out and drop it at an arbitrary index.
  if (data.intent === "reorder") {
    const categories = await getCategories(ctx);
    const from = categories.findIndex((c) => c.id === data.id);
    const to = Number(data.toIndex);

    if (
      from === -1 ||
      Number.isNaN(to) ||
      to < 0 ||
      to >= categories.length ||
      from === to
    ) {
      return null;
    }

    const reordered = [...categories];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    await persistOrder(reordered, ctx);
    return { toast: "Order updated" };
  }

  if (data.intent === "visibility") {
    const visible = data.visible === "true";
    await setCategoryVisibility(data.id, visible, ctx);
    return { toast: visible ? "Category is now visible" : "Category hidden" };
  }

  if (data.intent === "delete") {
    await deleteCategory(data.id, ctx);
    return { toast: "Category deleted" };
  }

  return null;
};

/**
 * Coarse relative time. Metaobjects expose `updatedAt` but no `createdAt`,
 * so "Last updated" is the only timestamp a category can show.
 */
function formatRelativeTime(iso) {
  if (!iso) return "Never";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Never";

  const seconds = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  for (const [name, size] of units) {
    const amount = Math.floor(seconds / size);
    if (amount >= 1) {
      return `${amount} ${name}${amount === 1 ? "" : "s"} ago`;
    }
  }
  return "Just now";
}

/* --------------------------------------------------------------------------
   Inline SVGs rather than <s-icon>. The stat tiles and the drag grip need a
   specific glyph at a specific size in a specific colour, and drawing them
   here keeps that guaranteed instead of depending on an icon name being
   present in the Polaris set.
   -------------------------------------------------------------------------- */

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

const FolderIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.8h7.2a1.5 1.5 0 0 1 1.5 1.5v7.2a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg {...iconProps}>
    <circle cx="10" cy="10" r="7.2" />
    <path d="M6.8 10.2l2.2 2.2 4.2-4.6" />
  </svg>
);

const SearchIcon = () => (
  <svg {...iconProps}>
    <circle cx="9" cy="9" r="5.2" />
    <path d="M12.8 12.8l4 4" />
  </svg>
);

const GripIcon = () => (
  <svg
    width="10"
    height="16"
    viewBox="0 0 10 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <circle cx="2" cy="3" r="1.3" />
    <circle cx="8" cy="3" r="1.3" />
    <circle cx="2" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="2" cy="13" r="1.3" />
    <circle cx="8" cy="13" r="1.3" />
  </svg>
);

const EmptyState = () => (
  <s-section accessibilityLabel="Empty categories state">
    <s-grid gap="base" justifyItems="center" paddingBlock="large-400">
      <s-grid justifyItems="center" maxInlineSize="450px">
        <s-heading>Create your first category</s-heading>
        <s-paragraph>
          Group related FAQs together so customers can browse by topic.
        </s-paragraph>
        <s-button href="/app/categories/new" variant="primary">
          Create category
        </s-button>
      </s-grid>
    </s-grid>
  </s-section>
);

/* --------------------------------------------------------------------------
   Stat cards
   -------------------------------------------------------------------------- */

/**
 * Metric card. The label sits on one line with the icon pinned to the top
 * right, and the value block is pushed to the bottom with `margin-top: auto`
 * so all three numbers land on the same baseline even when a label wraps.
 * The context line underneath is always rendered, with a reserved minimum
 * height, so no card ends up visually shorter than its neighbours.
 *
 * Laid out with plain flexbox rather than <s-stack>: the card is already a
 * custom-styled container, and owning the alignment outright avoids relying
 * on stack props behaving a particular way.
 */
function StatCard({ label, value, caption, context, accent, bg, icon }) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${accent}2E`,
        borderRadius: "12px",
        padding: "18px",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <s-text tone="subdued">{label}</s-text>
        <div
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "9px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: accent,
            background: `${accent}1F`,
          }}
        >
          {icon}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "7px",
          marginTop: "auto",
        }}
      >
        <span
          style={{
            fontSize: "30px",
            fontWeight: 650,
            lineHeight: 1,
            color: accent,
          }}
        >
          {value}
        </span>
        {caption ? <s-text tone="subdued">{caption}</s-text> : null}
      </div>

      <div style={{ minHeight: "20px" }}>{context}</div>
    </div>
  );
}

const NEUTRAL_THEME = { accent: "#5C5F62", bg: "#F6F6F7" };
const GREEN_THEME = { accent: "#059669", bg: "#ECFDF5" };
const AMBER_THEME = { accent: "#D97706", bg: "#FFFBEB" };

function StatsRow({ categories, totalFaqs, uncategorizedCount }) {
  const categorized = totalFaqs - uncategorizedCount;
  const hiddenCount = categories.filter((c) => !c.visible).length;
  const usedCount = categories.filter((c) => c.faqCount > 0).length;
  const allSorted = uncategorizedCount === 0;

  // Colour carries meaning rather than decoration: the green/amber pair
  // moves together, so at a glance green on the middle card and grey on the
  // right means everything is filed, and grey/amber means work is waiting.
  const sortedTheme = allSorted ? GREEN_THEME : NEUTRAL_THEME;
  const pendingTheme = allSorted ? NEUTRAL_THEME : AMBER_THEME;

  return (
    <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
      <StatCard
        label="Categories"
        value={String(categories.length)}
        accent="#7C3AED"
        bg="#F5F3FF"
        icon={<FolderIcon />}
        context={
          <s-text tone="subdued">
            {hiddenCount > 0
              ? `${hiddenCount} hidden from the storefront`
              : "All showing on the storefront"}
          </s-text>
        }
      />
      <StatCard
        label="FAQs categorized"
        value={String(categorized)}
        caption={`of ${totalFaqs}`}
        accent={sortedTheme.accent}
        bg={sortedTheme.bg}
        icon={<CheckCircleIcon />}
        context={
          <s-text tone="subdued">
            {usedCount > 0
              ? `Across ${usedCount} categor${usedCount === 1 ? "y" : "ies"}`
              : "Not grouped yet"}
          </s-text>
        }
      />
      <StatCard
        label="Uncategorized FAQs"
        value={String(uncategorizedCount)}
        accent={pendingTheme.accent}
        bg={pendingTheme.bg}
        icon={<SearchIcon />}
        context={
          uncategorizedCount > 0 ? (
            <s-link href="/app">Sort them into categories</s-link>
          ) : (
            <s-text tone="subdued">All FAQs are grouped</s-text>
          )
        }
      />
    </s-grid>
  );
}

/* --------------------------------------------------------------------------
   Category icon tile
   -------------------------------------------------------------------------- */

const FALLBACK_PALETTE = [
  "#7C3AED",
  "#2563EB",
  "#059669",
  "#D97706",
  "#DC2626",
  "#0891B2",
  "#DB2777",
  "#65A30D",
];

/** Stable per-category colour so a category keeps its tint across reloads. */
function fallbackColor(handle) {
  let hash = 0;
  for (let i = 0; i < handle.length; i += 1) {
    hash = (hash * 31 + handle.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

/**
 * Uploaded image first, then the merchant's emoji, then the category's first
 * letter. The old grey dot carried no information — an initial at least tells
 * the rows apart at a glance while the merchant hasn't picked an icon yet.
 * The tint falls back to a colour derived from the handle when no colour is
 * set, so it's stable rather than random.
 */
function CategoryIcon({ category }) {
  const tint = category.color || fallbackColor(category.handle);

  if (category.iconImageUrl) {
    return (
      <img
        src={category.iconImageUrl}
        alt=""
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "8px",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }

  const initial = (category.name || category.handle || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <div
      aria-hidden="true"
      style={{
        width: "32px",
        height: "32px",
        borderRadius: "8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: category.icon ? "17px" : "14px",
        fontWeight: 600,
        lineHeight: 1,
        color: tint,
        background: `${tint}1F`,
        border: `1px solid ${tint}3D`,
      }}
    >
      {category.icon || initial}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Storefront visibility toggle
   -------------------------------------------------------------------------- */

/**
 * Replaces <s-switch>. Polaris owns that component's colour and it can't be
 * overridden from the route, so the switch is rebuilt here to read green when
 * on — the same `#059669` the row's actions button uses for its active state.
 *
 * It's a real <button role="switch">, so Space and Enter toggle it and screen
 * readers announce the on/off state without extra wiring.
 */
function VisibilityToggle({ checked, disabled, label, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: "36px",
        height: "20px",
        boxSizing: "border-box",
        padding: 0,
        flexShrink: 0,
        borderRadius: "999px",
        border: `1px solid ${checked ? "#047857" : "#C9CCCF"}`,
        background: checked ? "#059669" : "#E3E5E7",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 140ms ease, border-color 140ms ease",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "2px",
          left: checked ? "18px" : "2px",
          width: "14px",
          height: "14px",
          borderRadius: "50%",
          background: "#FFFFFF",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.25)",
          transition: "left 140ms ease",
        }}
      />
    </button>
  );
}

/* --------------------------------------------------------------------------
   Table row
   -------------------------------------------------------------------------- */

function CategoryRow({
  category,
  index,
  isFirst,
  isLast,
  reorderDisabled,
  drag,
}) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.toast) {
      shopify.toast.show(fetcher.data.toast);
    }
  }, [fetcher.data, shopify]);

  const isBusy = fetcher.state !== "idle";
  const canReorder = !reorderDisabled && !isBusy;

  const move = (direction) =>
    fetcher.submit(
      { intent: "move", id: category.id, direction },
      { method: "POST" },
    );

  const toggleVisibility = (visible) =>
    fetcher.submit(
      { intent: "visibility", id: category.id, visible: String(visible) },
      { method: "POST" },
    );

  const handleDelete = () => {
    const message =
      category.faqCount > 0
        ? `Delete "${category.name}"? Its ${category.faqCount} FAQ${
            category.faqCount === 1 ? "" : "s"
          } will become uncategorized.`
        : `Delete "${category.name}"?`;
    if (window.confirm(message)) {
      fetcher.submit({ intent: "delete", id: category.id }, { method: "POST" });
    }
  };

  const isDragged = drag.draggingId === category.id;
  const isDropTarget = drag.overIndex === index && !isDragged;

  return (
    <s-table-row
      id={category.handle}
      onDragOver={(event) => {
        if (!drag.draggingId || !canReorder) return;
        event.preventDefault();
        drag.setOverIndex(index);
      }}
      onDrop={(event) => {
        if (!drag.draggingId || !canReorder) return;
        event.preventDefault();
        drag.commit(index);
      }}
      style={{
        opacity: isDragged ? 0.4 : 1,
        boxShadow: isDropTarget ? "inset 0 2px 0 0 #7C3AED" : "none",
      }}
    >
      <s-table-cell>
        <s-stack direction="inline" gap="small-500" alignItems="center">
          <span
            draggable={canReorder}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              // Firefox refuses to start a drag without payload.
              event.dataTransfer.setData("text/plain", category.id);
              drag.start(category.id);
            }}
            onDragEnd={() => drag.cancel()}
            title={
              canReorder
                ? "Drag to reorder"
                : "Clear the search to reorder categories"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 2px",
              color: "#8A8A8A",
              cursor: canReorder ? "grab" : "not-allowed",
              opacity: canReorder ? 1 : 0.4,
            }}
          >
            <GripIcon />
          </span>
          <s-button
            icon="chevron-up"
            accessibilityLabel={`Move ${category.name} up`}
            variant="tertiary"
            disabled={isFirst || !canReorder}
            onClick={() => move("up")}
          />
          <s-button
            icon="chevron-down"
            accessibilityLabel={`Move ${category.name} down`}
            variant="tertiary"
            disabled={isLast || !canReorder}
            onClick={() => move("down")}
          />
        </s-stack>
      </s-table-cell>

      <s-table-cell>
        <s-stack direction="inline" gap="base" alignItems="center">
          <CategoryIcon category={category} />
          <s-stack direction="block" gap="small-500">
            <s-link href={`/app/categories/${category.handle}`}>
              {category.name}
            </s-link>
            <s-text tone="subdued">/{category.handle}</s-text>
          </s-stack>
        </s-stack>
      </s-table-cell>

      <s-table-cell>
        <s-badge tone={category.faqCount > 0 ? "default" : "warning"}>
          {category.faqCount} FAQ{category.faqCount === 1 ? "" : "s"}
        </s-badge>
      </s-table-cell>

      <s-table-cell>
        <VisibilityToggle
          checked={category.visible}
          disabled={isBusy}
          label={`Show ${category.name} on the storefront`}
          onChange={toggleVisibility}
        />
      </s-table-cell>

      <s-table-cell>
        <s-text tone="subdued">{formatRelativeTime(category.updatedAt)}</s-text>
      </s-table-cell>

      <s-table-cell>
        <PortalMenu
          items={[
            {
              label: "Edit category",
              href: `/app/categories/${category.handle}`,
            },
            {
              // Mirrors "Move to draft" on the FAQ list: the same action as
              // the toggle in the row, reachable from the same place on both
              // pages.
              label: category.visible
                ? "Hide from storefront"
                : "Show on storefront",
              onClick: () => toggleVisibility(!category.visible),
            },
            {
              label: "Delete category",
              destructive: true,
              onClick: handleDelete,
            },
          ]}
        />
      </s-table-cell>
    </s-table-row>
  );
}

/* --------------------------------------------------------------------------
   Page
   -------------------------------------------------------------------------- */

export default function Categories() {
  const { categories, totalFaqs, uncategorizedCount } = useLoaderData();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const reorderFetcher = useFetcher();

  const [query, setQuery] = useState("");
  const [draggingId, setDraggingId] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  useEffect(() => {
    if (searchParams.get("deletedCategory")) {
      shopify.toast.show("Category deleted");
      navigate(".", { replace: true });
    }
  }, [searchParams, shopify, navigate]);

  useEffect(() => {
    if (reorderFetcher.data?.toast) {
      shopify.toast.show(reorderFetcher.data.toast);
    }
  }, [reorderFetcher.data, shopify]);

  const trimmedQuery = query.trim().toLowerCase();
  const visibleCategories = useMemo(() => {
    if (!trimmedQuery) return categories;
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(trimmedQuery) ||
        c.handle.toLowerCase().includes(trimmedQuery),
    );
  }, [categories, trimmedQuery]);

  const isFiltering = trimmedQuery.length > 0;

  const drag = {
    draggingId,
    overIndex,
    start: (id) => setDraggingId(id),
    setOverIndex,
    cancel: () => {
      setDraggingId(null);
      setOverIndex(null);
    },
    commit: (toIndex) => {
      if (draggingId) {
        reorderFetcher.submit(
          { intent: "reorder", id: draggingId, toIndex: String(toIndex) },
          { method: "POST" },
        );
      }
      setDraggingId(null);
      setOverIndex(null);
    },
  };

  return (
    <s-page heading="Categories">
      <s-link slot="secondary-actions" href="/app">
        Back to FAQs
      </s-link>
      <s-button
        slot="primary-action"
        href="/app/categories/new"
        variant="primary"
      >
        Create category
      </s-button>

      {categories.length === 0 ? (
        <EmptyState />
      ) : (
        <s-stack direction="block" gap="base">
          <StatsRow
            categories={categories}
            totalFaqs={totalFaqs}
            uncategorizedCount={uncategorizedCount}
          />

          <s-section accessibilityLabel="Category list">
            <s-stack direction="block" gap="base">
              {/* Compact field on the left, helper text pushed to the right.
                  labelAccessibilityVisibility="exclusive" keeps the label for
                  screen readers while dropping it visually, so the field sits
                  on one line with the text instead of below its own heading. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "0 1 300px", minWidth: "190px" }}>
                  <s-search-field
                    label="Search categories"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="Search categories\u2026"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <s-text tone="subdued">
                  {isFiltering
                    ? `${visibleCategories.length} of ${categories.length} shown`
                    : "Drag rows to change display order on your storefront"}
                </s-text>
              </div>

              {visibleCategories.length === 0 ? (
                <s-stack direction="block" gap="small-200" paddingBlock="large">
                  <s-heading>No categories match that search</s-heading>
                  <s-paragraph>
                    Try a different name, or clear the search to see all{" "}
                    {categories.length} categories.
                  </s-paragraph>
                </s-stack>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Order</s-table-header>
                    <s-table-header listSlot="primary">Category</s-table-header>
                    <s-table-header>FAQs</s-table-header>
                    <s-table-header>Visible on storefront</s-table-header>
                    <s-table-header>Last updated</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {visibleCategories.map((category) => {
                      const position = categories.findIndex(
                        (c) => c.id === category.id,
                      );
                      return (
                        <CategoryRow
                          key={category.handle}
                          category={category}
                          index={position}
                          isFirst={position === 0}
                          isLast={position === categories.length - 1}
                          // Reordering a filtered list would move a category
                          // past neighbours the merchant can't see, so both
                          // the grip and the arrows wait for the full list.
                          reorderDisabled={isFiltering}
                          drag={drag}
                        />
                      );
                    })}
                  </s-table-body>
                </s-table>
              )}
            </s-stack>
          </s-section>
        </s-stack>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
