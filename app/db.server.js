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

let prisma;
if (isProd) {
  prisma = createClient();
} else {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createClient();
  }
  prisma = global.prismaGlobal;
}

export default prisma;
