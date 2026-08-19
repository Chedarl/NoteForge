import "server-only";

/**
 * How many clients a picker is allowed to render.
 *
 * Every intake screen builds a `<select>` from the caseload with no ceiling on
 * it. At the size these have run so far — dozens — that is invisible. At two
 * thousand it is two thousand `<option>` elements in the HTML of *every* page
 * load on a phone, and the failure arrives as "the app is slow" long before
 * anybody connects it to the number of clients.
 *
 * A cap rather than pagination, because a dropdown cannot be paginated in any
 * way a person would thank you for. What matters is that the cap is honest: the
 * screen says when it is showing a subset and points at the caseload, where the
 * client is findable and every row links straight back to the form with that
 * client already chosen. That route already exists and already works.
 *
 * Ordered by most recently seen, so the cap falls on the part of a long
 * caseload nobody is about to write about.
 */
export const PICKER_LIMIT = 200;

/**
 * `take` for a picker query, plus one.
 *
 * The extra row is how the caller knows there were more without a second
 * `count()` — if it comes back, the list is capped. Cheaper than counting, and
 * exact.
 */
export const PICKER_TAKE = PICKER_LIMIT + 1;

export interface PickList<T> {
  clients: T[];
  /** True when the caseload is larger than the picker is showing. */
  capped: boolean;
}

/** Trims the sentinel row and reports whether it was there. */
export function toPickList<T>(rows: T[]): PickList<T> {
  return rows.length > PICKER_LIMIT
    ? { clients: rows.slice(0, PICKER_LIMIT), capped: true }
    : { clients: rows, capped: false };
}
