// Shared FAQ status constants.
//
// WHY THIS IS A SEPARATE FILE (not exported from Faq.server.js):
// React Router treats any file named `*.server.js` as server-only and
// strips ALL of its exports from the code sent to the browser — even
// simple constants like this one. Since our FAQ form component (which
// runs in the browser) needs `FaqStatus.DRAFT` / `FaqStatus.PUBLISHED` to
// render the status dropdown, it can't import from Faq.server.js. This
// file has no `.server` in its name, so React Router bundles it for both
// client and server code, and both sides import from here instead.

export const FaqStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
};
