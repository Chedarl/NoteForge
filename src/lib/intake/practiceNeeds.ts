import "server-only";

import { prisma } from "@/lib/prisma";
import { offeredNeeds, type NeedDefinition } from "@/lib/intake/needs";

/**
 * The needs list a given practice should be offered.
 *
 * The standard spine is a constant and needs no database; only the practice's
 * own additions do. Kept as its own server module so the vocabulary itself
 * (`needs.ts`) stays client-safe and can be imported by the form, which is the
 * same split `disciplines.ts` and `clients/labels.ts` use.
 */
export async function practiceNeeds(practiceId: string): Promise<NeedDefinition[]> {
  const local = await prisma.practiceNeed.findMany({
    where: { practiceId },
    orderBy: { label: "asc" },
    select: { needId: true, label: true, hint: true, retiredAt: true },
  });

  return offeredNeeds(
    local.map((row) => ({
      id: row.needId,
      label: row.label,
      hint: row.hint ?? "",
      retired: row.retiredAt !== null,
    }))
  );
}
