import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/context.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Guarantees a Shop row exists before any child route writes a FAQ,
  // Category or Setting that references it, and clears the uninstall
  // marker when a merchant reinstalls — see app/models/context.server.js.
  await ensureShop(session.shop);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/faqs">FAQs</s-link>
        <s-link href="/app/categories">Categories</s-link>
        <s-link href="/app/assistant">AI Assistant</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/data">Data & backup</s-link>
        <s-link href="/app/billing">Plans & billing</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
