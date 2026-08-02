import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { PAID_PLAN_KEYS, PLANS } from "./models/plans";

/**
 * Billing config, derived from the plan catalogue in models/plans.js rather
 * than written out again here.
 *
 * That matters: the pricing page renders from the same object, so the amount
 * a merchant is shown and the amount Shopify charges cannot drift apart. Free
 * is absent on purpose — it is the absence of a subscription, not a $0 one.
 *
 * ALL CHARGES GO THROUGH SHOPIFY. An app distributed through the App Store is
 * not allowed to collect payment any other way, and `billing.request` is what
 * produces the confirmation URL a merchant approves.
 */
export const BILLING_PLANS = Object.fromEntries(
  PAID_PLAN_KEYS.map((key) => {
    const plan = PLANS[key];
    return [
      plan.name,
      {
        lineItems: [
          {
            amount: plan.amount,
            currencyCode: plan.currencyCode,
            interval: BillingInterval.Every30Days,
          },
        ],
        trialDays: plan.trialDays,
      },
    ];
  }),
);

const shopify = shopifyApp({
  billing: BILLING_PLANS,
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

/**
 * Whether charges are created in Shopify's test mode.
 *
 * ONE PLACE, DELIBERATELY. A test charge never bills the merchant and a live
 * one always does, so having two code paths decide this independently is how
 * you end up either charging a developer for real or handing production
 * merchants free plans. Everything billing-related imports this.
 *
 * Test charges also only work on development stores — Shopify rejects
 * `test: true` against a live shop — which is why this keys off NODE_ENV
 * rather than the shop domain.
 */
export const BILLING_IS_TEST = process.env.NODE_ENV !== "production";

/** Base URL Shopify returns merchants to after they approve a charge. */
export const APP_URL = process.env.SHOPIFY_APP_URL || "";

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
