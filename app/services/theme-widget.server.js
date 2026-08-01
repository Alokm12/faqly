// "Is the widget actually on the storefront?" check + the Theme Editor
// deep link that fixes it when the answer is no.
//
// A theme app extension ships with the app, but nothing renders until the
// merchant drags our app block onto a template. That gap is the single
// biggest cause of "I installed it and nothing happened" support tickets,
// so the dashboard asks Shopify whether the block is present on the LIVE
// (role: MAIN) theme and, if not, shows a one-click deep link.
//
// HOW DETECTION WORKS
// When a merchant adds an app block, the theme's JSON gains an entry with
//   "type": "shopify://apps/<app-handle>/blocks/<block-handle>/<uuid>"
// The app handle and the extension UUID both vary per store/deployment,
// so we match on the stable middle segment: "/blocks/faq-widget/".
//
// Requires the read_themes access scope. If the scope is missing or the
// call fails, we return status "unknown" and the dashboard shows nothing —
// a false "your widget is off" alarm is worse than no alert at all.

const BLOCK_HANDLE = "faq-widget";
const BLOCK_TYPE_MARKER = `/blocks/${BLOCK_HANDLE}/`;

// Templates a merchant would plausibly put an FAQ block on, plus the
// section-group files (header/footer/aside live in sections/*.json).
const THEME_FILE_PATTERNS = [
  "templates/*.json",
  "templates/customers/*.json",
  "sections/*.json",
];

const MAIN_THEME_FILES_QUERY = `#graphql
  query FaqlyMainThemeFiles($filenames: [String!]!) {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        name
        files(filenames: $filenames, first: 250) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Builds the Theme Editor deep link that drops our app block onto a
 * template in one click.
 *
 * Documented format:
 *   /admin/themes/current/editor
 *     ?template={template}
 *     &addAppBlockId={api_key}/{block_handle}
 *     &target={target}
 *
 * `addAppBlockId` takes the app's api_key (same value as client_id in
 * shopify.app.toml), NOT the extension UUID.
 *
 * @param {string} shop      myshopify domain
 * @param {object} [options]
 * @param {string} [options.template] Defaults to the product template —
 *   product pages are where FAQs earn their keep.
 * @param {string} [options.target]   newAppsSection | mainSection |
 *   sectionGroup:{header|footer|aside} | sectionId:{id}
 * @returns {string|null} null when the api key isn't configured.
 */
export function buildWidgetDeepLink(shop, { template = "product", target = "newAppsSection" } = {}) {
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!apiKey || !shop) return null;

  const params = new URLSearchParams({
    template,
    addAppBlockId: `${apiKey}/${BLOCK_HANDLE}`,
    target,
  });
  return `https://${shop}/admin/themes/current/editor?${params.toString()}`;
}

/**
 * True when this theme JSON file contains an enabled instance of our app
 * block.
 *
 * Parsing rather than a bare substring match matters for one case: a block
 * the merchant added and then toggled off is still written to the JSON
 * with `"disabled": true`. Rendering nothing while the file still mentions
 * us is exactly the state the alert exists to catch, so a disabled-only
 * match must not count as installed.
 *
 * If the JSON doesn't parse (merchant hand-edits happen), fall back to the
 * substring check — a possible false "installed" is the safer failure than
 * nagging a merchant whose widget is live.
 */
function fileHasEnabledBlock(content) {
  if (!content || !content.includes(BLOCK_TYPE_MARKER)) return false;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return true;
  }

  // Blocks nest (section → blocks → block), and templates and section
  // groups have slightly different top-level shapes, so walk the whole
  // tree instead of assuming a path.
  const stack = [parsed];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    if (typeof node.type === "string" && node.type.includes(BLOCK_TYPE_MARKER)) {
      if (node.disabled !== true) return true;
      continue;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return false;
}

/**
 * Checks the live theme for our app block.
 *
 * @param {(query: string, options?: object) => Promise<Response>} graphql
 *   Admin GraphQL client from `authenticate.admin`.
 * @returns {Promise<{status: "installed"|"missing"|"unknown", themeName: string|null}>}
 */
export async function getWidgetThemeStatus(graphql) {
  if (!graphql) return { status: "unknown", themeName: null };

  try {
    const response = await graphql(MAIN_THEME_FILES_QUERY, {
      variables: { filenames: THEME_FILE_PATTERNS },
    });
    const payload = await response.json();

    // A missing read_themes scope comes back as a top-level GraphQL error
    // with a 200, not an exception — treat it like any other unknown.
    if (payload?.errors?.length) {
      console.error("[Faqly] Theme block check failed:", payload.errors[0]?.message);
      return { status: "unknown", themeName: null };
    }

    const theme = payload?.data?.themes?.nodes?.[0];
    if (!theme) return { status: "unknown", themeName: null };

    const installed = (theme.files?.nodes ?? []).some((file) =>
      fileHasEnabledBlock(file?.body?.content),
    );

    return {
      status: installed ? "installed" : "missing",
      themeName: theme.name ?? null,
    };
  } catch (error) {
    // Network blip, throttle, revoked scope — none of these justify
    // telling the merchant their widget is off.
    console.error("[Faqly] Theme block check failed:", error);
    return { status: "unknown", themeName: null };
  }
}
