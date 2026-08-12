import "server-only";

import { Prisma } from "@prisma/client";

/**
 * "The database is reachable, but it is not the database this code expects."
 *
 * This is its own concept because it is the failure that has cost this project
 * the most time, and it never announces itself. A database missing a recent
 * migration answers `SELECT 1` perfectly, serves most of the application
 * happily, and throws only on the queries that touch a newer column — so it
 * presents as several unrelated bugs on several unrelated screens rather than
 * as one operational fact.
 */
export function isMissingSchema(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2021: the table is absent. P2022: the column is absent.
    return error.code === "P2021" || error.code === "P2022";
  }
  // Prisma reports some of these as an initialisation or validation failure
  // rather than a known request error, so the message is the only signal.
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist in the current database|column .* does not exist|relation .* does not exist/i.test(
    message
  );
}

/**
 * Thrown by the session layer when the user row cannot be read because the
 * schema is behind, so callers can tell it apart from "not signed in".
 *
 * The distinction matters: sending someone to `/login` when the real problem is
 * an unapplied migration produces a loop, because logging in performs the same
 * failing query. They land back at the login page with no idea why.
 */
export class SchemaBehindError extends Error {
  constructor() {
    super("The database is missing tables or columns this code requires.");
    this.name = "SchemaBehindError";
  }
}
