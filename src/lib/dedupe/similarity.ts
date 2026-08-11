/**
 * How similar are two notes?
 *
 * No embeddings and no vector database. That is a considered choice, not a
 * shortcut: embeddings would mean an API call per submission, a paid vector
 * store, and a third party holding a mathematical representation of clinical
 * text. At the volume a data-entry practice actually handles — tens to low
 * hundreds of submissions a day — token overlap answers the question well
 * enough, instantly, for nothing, and with the note text never leaving the
 * database.
 *
 * Two measures, because they fail in opposite directions:
 *
 *  - **Jaccard** over the token sets is the honest baseline, but it punishes
 *    length differences. A three-line summary of a session and a full account
 *    of the same session score low on Jaccard even though one contains the
 *    other.
 *  - **Containment** — the overlap as a fraction of the *smaller* set — catches
 *    exactly that case, and is the one that matters most in practice, because
 *    the commonest real duplicate here is a short handwritten note that repeats
 *    what a longer typed one already said.
 *
 * The score returned is the higher of the two. Missing a duplicate costs a
 * typist twenty minutes of retyping; flagging a false one costs a human three
 * seconds to dismiss. The asymmetry says be generous.
 */

export interface SimilarityScore {
  jaccard: number;
  containment: number;
  /** max(jaccard, containment) — what the thresholds are applied to. */
  score: number;
  /** Tokens present in both, most useful first. Shown to the human deciding. */
  sharedTerms: string[];
  /** Tokens only in the newer one — "what is actually new here". */
  newTerms: string[];
}

export function compareTokens(a: string[], b: string[]): SimilarityScore {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) {
    return { jaccard: 0, containment: 0, score: 0, sharedTerms: [], newTerms: [] };
  }

  const shared: string[] = [];
  for (const token of setA) if (setB.has(token)) shared.push(token);

  const unionSize = setA.size + setB.size - shared.length;
  const jaccard = shared.length / unionSize;
  const containment = shared.length / Math.min(setA.size, setB.size);

  const newTerms = [...setA].filter((t) => !setB.has(t));

  return {
    jaccard,
    containment,
    score: Math.max(jaccard, containment),
    // Longer tokens carry more meaning than short ones, and the human reading
    // this list is scanning for whether the overlap is substantive.
    sharedTerms: shared.sort((x, y) => y.length - x.length).slice(0, 12),
    newTerms: newTerms.sort((x, y) => y.length - x.length).slice(0, 12),
  };
}

export function compareText(a: string, b: string, tokenizer: (s: string) => string[]) {
  return compareTokens(tokenizer(a), tokenizer(b));
}

/**
 * Thresholds.
 *
 * Tuned to the asymmetry described above and expected to be adjusted once a
 * real practice's traffic has been watched for a fortnight. They are named
 * constants rather than inline numbers precisely so that adjustment is a
 * one-line change with a visible blast radius.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.62;
/** Above this, do not bother a model — a human just needs to confirm it. */
export const OBVIOUS_DUPLICATE_THRESHOLD = 0.88;
/** Days either side of an encounter date that count as "the same period". */
export const DATE_PROXIMITY_DAYS = 3;
