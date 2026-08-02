import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * The global cache is what stops Vite's dev server from opening a new
 * connection pool on every hot reload — without it you eventually exhaust
 * the database's connection limit after a few dozen file saves.
 */
function createClient() {
  return new PrismaClient({
    // eslint-disable-next-line no-undef
    log:
      // eslint-disable-next-line no-undef
      process.env.NODE_ENV === "production"
        ? ["warn", "error"]
        : ["warn", "error"],
  });
}

// eslint-disable-next-line no-undef
const isProd = process.env.NODE_ENV === "production";

/**
 * Dev-only guard: shout when the running Prisma Client predates the schema.
 *
 * WHY THIS IS NEEDED
 * Vite hot-reloads modules but never restarts the Node process, and the
 * singleton above deliberately survives a reload. So after `prisma
 * generate`, every source file in the app is current while the client in
 * memory is still the one built at boot. Writes to a new column then fail
 * with `Unknown argument \`accentColor\``, which reads like an application
 * bug and is not one — the fix is a restart, and nothing on screen says so.
 *
 * The check works because it compares two things that cannot both go
 * stale: `prisma.<model>.fields`, which comes from the loaded client, and
 * schema.prisma read fresh off disk. Module caching cannot hide the
 * difference from us.
 *
 * Wrapped so it can never break boot — a diagnostic that takes the app
 * down is worse than the problem it reports.
 */
function warnIfClientIsStale(client) {
  try {
    // eslint-disable-next-line no-undef
    const schema = readFileSync(`${process.cwd()}/prisma/schema.prisma`, "utf8");
    const models = [...schema.matchAll(/\bmodel\s+(\w+)\s*\{([^}]*)\}/g)];

    // `prisma.<model>.fields` lists SCALAR fields only, so relation fields
    // ("faqs Faq[]", "shopRecord Shop") are absent from it by design and
    // would every one of them read as missing. Knowing the model names is
    // what lets us tell a relation from a column.
    const modelNames = new Set(models.map(([, name]) => name));
    const stale = [];

    for (const [, name, body] of models) {
      // Prisma exposes delegates camel-cased: model Setting -> prisma.setting
      const delegate = client[name[0].toLowerCase() + name.slice(1)];
      const known = delegate?.fields;

      // A model the client has never heard of. This used to `continue`,
      // which made the guard blind to exactly the worst case: adding a whole
      // new model, not restarting, and getting
      // "Cannot read properties of undefined (reading 'findUnique')" with
      // nothing explaining why. A missing model is the loudest kind of stale.
      if (!delegate) {
        stale.push(`${name}: entire model missing from the client`);
        continue;
      }
      if (!known) continue;

      const declared = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
        .map((line) => line.split(/\s+/))
        .filter(([field, type]) => /^\w+$/.test(field) && type)
        // Drop relations: strip the list/optional markers off the type and
        // see whether what remains names another model.
        .filter(([, type]) => !modelNames.has(type.replace(/[[\]?]/g, "")))
        .map(([field]) => field);

      const missing = declared.filter((field) => !(field in known));
      if (missing.length) stale.push(`${name}: ${missing.join(", ")}`);
    }

    if (!stale.length) return;

    console.warn(
      [
        "",
        "  ┌──────────────────────────────────────────────────────────────┐",
        "  │  Faqly: your Prisma Client is older than prisma/schema.prisma │",
        "  └──────────────────────────────────────────────────────────────┘",
        "",
        "  These fields exist in the schema but not in the running client:",
        ...stale.map((line) => `    - ${line}`),
        "",
        "  Any write touching them will fail with `Unknown argument`.",
        "  Hot reload cannot fix this: the client is loaded once per process.",
        "",
        "  Stop the dev server (Ctrl+C) and start it again:",
        "    npx prisma generate && shopify app dev",
        "",
      ].join("\n"),
    );
  } catch {
    // Schema unreadable, or a Prisma version that does not expose
    // `.fields`. Either way this is only a hint — say nothing and carry on.
  }
}

let prisma;
if (isProd) {
  prisma = createClient();
} else {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createClient();
  }
  prisma = global.prismaGlobal;
  // Runs on every hot reload, not just the first boot — the whole point is
  // to catch the window where the source has moved on and the client has not.
  warnIfClientIsStale(prisma);
}

export default prisma;
