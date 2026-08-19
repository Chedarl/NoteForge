"use client";

import { useActionState } from "react";
import { reissueFieldLink, withdrawFieldLink, type AgentState } from "@/lib/field/manage";
import ShareFieldLink from "@/components/shared/ShareFieldLink";
import { Pill } from "@/components/shared/ui";

/**
 * The workers you have given a link to, and the way to send them one.
 *
 * ## Why the list is one client component instead of a form per row
 *
 * The first version put the reissue button and its result panel inside each
 * row. Server-side it worked exactly as intended — old link revoked, new one
 * minted — and the clinician never saw the result, because a server action
 * re-renders the route it was called from, and the row is keyed by the link id
 * that had just been revoked. The component holding the freshly minted token
 * unmounted before it could paint. The only copy of a credential that cannot be
 * recovered was thrown away by the button whose entire purpose was to hand it
 * over, and the worker was locked out with nothing on screen to say so.
 *
 * Hoisting the action state to the list fixes it because *this* component's
 * position in the tree does not change when a row does. Rows are data;
 * the panel is state, and state has to live somewhere that survives the rows
 * changing underneath it.
 *
 * The panel is rendered above the list rather than in place, so it cannot be
 * scrolled past on a phone.
 */

export interface FieldWorkerRow {
  linkId: string;
  name: string;
  kind: string;
  revoked: boolean;
  useCount: number;
}

export default function FieldWorkerList({
  rows,
  clinicianName,
  /** False when links would be built from a localhost fallback. */
  linksReachable,
}: {
  rows: FieldWorkerRow[];
  clinicianName: string;
  linksReachable: boolean;
}) {
  const [reissue, reissueAction, reissuing] = useActionState<AgentState, FormData>(
    reissueFieldLink,
    {}
  );
  const [withdraw, withdrawAction, withdrawing] = useActionState<AgentState, FormData>(
    withdrawFieldLink,
    {}
  );

  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 font-semibold">Links you have given out</h2>

      {reissue.created ? (
        <div className="mb-3 rounded-lg border border-teal-300 bg-teal-50 p-3.5">
          <p className="text-sm font-semibold text-teal-900">
            {reissue.created.name}&rsquo;s new link is ready
          </p>
          <p className="mt-1 mb-2.5 text-xs leading-relaxed text-teal-800">
            Their previous link stopped working the moment this was made. Send this one now —
            it is the only time it can be shown. The list below catches up when you next open
            this page.
          </p>
          <ShareFieldLink
            workerName={reissue.created.name}
            url={reissue.created.url}
            clinicianName={clinicianName}
            linksReachable={linksReachable}
          />
        </div>
      ) : null}

      {reissue.error ? (
        <p role="alert" className="mb-2 text-sm text-rose-700">
          {reissue.error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="divide-y divide-slate-100">
          {rows.map((row) => (
            <div
              key={row.linkId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            >
              <span className="font-medium text-slate-900">{row.name}</span>
              <span className="text-sm text-slate-500">{row.kind}</span>
              {row.revoked ? (
                <Pill tone="rose">Withdrawn</Pill>
              ) : (
                <Pill tone="emerald">Active</Pill>
              )}
              <span className="text-xs text-slate-500">
                {row.useCount === 0
                  ? "not used yet"
                  : `${row.useCount} update${row.useCount === 1 ? "" : "s"} sent`}
              </span>

              {row.revoked ? null : (
                <span className="ml-auto flex items-center gap-3">
                  {/*
                    The row used to end at "Withdraw". A clinician who had
                    navigated away from the screen that minted the link could
                    see that a worker had one and had no way at all to send it
                    to them — which is the only thing a link is for.
                  */}
                  <form action={reissueAction} className="inline">
                    <input type="hidden" name="linkId" value={row.linkId} />
                    <button
                      type="submit"
                      disabled={reissuing || withdrawing}
                      className="text-xs font-semibold text-teal-800 underline underline-offset-2 disabled:opacity-50"
                      title={
                        row.useCount > 0
                          ? `Issues ${row.name} a new link. The one they are using now stops working.`
                          : `Issues ${row.name} a new link. The old one has never been used.`
                      }
                    >
                      {reissuing ? "Preparing…" : "Send them their link"}
                    </button>
                  </form>

                  <form action={withdrawAction} className="inline">
                    <input type="hidden" name="linkId" value={row.linkId} />
                    <button
                      type="submit"
                      disabled={reissuing || withdrawing}
                      className="text-xs font-semibold text-rose-700 underline underline-offset-2 disabled:opacity-50"
                      aria-label={`Withdraw ${row.name}'s link`}
                    >
                      {withdrawing ? "Withdrawing…" : "Withdraw"}
                    </button>
                  </form>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {withdraw.error ? (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {withdraw.error}
        </p>
      ) : null}

      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Sending a worker their link issues a new one and retires the old — the link itself is
        stored only as a fingerprint, so it can never be read back, only replaced. Withdrawing
        stops a link immediately and affects nobody else. Everything that person already sent
        stays exactly where it is.
      </p>
    </section>
  );
}
