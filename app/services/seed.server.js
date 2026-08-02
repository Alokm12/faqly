// Starter content, created once when a store installs Faqly.
//
// WHY DRAFT AND NOT PUBLISHED
// Every answer below is a placeholder — "30 days", "2–5 business days",
// "$50" are guesses about someone else's business. Publishing them
// straight to a live storefront would put wrong shipping and returns
// information in front of real shoppers, which in most markets is a
// consumer-law problem, not just an embarrassment. They land as drafts so
// the merchant edits and publishes deliberately.
//
// Flip SEED_STATUS to "PUBLISHED" if you decide otherwise.
//
// WHY SEED AT ALL
// An empty first screen is the single biggest drop-off point in app
// onboarding. Fifteen editable drafts turn "what do I even write?" into
// "change this number and hit publish".

import prisma from "../db.server";

const SEED_STATUS = "DRAFT";

const SEED_CATEGORIES = [
  { handle: "shipping", name: "Shipping", icon: "🚚", color: "#5C6AC4" },
  { handle: "returns", name: "Returns & Exchanges", icon: "↩️", color: "#47C1BF" },
  { handle: "orders", name: "Orders", icon: "📦", color: "#F49342" },
  { handle: "payment", name: "Payment", icon: "💳", color: "#9C6ADE" },
  { handle: "products", name: "Products", icon: "🏷️", color: "#50B83C" },
];

const SEED_FAQS = [
  // --- Shipping ---
  {
    category: "shipping",
    question: "How long does delivery take?",
    answer:
      "Orders are packed within 1–2 business days. Standard delivery then takes 2–5 business days, and express delivery 1–2 business days.\n\nDelivery times can be longer during sale periods and public holidays.",
  },
  {
    category: "shipping",
    question: "How much does shipping cost?",
    answer:
      "Standard shipping is a flat rate, and it's **free on orders over $50**. Express shipping is charged separately.\n\nYou'll see the exact cost at checkout before you pay.",
  },
  {
    category: "shipping",
    question: "Do you ship internationally?",
    answer:
      "Yes, we ship to most countries. International delivery usually takes 7–14 business days.\n\nAny customs duties or import taxes are set by your country and are payable by you on delivery.",
  },
  {
    category: "shipping",
    question: "How do I track my order?",
    answer:
      "As soon as your order ships, we email you a tracking link. Tracking can take up to 24 hours to start updating after the carrier scans the parcel.\n\nIf you haven't received the email, please check your spam folder.",
  },

  // --- Returns ---
  {
    category: "returns",
    question: "What is your return policy?",
    answer:
      "You can return unused items in their original packaging within 30 days of delivery for a full refund.\n\nSome items can't be returned for hygiene reasons — this is noted on the product page.",
  },
  {
    category: "returns",
    question: "How do I start a return?",
    answer:
      "Reply to your order confirmation email with your order number and which items you'd like to return. We'll send you return instructions within one business day.",
  },
  {
    category: "returns",
    question: "When will I get my refund?",
    answer:
      "Refunds are issued to your original payment method within 3–5 business days of us receiving the return.\n\nDepending on your bank, it can take a few more days to appear on your statement.",
  },
  {
    category: "returns",
    question: "Can I exchange an item for a different size?",
    answer:
      "Yes. Start a return for the item you have, then place a new order for the size you want. This is the fastest way to get the right size before it sells out.",
  },

  // --- Orders ---
  {
    category: "orders",
    question: "Can I change or cancel my order?",
    answer:
      "Get in touch as soon as possible. If your order hasn't been packed yet, we can usually change or cancel it.\n\nOnce it has shipped, you'll need to return it instead.",
  },
  {
    category: "orders",
    question: "I received the wrong item — what now?",
    answer:
      "We're sorry. Send us a photo of what you received along with your order number and we'll ship the correct item at no cost to you.",
  },
  {
    category: "orders",
    question: "My order arrived damaged. What should I do?",
    answer:
      "Please contact us within 48 hours of delivery with photos of the damage and the packaging. We'll arrange a replacement or a full refund.",
  },

  // --- Payment ---
  {
    category: "payment",
    question: "What payment methods do you accept?",
    answer:
      "We accept all major credit and debit cards, plus the digital wallets shown at checkout, including Shop Pay, Apple Pay, Google Pay and PayPal.",
  },
  {
    category: "payment",
    question: "Is it safe to pay on this site?",
    answer:
      "Yes. Payments are processed through Shopify's secure, PCI-compliant checkout, and your card details are never stored on our servers.",
  },
  {
    category: "payment",
    question: "Do you offer discount codes?",
    answer:
      "Yes. Enter your code in the discount field at checkout. Only one code can be used per order, and codes can't be combined with other promotions.",
  },

  // --- Products ---
  {
    category: "products",
    question: "How do I find the right size?",
    answer:
      "Each product page has a size guide with detailed measurements. If you're between sizes, we'd suggest sizing up.\n\nStill unsure? Message us and we'll help.",
  },
  {
    category: "products",
    question: "An item is out of stock — will it come back?",
    answer:
      "Most items are restocked. Sign up for a back-in-stock alert on the product page and we'll email you the moment it's available again.",
  },
  {
    category: "products",
    question: "How should I care for my items?",
    answer:
      "Care instructions are on each product page and on the label. Following them is the best way to keep your items looking new for longer.",
  },
];

