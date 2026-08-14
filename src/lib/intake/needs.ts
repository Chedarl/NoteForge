/**
 * The psychosocial needs a field worker picks from.
 *
 * ## Why a fixed list rather than a text box
 *
 * "Needs identified" is a textarea today, and a textarea cannot be counted,
 * compared or carried forward. Two coaches write "no stable housing" and
 * "homeless" about the same person and nothing in the product can tell they
 * mean the same thing — so the practice cannot answer "how many of our clients
 * have a housing problem", and a worker filing an update next week starts from
 * a blank box and retypes the situation from memory.
 *
 * A controlled list fixes all of that at once. It is also faster to file, which
 * is the complaint that started this: tapping five items takes seconds, and
 * describing the same five in prose takes minutes.
 *
 * ## Why these particular items
 *
 * They are the health-related social needs that behavioural health screening
 * tools already converge on — housing, food, transport, utilities, personal
 * safety, work, education, money, isolation — plus the two clinical domains a
 * recovery coach is most often reporting on. Using domains that payers and
 * downstream systems already recognise means the exported data means something
 * to whoever receives it, rather than being a vocabulary this product invented
 * for itself.
 *
 * ## The ids are permanent
 *
 * A stored submission holds `["housing", "food"]`. Rename an id and every
 * historical submission silently stops matching — the comparison that makes
 * this feature worth having is the first thing to break, and it breaks
 * quietly. **Labels may be reworded freely; ids may never be changed or
 * reused.** Retiring an item means adding `retired: true`, not deleting it,
 * so old submissions still render.
 *
 * Client-safe by construction: no `server-only` import, because the intake form
 * is a client component. Same split as `disciplines.ts` and `clients/labels.ts`.
 */

export interface NeedDefinition {
  /** Permanent. See the note above before touching one of these. */
  id: string;
  label: string;
  /** What a worker should be thinking about when they consider ticking it. */
  hint: string;
  /**
   * Hidden from new submissions but still rendered on old ones. Nothing is ever
   * deleted from this list.
   */
  retired?: boolean;
}

/**
 * The standard spine, identical in every practice.
 *
 * Practices may add their own items on top (`PracticeNeed`), which keeps local
 * vocabulary possible without making two practices' data incomparable.
 */
export const STANDARD_NEEDS: readonly NeedDefinition[] = [
  {
    id: "housing",
    label: "Housing",
    hint: "Homeless, sofa-surfing, at risk of eviction, or unsafe accommodation.",
  },
  {
    id: "food",
    label: "Food",
    hint: "Skipping meals, no reliable source of food, no means to cook.",
  },
  {
    id: "transport",
    label: "Transport",
    hint: "Cannot get to appointments, work, or the pharmacy.",
  },
  {
    id: "utilities",
    label: "Utilities",
    hint: "Power, heating or water shut off, or a notice threatening it.",
  },
  {
    id: "safety",
    label: "Personal safety",
    hint: "Violence or fear of it at home or elsewhere. Not the same as clinical risk.",
  },
  {
    id: "benefits",
    label: "Benefits and entitlements",
    hint: "Medicaid, SNAP, SSI — not enrolled, lapsed, or a claim in dispute.",
  },
  {
    id: "identification",
    label: "Identification and documents",
    hint: "No ID, birth certificate or social security card. Blocks nearly everything else.",
  },
  {
    id: "employment",
    label: "Work and income",
    hint: "Out of work, at risk of losing work, or income that does not cover essentials.",
  },
  {
    id: "education",
    label: "Education and literacy",
    hint: "Cannot read forms, or a course or qualification is at risk.",
  },
  {
    id: "legal",
    label: "Legal",
    hint: "Court dates, probation conditions, immigration matters, outstanding fines.",
  },
  {
    id: "childcare",
    label: "Childcare and family",
    hint: "Caring responsibilities, custody proceedings, child protection involvement.",
  },
  {
    id: "isolation",
    label: "Isolation",
    hint: "No support network, or cut off from the one they had.",
  },
  {
    id: "medical_access",
    label: "Access to medical care",
    hint: "No primary care, cannot reach a prescriber, or medication they cannot obtain.",
  },
  {
    id: "substance_use",
    label: "Substance use",
    hint: "Use affecting the person's situation, or a change in what they are using.",
  },
  {
    id: "mental_health",
    label: "Mental health",
    hint: "Symptoms affecting daily life. Clinical risk is recorded separately.",
  },
] as const;

/** Ids the standard list owns, so a practice addition cannot shadow one. */
export const STANDARD_NEED_IDS: ReadonlySet<string> = new Set(
  STANDARD_NEEDS.map((need) => need.id)
);

/**
 * How a practice's own additions arrive at the form.
 *
 * Kept structurally identical to a standard need so the renderer does not care
 * which it is holding — only the settings screen distinguishes them, and only
 * so it knows which may be edited.
 */
export interface PracticeNeedDefinition extends NeedDefinition {
  practiceId: string;
}

/**
 * The list a form should offer: the standard spine, then the practice's own.
 *
 * Retired items are dropped from the offer but deliberately kept resolvable by
 * `labelForNeed`, so a submission filed two years ago still renders its needs by
 * name rather than as a bare id.
 */
export function offeredNeeds(
  practiceNeeds: readonly NeedDefinition[] = []
): NeedDefinition[] {
  return [
    ...STANDARD_NEEDS.filter((need) => !need.retired),
    ...practiceNeeds.filter((need) => !need.retired && !STANDARD_NEED_IDS.has(need.id)),
  ];
}

/**
 * A need id as it should appear to a person.
 *
 * Falls back to the id rather than to "Unknown": an id that has lost its
 * definition is still information, and printing "Unknown" on an exported PDF
 * would throw away the only thing left.
 */
export function labelForNeed(
  id: string,
  practiceNeeds: readonly NeedDefinition[] = []
): string {
  const standard = STANDARD_NEEDS.find((need) => need.id === id);
  if (standard) return standard.label;
  const local = practiceNeeds.find((need) => need.id === id);
  if (local) return local.label;
  return id;
}

/** Several ids to labels, in the order the list defines rather than the order picked. */
export function labelsForNeeds(
  ids: readonly string[],
  practiceNeeds: readonly NeedDefinition[] = []
): string[] {
  const order = offeredNeeds(practiceNeeds).map((need) => need.id);
  const known = ids.filter((id) => order.includes(id)).sort(
    (a, b) => order.indexOf(a) - order.indexOf(b)
  );
  // Ids from retired or deleted definitions keep their place at the end rather
  // than vanishing, for the same reason `labelForNeed` falls back to the id.
  const rest = ids.filter((id) => !order.includes(id));
  return [...known, ...rest].map((id) => labelForNeed(id, practiceNeeds));
}

/**
 * Turns a practice's own label into an id.
 *
 * Prefixed so a local addition can never collide with a standard id, now or
 * when the standard list grows — which it will, and which would otherwise
 * silently merge two different meanings under one id.
 */
export function practiceNeedId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `local_${slug}`;
}
