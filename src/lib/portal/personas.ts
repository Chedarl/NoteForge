import type { Discipline, TemplateKind } from "@prisma/client";

/**
 * What each kind of clinician sees when they open the app.
 *
 * ## The problem this solves
 *
 * Everybody landed on the same roster behind the same eight tabs — a recovery
 * coach standing outside somebody's house and a nurse practitioner at a desk
 * got an identical screen. That forced every person to translate "what I am
 * holding right now" into "which tab is that", and that translation is where an
 * update stops getting filed.
 *
 * The product already knew who each person was professionally: `disciplines.ts`
 * has carried a label, a description of the work and an ordered template list
 * for each of six disciplines since early on. It spent that knowledge on
 * exactly one decision — which template appears first in a dropdown.
 *
 * ## Why a portal is data rather than a page
 *
 * Three hand-written dashboards would multiply the cost of every future change
 * by three and drift apart within a month; the third one always gets forgotten.
 * So a portal is a **config entry** and there is a single renderer. Reshaping a
 * portal, or moving a discipline between portals, is an edit to this file and
 * touches no JSX at all.
 *
 * ## Branch on discipline, never on role
 *
 * `UserRole` decides what somebody is *permitted* to do; `Discipline` decides
 * what they *professionally do*. A nurse practitioner and a social case worker
 * are both `UserRole.THERAPIST` — keying this off role would hand them the same
 * screen again, which is the bug being fixed.
 *
 * ## What must not vary
 *
 * The client code leading every row, the status guardrail, the duplicate check,
 * the audit trail and the exported PDF are identical under all three portals.
 * Only the way in changes. If a portal ever needed its own export shape, the
 * person writing notes downstream would have to learn three documents, and the
 * whole point of this product is that they learn one.
 *
 * Client-safe by construction: no `server-only` import, because the dashboard
 * renders these on the client. Same split as `disciplines.ts` and `needs.ts`.
 */

/** The three real portals, plus the honest fallback. */
export type PortalKind = "FIELD_CASE" | "CLINICAL" | "SESSION" | "GENERIC";

/**
 * Icons are named, not imported.
 *
 * Keeping this file free of JSX is what lets it stay a plain data module that
 * the intake form, the dashboard and any future surface can all read.
 */
export type PortalIcon =
  | "mic"
  | "camera"
  | "pen"
  | "link"
  | "stethoscope"
  | "inbox"
  | "notebook";

export interface PortalAction {
  href: string;
  label: string;
  /** One line under the label on the large card. Omitted on the small ones. */
  hint?: string;
  icon: PortalIcon;
}

/**
 * A fact shown under a client's name.
 *
 * Deliberately a key rather than a value: the persona declares *what matters to
 * this kind of clinician*, and one server function resolves the whole visible
 * list in a single query. See `clientFacts.ts`.
 */
export type ClientFactKey =
  | "status"
  | "lastContact"
  | "needs"
  | "medication"
  | "sessionCount"
  /**
   * Both of these resolve to nothing until the §3 field sets land — risk needs
   * the `severity` fields on `NURSING`, and a goal is not modelled anywhere
   * yet. They are declared now because the persona is a statement of what this
   * clinician should see, and a fact with no data renders as *nothing*, never
   * as an empty chip. An empty "risk" chip would read as "no risk recorded"
   * when it means "not asked yet", which is the worse of the two failures.
   */
  | "risk"
  | "goal";

export interface PortalPersona {
  kind: PortalKind;
  /** Names the portal in settings and in the profile screen, not on the dashboard. */
  title: string;
  /** The first line of the dashboard. Written as a question where the work is "who did you see". */
  greeting: string;
  /** The one large card. There is exactly one, on purpose. */
  primaryAction: PortalAction;
  secondaryActions: PortalAction[];
  nav: { href: string; label: string }[];
  /** Heading above the client list. "Seen recently" reads differently from "Your caseload". */
  clientsHeading: string;
  clientFacts: ClientFactKey[];
  /**
   * Label overrides applied **at render time only**, keyed by template field id.
   * The stored id never changes, so history stays comparable and the export
   * stays one format — this is what makes "chief complaint" and "client
   * presentation" the same field rather than two.
   */
  vocabulary: Record<string, string>;
  /**
   * How much fits on a screen. A coach outdoors needs one decision and big
   * targets; a nurse practitioner is reading four facts per client.
   */
  density: "roomy" | "standard" | "dense";
  /** Offered first on the dashboard's primary action. Never a restriction. */
  templates: TemplateKind[];
}

/**
 * Which portal each discipline lands in.
 *
 * Recovery Coach and Social Case Worker share one because they do the same
 * psychosocial work against the same needs vocabulary — the coach is the
 * field-mobile end of that job, not a separate profession. Therapist and
 * Counsellor share one because they already mapped to identical template lists
 * in `disciplines.ts`; splitting them would be a distinction without a
 * difference.
 */
export const PORTAL_FOR_DISCIPLINE: Record<Discipline, PortalKind> = {
  RECOVERY_COACH: "FIELD_CASE",
  SOCIAL_CASE_WORKER: "FIELD_CASE",
  NURSE_PRACTITIONER: "CLINICAL",
  COUNSELLOR: "SESSION",
  THERAPIST: "SESSION",
  OTHER: "GENERIC",
};

const PHOTOGRAPH: PortalAction = {
  href: "/t/upload",
  label: "Photograph notes",
  icon: "camera",
};

/**
 * The fast one-box path at `/t/write`, for a clinician logging several clients
 * in a row. Note it is *not* the spoken route — dictation lives on
 * `TemplateField`, which only `/t/new` renders, so a "Record" button pointing
 * here would open a page with no microphone on it at all.
 */