/* ------------------------------------------------------------------ */
/* Telling starter content apart from the merchant's own               */
/* ------------------------------------------------------------------ */

/**
 * The dashboard needs this distinction and it is not cosmetic.
 *
 * Seeding runs on install, so by the time a merchant first opens the app
 * they already have 17 FAQs and 5 categories. A setup checklist that marks
 * "create your first FAQ" done because `count > 0` would be complete
 * before they have done anything — it would be measuring our own writes.
 * Worse, the answers above contain invented policies ("30 days", "free
 * over $50"); a dashboard that reports "17 FAQs" and nothing else lets a
 * merchant activate the widget and put those numbers in front of real
 * shoppers.
 *
 * Seed handles are deliberately stable slugs (`faqly-<category>-<n>`)
 * while merchant handles always end in a base-36 timestamp, so the two are
 * distinguishable without adding a column. The category list is derived
 * from SEED_CATEGORIES rather than hardcoded so the two cannot drift.
 */
const SEED_FAQ_HANDLE = new RegExp(
  `^faqly-(${SEED_CATEGORIES.map((c) => c.handle).join("|")})-\\d+$`,
);
const SEED_CATEGORY_HANDLES = new Set(SEED_CATEGORIES.map((c) => c.handle));

export function isSeedFaqHandle(handle) {
  return SEED_FAQ_HANDLE.test(handle || "");
}

export function isSeedCategoryHandle(handle) {
  return SEED_CATEGORY_HANDLES.has(handle || "");
}

/**
 * True when a row has not been written since it was created.
 *
 * Prisma sets `createdAt` (@default(now())) and `updatedAt` (@updatedAt) in
 * the same INSERT, so on a freshly seeded row they are equal — but they are
 * two separate client-side values, so an exact `===` is not something to
 * rely on. Two seconds is far below any plausible human edit (seeding
 * finishes before the first page render) and far above any clock jitter
 * between the two assignments.
 */
export function isUnedited(row) {
  if (!row?.createdAt || !row?.updatedAt) return false;
  return new Date(row.updatedAt) - new Date(row.createdAt) < 2000;
}

export const SEED_FAQ_COUNT = SEED_FAQS.length;

/**
 * Creates the starter set for a shop. Idempotent by design: it does
 * nothing at all if the shop already has any FAQs, so it can never
 * overwrite a merchant's own content or duplicate itself on reinstall.
 */
export async function seedDefaults(shop) {
  const existing = await prisma.faq.count({ where: { shop } });
  if (existing > 0) return { seeded: false };

  const categoryIdByHandle = new Map();

  for (const [index, category] of SEED_CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { shop_handle: { shop, handle: category.handle } },
      create: {
        shop,
        handle: category.handle,
        name: category.name,
        icon: category.icon,
        color: category.color,
        position: index,
        visible: true,
      },
      update: {},
    });
    categoryIdByHandle.set(category.handle, row.id);
  }

  for (const [index, faq] of SEED_FAQS.entries()) {
    // Handles are stable slugs rather than the timestamped ones used for
    // merchant-created FAQs — that keeps the seed set recognisable and
    // makes the upsert genuinely idempotent.
    const handle = `faqly-${faq.category}-${index + 1}`;
    await prisma.faq.upsert({
      where: { shop_handle: { shop, handle } },
      create: {
        shop,
        handle,
        question: faq.question,
        answer: faq.answer,
        status: SEED_STATUS,
        position: index,
        categoryId: categoryIdByHandle.get(faq.category) ?? null,
      },
      update: {},
    });
  }

  return {
    seeded: true,
    categories: SEED_CATEGORIES.length,
    faqs: SEED_FAQS.length,
  };
}
