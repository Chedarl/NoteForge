import { createHash } from "crypto";

/**
 * Turning note text into something two submissions can be compared on.
 *
 * The problem this solves is specific. The same session, handed over twice, is
 * almost never byte-identical: once it is typed into the portal and once it is
 * photographed and transcribed, so the second copy carries OCR quirks, a
 * different date format, and the template labels the transcriber typed. Compare
 * those raw and the similarity score is low enough to miss a certain duplicate.
 *
 * So the text is stripped to the clinically load-bearing words: lowercased,
 * punctuation dropped, template scaffolding removed, stopwords removed,
 * deduplicated, sorted. What is left is a bag of the terms a clinician actually
 * chose. Two accounts of the same session share most of them; two different
 * sessions with the same client share far fewer.
 *
 * Sorting the tokens is what makes this robust against reordering — a
 * transcriber who types the Plan before the Subjective produces the same bag.
 */

/**
 * Ordinary English filler plus the scaffolding this product puts on the page
 * itself. The template labels are in here because they appear in every single
 * submission of that template; leaving them in would make every SOAP note look
 * a little bit like every other SOAP note and drag every score upward.
 */
const STOPWORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at",
  "be", "been", "being", "but", "by", "can", "could", "did", "do", "does", "during", "each",
  "for", "from", "further", "had", "has", "have", "he", "her", "here", "him", "his", "how",
  "i", "if", "in", "into", "is", "it", "its", "just", "me", "more", "most", "my", "no", "not",
  "of", "on", "or", "other", "our", "out", "over", "own", "same", "she", "should", "so",
  "some", "such", "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "we",
  "were", "what", "when", "where", "which", "while", "who", "will", "with", "would", "you",
  "your",
  // Template scaffolding — present in every submission of a given shape.
  "subjective", "objective", "assessment", "plan", "data", "behaviour", "behavior",
  "intervention", "response", "narrative", "session", "client", "notes", "note",
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function cleanText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The comparable form: unique, meaningful, sorted tokens.
 *
 * Numbers under three digits are kept — a PHQ-9 score of 14 and a score of 21
 * are exactly the difference that makes two otherwise identical notes *not*
 * duplicates, and dropping short numeric tokens would erase it.
 */
export function tokenize(input: string): string[] {
  const words = cleanText(input).split(" ");
  const kept = new Set<string>();
  for (const word of words) {
    if (!word) continue;
    if (STOPWORDS.has(word)) continue;
    if (word.length < 3 && !/^\d+$/.test(word)) continue;
    kept.add(word);
  }
  return [...kept].sort();
}

export function normalizeForCompare(input: string): string {
  return tokenize(input).join(" ");
}

/**
 * sha256 of the normalised form.
 *
 * A hash match is a *certain* duplicate and it costs one index lookup, so it
 * runs before anything cleverer. It catches the most common real case by a wide
 * margin: the same submission sent twice because the therapist was not sure the
 * first one went through.
 */
export function contentHash(input: string): string {
  return createHash("sha256").update(normalizeForCompare(input)).digest("hex");
}