const QUICK: PortalAction = {
  href: "/t/write",
  label: "Quick update",
  icon: "pen",
};

export const PERSONAS: Record<PortalKind, PortalPersona> = {
  /*
   * Outdoors, one thumb, often no signal. Speaking is the fastest route to a
   * filed update, so it gets the large card — a coach who has to pick a
   * template and fill a form before saying anything files nothing at all.
   */
  FIELD_CASE: {
    kind: "FIELD_CASE",
    title: "Field & Case",
    greeting: "Who did you see?",
    primaryAction: {
      // NARRATIVE is a single prose box, and every prose field carries a
      // microphone via `TemplateField` — so this is genuinely the spoken route.
      href: "/t/new?template=NARRATIVE",
      label: "Record a visit",
      hint: "Speak it or type it — one box",
      icon: "mic",
    },
    secondaryActions: [
      PHOTOGRAPH,
      QUICK,
      { href: "/t/team", label: "Send a worker their link", icon: "link" },
    ],
    nav: [
      { href: "/t", label: "Home" },
      { href: "/t/clients", label: "Clients" },
      { href: "/t/team", label: "My workers" },
      { href: "/t/profile", label: "Profile" },
    ],
    clientsHeading: "Seen recently",
    clientFacts: ["status", "needs", "lastContact"],
    vocabulary: {
      situation: "How they were when you saw them",
      actions: "What you did",
    },
    density: "roomy",
    templates: ["NARRATIVE", "CASE_MANAGEMENT"],
  },

  /*
   * The densest form in the product, and still phone-first: a nurse
   * practitioner reads this on a ward round, not at a desk. Field updates land
   * in the review queue first, which is why this is the only portal carrying it.
   */
  CLINICAL: {
    kind: "CLINICAL",
    title: "Clinical",
    greeting: "Your caseload",
    primaryAction: {
      href: "/t/new?template=NURSING",
      label: "Start a clinical encounter",
      hint: "Presentation · state · risk · medication",
      icon: "stethoscope",
    },
    secondaryActions: [PHOTOGRAPH, QUICK],
    nav: [
      { href: "/t", label: "Home" },
      { href: "/t/clients", label: "Caseload" },
      { href: "/t/review", label: "Review" },
      { href: "/t/team", label: "Team" },
      { href: "/t/profile", label: "Profile" },
    ],
    clientsHeading: "Your clients",
    clientFacts: ["status", "risk", "medication", "lastContact"],
    vocabulary: {
      presentation: "Chief complaint",
    },
    density: "dense",
    templates: ["NURSING", "SOAP", "NARRATIVE", "DAP"],
  },

  /*
   * SOAP, DAP and BIRP shape the entire form, so the choice belongs before the
   * first word rather than in a dropdown halfway down the page. No review
   * queue: a counsellor is not supervising field workers.
   */
  SESSION: {
    kind: "SESSION",
    title: "Session",
    greeting: "Your sessions",
    primaryAction: {
      href: "/t/new",
      label: "Start a session note",
      hint: "Pick the format first",
      icon: "notebook",
    },
    secondaryActions: [PHOTOGRAPH, QUICK],
    nav: [
      { href: "/t", label: "Home" },
      { href: "/t/clients", label: "Clients" },
      { href: "/t/insights", label: "Insights" },
      { href: "/t/profile", label: "Profile" },
    ],
    clientsHeading: "In your care",
    clientFacts: ["status", "sessionCount", "goal", "lastContact"],
    vocabulary: {},
    density: "standard",
    templates: ["SOAP", "DAP", "BIRP", "NARRATIVE"],
  },

  /*
   * "I do not fit one of these", and anybody who has not set a discipline yet.
   * They keep the roster they have always had plus every route, because
   * guessing at a portal for somebody whose work we do not know would be worse
   * than the screen they are used to. The layout already shows them a banner
   * asking them to set a discipline.
   */
  GENERIC: {
    kind: "GENERIC",
    title: "All templates",
    greeting: "Your clients",
    primaryAction: {
      href: "/t/new",
      label: "File an update",
      hint: "Choose a template first",
      icon: "notebook",
    },
    secondaryActions: [PHOTOGRAPH, QUICK],
    nav: [
      { href: "/t", label: "Clients" },
      { href: "/t/write", label: "Write" },
      { href: "/t/new", label: "Structured" },
      { href: "/t/upload", label: "Photos" },
      { href: "/t/review", label: "Review" },
      { href: "/t/team", label: "Field team" },
      { href: "/t/insights", label: "Insights" },
      { href: "/t/profile", label: "Profile" },
    ],
    clientsHeading: "Your clients",
    clientFacts: ["status", "lastContact"],
    vocabulary: {},
    density: "standard",
    templates: ["SOAP", "DAP", "BIRP", "NARRATIVE", "CASE_MANAGEMENT", "NURSING"],
  },
};

export function portalFor(discipline: Discipline | null): PortalKind {
  if (!discipline) return "GENERIC";
  return PORTAL_FOR_DISCIPLINE[discipline] ?? "GENERIC";
}

export function personaFor(discipline: Discipline | null): PortalPersona {
  return PERSONAS[portalFor(discipline)];
}

/**
 * A field's label as this clinician should read it.
 *
 * Falls through to the template's own label, so a persona only has to name the
 * handful of fields whose wording actually differs in their profession.
 */
export function labelFor(persona: PortalPersona, fieldId: string, fallback: string): string {
  return persona.vocabulary[fieldId] ?? fallback;
}
