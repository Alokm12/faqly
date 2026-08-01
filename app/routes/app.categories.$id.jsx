import { useEffect, useState } from "react";
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
  getCategory,
  getCategories,
  saveCategory,
  deleteCategory,
  validateCategory,
  generateCategoryHandle,
} from "../models/Category.server";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  if (params.id === "new") {
    return {
      name: "",
      icon: "",
      iconImageUrl: "",
      color: "",
      handle: null,
      visible: true,
    };
  }

  const category = await getCategory(params.id, ctx);
  if (!category) {
    throw new Response("Category not found", { status: 404 });
  }
  return category;
};

export const action = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });
  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  if (data.action === "delete") {
    await deleteCategory(data.id, ctx);
    return redirect("/app/categories?deletedCategory=1");
  }

  const errors = validateCategory(data);
  if (Object.keys(errors).length) {
    return { errors };
  }

  let handle = params.id;
  let position;
  if (params.id === "new") {
    handle = generateCategoryHandle(data.name);
    const existing = await getCategories(ctx);
    position = existing.length;
  }

  await saveCategory(
    handle,
    {
      name: data.name,
      icon: data.icon,
      iconImageUrl: data.iconImageUrl,
      color: data.color,
      ...(position !== undefined ? { position } : {}),
      // New categories are published straight away; existing ones keep
      // whatever the storefront-visibility toggle on the list page set,
      // because saveCategory only writes `visible` when it is passed in.
      ...(params.id === "new" ? { visible: true } : {}),
    },
    ctx,
  );

  return redirect(`/app/categories/${handle}?saved=1`);
};

/** A small labeled field wrapper for the 3-column layout below. */
function FieldColumn({ label, details, error, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label style={{ fontSize: "13px", fontWeight: 500, color: "#1f2937" }}>{label}</label>
      {children}
      {details && !error && (
        <span style={{ fontSize: "12px", color: "#9ca3af" }}>{details}</span>
      )}
      {error && <span style={{ fontSize: "12px", color: "#DC2626" }}>{error}</span>}
    </div>
  );
}

const INPUT_STYLE = {
  padding: "9px 12px",
  borderRadius: "8px",
  border: "1px solid rgba(17, 24, 39, 0.15)",
  fontSize: "14px",
  fontFamily: "inherit",
  color: "#111827",
  width: "100%",
  boxSizing: "border-box",
};

export default function CategoryForm() {
  const initialData = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !initialData.handle;

  const [formState, setFormState] = useState(initialData);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const errors = actionData?.errors || {};

  useEffect(() => {
    if (searchParams.get("saved")) {
      shopify.toast.show("Category saved");
      navigate(".", { replace: true });
    }
  }, [searchParams, shopify, navigate]);

  useEffect(() => {
    if (actionData?.errors) {
      shopify.toast.show("Please fix the errors below", { isError: true });
    }
  }, [actionData, shopify]);

  const handleSave = () => submit(formState, { method: "POST" });
  const handleDelete = () =>
    submit({ action: "delete", id: initialData.id }, { method: "POST" });

  const handleIconUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError("");
    try {
      const body = new FormData();
      body.append("icon", file);
      const response = await fetch("/app/categories/upload-icon", {
        method: "POST",
        body,
      });
      const result = await response.json();
      if (!response.ok) {
        setUploadError(result.error || "Upload failed");
      } else {
        setFormState((s) => ({ ...s, iconImageUrl: result.url }));
        shopify.toast.show("Icon image uploaded");
      }
    } catch {
      setUploadError("Upload failed — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <s-page heading={isNew ? "Create category" : "Edit category"}>
      <s-link slot="breadcrumbs" href="/app/categories">
        ← Categories
      </s-link>
      <s-button slot="primary-action" onClick={handleSave} variant="primary">
        Save
      </s-button>
      {!isNew && (
        <s-button slot="secondary-actions" onClick={handleDelete} tone="critical">
          Delete
        </s-button>
      )}

      <s-section heading="Category details">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "20px",
            alignItems: "start",
          }}
        >
          <FieldColumn label="Name *" error={errors.name}>
            <input
              style={INPUT_STYLE}
              value={formState.name}
              onChange={(e) => setFormState({ ...formState, name: e.target.value })}
            />
          </FieldColumn>

          <FieldColumn
            label="Icon"
            details="Emoji/text fallback, used if no image is uploaded below."
          >
            <input
              style={INPUT_STYLE}
              value={formState.icon}
              placeholder="e.g. 📦"
              onChange={(e) => setFormState({ ...formState, icon: e.target.value })}
            />
          </FieldColumn>

          <FieldColumn label="Color" error={errors.color} details="Hex value, e.g. #5C6AC4">
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(formState.color) ? formState.color : "#5C6AC4"}
                onChange={(e) => setFormState({ ...formState, color: e.target.value })}
                style={{
                  width: "42px",
                  height: "40px",
                  padding: "2px",
                  border: "1px solid rgba(17,24,39,0.15)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  background: "none",
                  flexShrink: 0,
                }}
              />
              <input
                style={{ ...INPUT_STYLE, flex: 1 }}
                value={formState.color}
                placeholder="#5C6AC4"
                onChange={(e) => setFormState({ ...formState, color: e.target.value })}
              />
            </div>
          </FieldColumn>

          <div style={{ gridColumn: "1 / -1" }}>
            <FieldColumn
              label="Icon image (optional — overrides the emoji above)"
              details="PNG, JPEG, WebP, or SVG, under 2MB."
              error={uploadError}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                {formState.iconImageUrl ? (
                  <img
                    src={formState.iconImageUrl}
                    alt="Category icon"
                    style={{ width: "48px", height: "48px", borderRadius: "8px", objectFit: "cover", border: "1px solid rgba(17,24,39,0.1)" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "48px", height: "48px", borderRadius: "8px",
                      background: "#F3F4F6", display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: "20px", flexShrink: 0,
                    }}
                  >
                    {formState.icon || "—"}
                  </div>
                )}
                <div>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleIconUpload} disabled={uploading} />
                  {uploading && <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>Uploading…</div>}
                  {formState.iconImageUrl && !uploading && (
                    <button
                      type="button"
                      onClick={() => setFormState((s) => ({ ...s, iconImageUrl: "" }))}
                      style={{ marginTop: "6px", fontSize: "12px", color: "#DC2626", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      Remove image
                    </button>
                  )}
                </div>
              </div>
            </FieldColumn>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
