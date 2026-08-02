import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Faqly — FAQs for your Shopify store</h1>
        <p className={styles.text}>
          Answer your customers before they open a support ticket.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Organised by category</strong>. Group questions the way
            shoppers ask them, and they become filter tabs on your storefront.
          </li>
          <li>
            <strong>Targeted to products</strong>. Pin an FAQ to a product or
            collection so it only shows where it is relevant.
          </li>
          <li>
            <strong>Styled to match</strong>. Set the accent colour, type size
            and roundness in the app, with a live preview.
          </li>
        </ul>
      </div>
    </div>
  );
}
