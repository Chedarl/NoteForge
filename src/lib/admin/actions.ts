"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/email/send";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";
import { normalizeWhatsAppNumber } from "@/lib/sharing/phone";

export interface SettingsState {
  error?: string;
  success?: string;
}

export interface InviteState {
  error?: string;
  success?: string;
}

const inviteSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["THERAPIST", "SPECIALIST"]),
  discipline: z.enum([
    "SOCIAL_CASE_WORKER",
    "NURSE_PRACTITIONER",
    "THERAPIST",
    "COUNSELLOR",
    "OTHER",
  ]),
});

export async function updatePracticeSettings(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const owner = await requireRole(["OWNER"]);
  const rawPhone = String(formData.get("noteWriterWhatsApp") ?? "");
  const phone = normalizeWhatsAppNumber(rawPhone);
  if (rawPhone.trim() && !phone) {
    return { error: "Enter a WhatsApp number with country code, for example +1 312 555 0123." };
  }

  const previous = await prisma.practice.findUnique({
    where: { id: owner.practiceId },
    select: { noteWriterWhatsApp: true },
  });
  await prisma.practice.update({
    where: { id: owner.practiceId },
    data: { noteWriterWhatsApp: phone },
  });
  await writeAudit({
    practiceId: owner.practiceId,
    actor: owner,
    action: "practice.whatsapp_updated",
    entityType: "practice",
    entityId: owner.practiceId,
    changes: {
      noteWriterWhatsApp: {
        from: previous?.noteWriterWhatsApp ? "configured" : "not configured",
        to: phone ? "configured" : "not configured",
      },
    },
  });

  revalidatePath("/s/settings");
  return { success: "WhatsApp destination saved." };
}

export async function invitePracticeUser(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const owner = await requireRole(["OWNER"]);
  const parsed = inviteSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    role: formData.get("role"),
    discipline: formData.get("discipline"),
  });
  if (!parsed.success) return { error: "Enter a name, valid email, role and discipline." };

  const { email, fullName, role, discipline } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { error: "That email already belongs to a NoteForge account." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl()}/auth/callback?next=/set-password`,
    data: { full_name: fullName },
  });
  if (error || !data.user) {
    return { error: "The invitation could not be sent. Check the email and try again." };
  }

  try {
    const invited = await prisma.user.create({
      data: {
        authUserId: data.user.id,
        email,
        fullName,
        role,
        discipline: role === "THERAPIST" ? discipline : null,
        practiceId: owner.practiceId,
      },
    });
    await writeAudit({
      practiceId: owner.practiceId,
      actor: owner,
      action: "user.invited",
      entityType: "user",
      entityId: invited.id,
      entityLabel: email,
      changes: { role: { from: null, to: role } },
    });
  } catch (dbError) {
    try {
      await admin.auth.admin.deleteUser(data.user.id);
    } catch (cleanupError) {
      logSafe("invite", "failed to remove unprovisioned auth identity", {
        authUserId: data.user.id,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    logSafe("invite", "practice user provisioning failed", {
      authUserId: data.user.id,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    });
    return { error: "The account could not be created. Please try again." };
  }

  revalidatePath("/s/settings");
  return { success: `Invitation sent to ${email}.` };
}

export async function setPracticeUserStatus(formData: FormData): Promise<void> {
  const owner = await requireRole(["OWNER"]);
  const userId = String(formData.get("userId") ?? "");
  const nextStatus = String(formData.get("status") ?? "");
  if (!userId || !["ACTIVE", "SUSPENDED"].includes(nextStatus)) return;
  if (userId === owner.id) return;

  const target = await prisma.user.findFirst({
    where: { id: userId, practiceId: owner.practiceId, role: { in: ["THERAPIST", "SPECIALIST"] } },
  });
  if (!target || target.status === nextStatus) return;

  await prisma.user.update({
    where: { id: target.id },
    data: { status: nextStatus as "ACTIVE" | "SUSPENDED" },
  });
  await writeAudit({
    practiceId: owner.practiceId,
    actor: owner,
    action: nextStatus === "ACTIVE" ? "user.reactivated" : "user.suspended",
    entityType: "user",
    entityId: target.id,
    entityLabel: target.email,
    changes: { status: { from: target.status, to: nextStatus } },
  });
  revalidatePath("/s/settings");
}

export async function setPlatformUserStatus(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const userId = String(formData.get("userId") ?? "");
  const nextStatus = String(formData.get("status") ?? "");
  if (!userId || !["ACTIVE", "SUSPENDED"].includes(nextStatus) || userId === admin.id) return;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.status === nextStatus) return;
  if (target.isPlatformAdmin && nextStatus === "SUSPENDED") {
    const activeAdmins = await prisma.user.count({
      where: { isPlatformAdmin: true, status: "ACTIVE" },
    });
    if (activeAdmins <= 1) return;
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { status: nextStatus as "ACTIVE" | "SUSPENDED" },
  });
  await writeAudit({
    practiceId: target.practiceId,
    actor: admin,
    action: nextStatus === "ACTIVE" ? "platform.user_reactivated" : "platform.user_suspended",
    entityType: "user",
    entityId: target.id,
    entityLabel: target.email,
    changes: { status: { from: target.status, to: nextStatus } },
  });
  revalidatePath("/admin");
}

/**
 * Turns safe mode on or off for the practice.
 *
 * Owner only, and separate from `updatePracticeSettings` on purpose: bundling a
 * privacy control into the same submit as a phone number means it gets changed
 * by somebody who came to edit the phone number, and the audit row would not be
 * able to tell you which of the two they meant to do.
 *
 * Both directions are audited, and turning it *off* is the one worth finding
 * later — it is the moment a practice decided its screens and exports could
 * start carrying names again.
 */
export async function setSafeMode(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const owner = await requireRole(["OWNER"]);
  const wanted = formData.get("safeMode") === "on";

  const previous = await prisma.practice.findUnique({
    where: { id: owner.practiceId },
    select: { safeMode: true },
  });
  if (previous?.safeMode === wanted) return { success: "No change." };

  await prisma.practice.update({
    where: { id: owner.practiceId },
    data: { safeMode: wanted },
  });

  await writeAudit({
    practiceId: owner.practiceId,
    actor: owner,
    action: wanted ? "practice.safe_mode.on" : "practice.safe_mode.off",
    entityType: "practice",
    entityId: owner.practiceId,
    changes: {
      safeMode: { from: previous?.safeMode ? "on" : "off", to: wanted ? "on" : "off" },
    },
  });

  revalidatePath("/s/settings");
  return { success: wanted ? "Safe mode is on." : "Safe mode is off." };
}
