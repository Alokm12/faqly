// Which errors a merchant is allowed to read.
//
// WHY THIS EXISTS
// Actions used to answer a failure with `error.message` verbatim. That is
// right for the handful of errors we raise on purpose ("This file isn't a
// Faqly backup.") and wrong for everything else: a Prisma validation
// failure renders its entire invocation into the admin — the full argument
// list, the column names, the shop domain — inside a red banner the
// merchant can do nothing about. It is noise to them, it is a support
// ticket for you, and it puts the shape of the database on screen.
//
// So: errors we wrote for a person are `UserError` and are shown as-is.
// Everything else is logged in full on the server and replaced with one
// sentence.

/**
 * An error whose message was written to be read by a merchant.
 *
 * Throw this from a service when the cause is something the merchant can
 * actually act on — a wrong file, a value out of range, a conflicting
 * name. Throw a plain Error (or let one propagate) for anything that is
 * our problem rather than theirs.
 */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

/**
 * Resolves an error to something safe to render, logging whatever is not.
 *
 * @param {unknown} error     Whatever reached the catch block.
 * @param {string}  fallback  Shown when the error is not merchant-facing.
 * @param {string}  [context] Prefix for the server log, e.g. "Save settings".
 * @returns {string}
 */
export function toUserMessage(error, fallback, context = "Action failed") {
  // Checked by name as well as by prototype: `instanceof` is the clearer
  // test, but it quietly returns false if a bundler ever gives the client
  // and server copies of this module separate class identities, and the
  // failure mode there is a real message being swallowed.
  if (error instanceof UserError || error?.name === "UserError") {
    return error.message;
  }

  // The full error — stack included — goes to the server log, which is
  // where the person who can fix it is looking.
  console.error(`[Faqly] ${context}:`, error);
  return fallback;
}
