import { useEffect, useRef, useState } from "react";
import {
  useActionData,
  useLoaderData,
  useSubmit,
  useSearchParams,
  useNavigate,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getFaq,
  getFaqs,
  saveFaq,
  deleteFaq,
  duplicateFaq,
  validateFaq,
  generateHandle,
} from "../models/Faq.server";
import { getCategories } from "../models/Category.server";
import { getSettings } from "../models/Settings.server";
import { FaqStatus } from "../models/faq-status";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const categories = await getCategories(ctx);

  if (params.id === "new") {
    const settings = await getSettings(ctx);
    const url = new URL(request.url);
    const preselectedCategory = url.searchParams.get("category") || "";
    return {
      question: "",
      answer: "",
      status: settings.defaultStatus || FaqStatus.DRAFT,
      handle: null,
      categoryHandle: preselectedCategory,
      products: [],
      collections: [],
      categories,
    };
  }

  const faq = await getFaq(params.id, ctx);
  if (!faq) {
    throw new Response("FAQ not found", { status: 404 });
  }
  return { ...faq, categories };
};

export const action = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const formData = await request.formData();
  const data = Object.fromEntries(formData);
  const productIds = JSON.parse(data.productIds || "[]");
  const collectionIds = JSON.parse(data.collectionIds || "[]");

  if (data.action === "delete") {
    await deleteFaq(data.id, ctx);
    return redirect("/app?deletedFaq=1");
  }

  if (data.action === "duplicate") {
    const copy = await duplicateFaq(
      {
        question: data.question,
        answer: data.answer,
        categoryHandle: data.categoryHandle,
        productIds,
        collectionIds,
      },
      ctx,
    );
    return redirect(`/app/faqs/${copy.handle}?duplicated=1`);
  }

  const errors = validateFaq(data);
  if (Object.keys(errors).length) {
    return { errors };
  }

  let handle = params.id;
  let position;
  if (params.id === "new") {
    handle = generateHandle(data.question);
    // hydrate:false skips the Admin API lookup for product/collection
    // details — we only need a count to place the new FAQ last.
    const existing = await getFaqs(ctx, { hydrate: false });
    position = existing.length;
  }

  await saveFaq(
    handle,
    {
      question: data.question,
      answer: data.answer,
      status: data.status,
      categoryHandle: data.categoryHandle,
      productIds,
      collectionIds,
      ...(position !== undefined ? { position } : {}),
    },
    ctx,
  );

  return redirect(`/app/faqs/${handle}?saved=1`);
};

/**
 * Lightweight markdown toolbar for the Answer field. Wraps the current
 * text selection with markdown syntax (**bold**, *italic*, - bullets)
 * rather than building a full HTML rich-text editor. This keeps the
 * stored value as plain text (safe, no HTML-sanitization concerns on
 * the storefront) while still giving merchants basic formatting — the
 * storefront widget renders this markdown-lite syntax safely (see
 * faqly-widget.js).
 */
function MarkdownToolbar({ textareaRef, value, onChange }) {
  const wrapSelection = (before, after) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const newValue = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  };

  const insertListLines = (prefix, numbered) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || "List item";
    const rawLines = selected.split("\n");
    const lines = rawLines
      .map((line, i) => {
        const clean = line.replace(/^-\s+|^\d+\.\s+/, "");
        return numbered ? `${i + 1}. ${clean}` : `- ${clean}`;
      })
      .join("\n");
    onChange(value.slice(0, start) + lines + value.slice(end));
  };

  const toolButtonStyle = {
    minWidth: "30px",
    height: "30px",
    borderRadius: "6px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "13px",
    color: "#374151",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "6px 8px",
        background: "#F9FAFB",
        border: "1px solid rgba(17, 24, 39, 0.1)",
        borderBottom: "none",
        borderRadius: "8px 8px 0 0",
      }}
    >
      <button type="button" style={{ ...toolButtonStyle, fontWeight: 700 }} onClick={() => wrapSelection("**", "**")} title="Bold">
        B
      </button>
      <button type="button" style={{ ...toolButtonStyle, fontStyle: "italic" }} onClick={() => wrapSelection("*", "*")} title="Italic">
        I
      </button>
      <button type="button" style={{ ...toolButtonStyle, textDecoration: "underline" }} onClick={() => wrapSelection("__", "__")} title="Underline">
        U
      </button>
      <div style={{ width: "1px", height: "18px", background: "rgba(17,24,39,0.1)", margin: "0 4px" }} />
      <button type="button" style={toolButtonStyle} onClick={() => insertListLines("-", false)} title="Bullet list">
        • ≡
      </button>
      <button type="button" style={toolButtonStyle} onClick={() => insertListLines("1.", true)} title="Numbered list">
        1. ≡
      </button>
    </div>
  );
}

function AnswerCounter({ text }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  return (
    <div style={{ textAlign: "right", fontSize: "11.5px", color: "#9ca3af", padding: "4px 2px 0" }}>
      {words} WORDS · {chars} CHARACTERS
    </div>
  );
}

