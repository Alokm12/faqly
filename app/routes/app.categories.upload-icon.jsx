// Handles image/SVG uploads for category icons.
//
// Shopify doesn't let apps upload files directly to their own server —
// files go through a 3-step "staged upload" flow:
//   1. stagedUploadsCreate — ask Shopify for a temporary upload URL
//   2. POST the actual file bytes to that URL
//   3. fileCreate — tell Shopify to turn the uploaded bytes into a
//      permanent File record, which gives us back a public image URL
//
// ⚠️ NOT LIVE-TESTED: this exact 3-step flow (and especially whether
// `preview.image.url` is populated immediately in fileCreate's response
// vs. needing a follow-up poll while Shopify processes the image) could
// not be verified against a live store in this conversation. If the
// upload fails or the returned image doesn't display, the error message
// returned here should indicate which step failed — share that and we
// can adjust.

import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const file = formData.get("icon");

  if (!file || typeof file === "string") {
    return Response.json({ error: "No file received" }, { status: 400 });
  }

  if (file.size > 2 * 1024 * 1024) {
    return Response.json({ error: "Image must be under 2MB" }, { status: 400 });
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return Response.json(
      { error: "Only PNG, JPEG, WebP, or SVG images are allowed" },
      { status: 400 },
    );
  }

  // Step 1: request a staged upload target.
  const stagedResponse = await admin.graphql(
    `#graphql
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: [
          {
            filename: file.name,
            mimeType: file.type,
            httpMethod: "POST",
            resource: "FILE",
          },
        ],
      },
    },
  );
  const stagedData = await stagedResponse.json();
  const stagedErrors = stagedData.data?.stagedUploadsCreate?.userErrors;
  if (stagedErrors?.length) {
    return Response.json(
      { error: `Staged upload failed: ${stagedErrors.map((e) => e.message).join(", ")}` },
      { status: 500 },
    );
  }
  const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    return Response.json({ error: "No upload target returned" }, { status: 500 });
  }

  // Step 2: upload the actual file bytes to Shopify's staged URL.
  const uploadForm = new FormData();
  for (const param of target.parameters) {
    uploadForm.append(param.name, param.value);
  }
  uploadForm.append("file", file);

  const uploadResponse = await fetch(target.url, {
    method: "POST",
    body: uploadForm,
  });
  if (!uploadResponse.ok) {
    return Response.json(
      { error: `File upload to Shopify failed (status ${uploadResponse.status})` },
      { status: 500 },
    );
  }

  // Step 3: register the uploaded file as a permanent Shopify File.
  const fileCreateResponse = await admin.graphql(
    `#graphql
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          preview { image { url } }
          ... on MediaImage {
            image { url }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }],
      },
    },
  );
  const fileCreateData = await fileCreateResponse.json();
  const fileErrors = fileCreateData.data?.fileCreate?.userErrors;
  if (fileErrors?.length) {
    return Response.json(
      { error: `Saving file failed: ${fileErrors.map((e) => e.message).join(", ")}` },
      { status: 500 },
    );
  }

  const created = fileCreateData.data?.fileCreate?.files?.[0];
  const url = created?.image?.url || created?.preview?.image?.url;

  if (!url) {
    // The file was created but Shopify hasn't finished processing it
    // into a viewable image yet (common for larger images). The
    // resourceUrl is a temporary URL and shouldn't be stored long-term,
    // so we surface this as a retry-able state rather than a hard error.
    return Response.json(
      {
        error:
          "Image uploaded but is still processing on Shopify's side — wait a few seconds and try saving the category again.",
      },
      { status: 202 },
    );
  }

  return Response.json({ url });
};