export default function FaqForm() {
  const initialData = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !initialData.handle;
  const { categories, products: initialProducts, collections: initialCollections, ...initialFaq } =
    initialData;

  const [formState, setFormState] = useState(initialFaq);
  const [products, setProducts] = useState(initialProducts);
  const [collections, setCollections] = useState(initialCollections);
  const answerRef = useRef(null);
  const errors = actionData?.errors || {};

  useEffect(() => {
    if (searchParams.get("saved")) {
      shopify.toast.show("FAQ saved");
      navigate(".", { replace: true });
    } else if (searchParams.get("duplicated")) {
      shopify.toast.show("FAQ duplicated");
      navigate(".", { replace: true });
    }
  }, [searchParams, shopify, navigate]);

  useEffect(() => {
    if (actionData?.errors) {
      shopify.toast.show("Please fix the errors below", { isError: true });
    }
  }, [actionData, shopify]);

  const buildSubmission = (extra = {}) => ({
    ...formState,
    productIds: JSON.stringify(products.map((p) => p.id)),
    collectionIds: JSON.stringify(collections.map((c) => c.id)),
    ...extra,
  });

  const handleSave = () => submit(buildSubmission(), { method: "POST" });
  const handleDelete = () =>
    submit({ action: "delete", id: initialData.id }, { method: "POST" });
  const handleDuplicate = () =>
    submit(buildSubmission({ action: "duplicate" }), { method: "POST" });

  const pickProducts = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (selection) {
      setProducts(
        selection.map((p) => ({
          id: p.id,
          title: p.title,
          handle: p.handle,
          image: p.images?.[0]?.originalSrc ?? null,
        })),
      );
    }
  };

  const pickCollections = async () => {
    const selection = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: collections.map((c) => ({ id: c.id })),
    });
    if (selection) {
      setCollections(
        selection.map((c) => ({ id: c.id, title: c.title, handle: c.handle })),
      );
    }
  };

  const removeProduct = (id) =>
    setProducts(products.filter((p) => p.id !== id));
  const removeCollection = (id) =>
    setCollections(collections.filter((c) => c.id !== id));

  const isStoreWide = products.length === 0 && collections.length === 0;

  return (
    <s-page heading={isNew ? "Create FAQ" : "Edit FAQ"}>
      <s-link slot="breadcrumbs" href="/app">
        ← FAQs
      </s-link>
      <s-button slot="primary-action" onClick={handleSave} variant="primary">
        Save
      </s-button>
      {!isNew && (
        <>
          <s-button slot="secondary-actions" onClick={handleDuplicate}>
            Duplicate
          </s-button>
          <s-button
            slot="secondary-actions"
            onClick={handleDelete}
            tone="critical"
          >
            Delete
          </s-button>
        </>
      )}

      <s-section heading="FAQ details">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Question *"
            value={formState.question}
            onChange={(e) =>
              setFormState({ ...formState, question: e.target.value })
            }
            error={errors.question}
          />

          <div>
            <MarkdownToolbar
              textareaRef={answerRef}
              value={formState.answer}
              onChange={(v) => setFormState({ ...formState, answer: v })}
            />
            <div style={{ marginTop: "-1px" }}>
              <s-text-area
                ref={answerRef}
                label="Answer *"
                details="Select text and use the toolbar for **bold**, *italic*, __underline__, or lists."
                value={formState.answer}
                onChange={(e) =>
                  setFormState({ ...formState, answer: e.target.value })
                }
                error={errors.answer}
                rows={6}
              />
            </div>
            <AnswerCounter text={formState.answer} />
          </div>

          <s-select
            label="Status"
            value={formState.status}
            onChange={(e) =>
              setFormState({ ...formState, status: e.target.value })
            }
          >
            <s-option value={FaqStatus.DRAFT}>Draft</s-option>
            <s-option value={FaqStatus.PUBLISHED}>Published</s-option>
          </s-select>
          <s-select
            label="Category (optional)"
            value={formState.categoryHandle}
            onChange={(e) =>
              setFormState({ ...formState, categoryHandle: e.target.value })
            }
          >
            <s-option value="">No category</s-option>
            {categories.map((category) => (
              <s-option key={category.handle} value={category.handle}>
                {category.name}
              </s-option>
            ))}
          </s-select>
          {categories.length === 0 && (
            <s-paragraph>
              No categories yet.{" "}
              <s-link href="/app/categories/new">Create one</s-link>.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Where this FAQ appears">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {isStoreWide ? (
              <s-badge tone="info">Store-wide — shown on every product</s-badge>
            ) : (
              "Attached to specific products/collections below. Clear both lists to make this FAQ store-wide again."
            )}
          </s-paragraph>

          <s-stack direction="block" gap="small-200">
            <s-text>Products</s-text>
            <s-stack direction="inline" gap="small-200" wrap>
              {products.map((product) => (
                <s-badge key={product.id}>
                  {product.title}
                  <s-button
                    variant="tertiary"
                    icon="x"
                    accessibilityLabel={`Remove ${product.title}`}
                    onClick={() => removeProduct(product.id)}
                  />
                </s-badge>
              ))}
            </s-stack>
            <s-button onClick={pickProducts}>Select products</s-button>
          </s-stack>

          <s-stack direction="block" gap="small-200">
            <s-text>Collections</s-text>
            <s-stack direction="inline" gap="small-200" wrap>
              {collections.map((collection) => (
                <s-badge key={collection.id}>
                  {collection.title}
                  <s-button
                    variant="tertiary"
                    icon="x"
                    accessibilityLabel={`Remove ${collection.title}`}
                    onClick={() => removeCollection(collection.id)}
                  />
                </s-badge>
              ))}
            </s-stack>
            <s-button onClick={pickCollections}>Select collections</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
