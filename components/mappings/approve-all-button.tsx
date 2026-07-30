"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveAllSuggestedMappings,
  previewBulkApproval,
  type BulkApprovalPreview,
} from "@/lib/mappings/actions";
import { mappingTypeLabel } from "@/lib/ui/labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The bulk-approval path — the primary route for a professor who does not
 * want to drive the split-screen studio thirty times. The studio stays for
 * the edge cases it is good at (one odd pairing, a version bump).
 *
 * TWO STEPS, ALWAYS. Approval is not a reversible toggle: migration 0011's
 * immutability triggers freeze an approved mapping's members for every
 * role, service_role included, and the only way back is a new version. So
 * this never approves straight from a click — it shows exactly which
 * mappings are about to become live, which ones it is leaving alone and
 * why, and waits for a second, explicit confirmation.
 */
export function ApproveAllButton({ classId }: { classId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BulkApprovalPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPreview() {
    setLoading(true);
    setError(null);
    setPreview(null);
    setOpen(true);
    const result = await previewBulkApproval(classId);
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setPreview(result.data);
  }

  async function confirm() {
    setBusy(true);
    const result = await approveAllSuggestedMappings(classId);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }

    const { approved, failures } = result.data;
    if (failures.length > 0) {
      // Partial success is reported as partial success — never as done.
      toast.error(
        `Approved ${approved}. ${failures.length} could not be approved: ${failures
          .map((f) => f.name)
          .join(", ")}`
      );
      setError(
        failures.map((f) => `${f.name}: ${f.reason}`).join("\n")
      );
      router.refresh();
      return;
    }

    toast.success(
      approved === 0
        ? "Nothing to approve — every eligible mapping is already approved."
        : `Approved ${approved} mapping${approved === 1 ? "" : "s"}. They are now live in analytics.`
    );
    setOpen(false);
    router.refresh();
  }

  const candidates = preview?.candidates ?? [];

  return (
    <>
      <Button type="button" variant="default" onClick={openPreview}>
        Approve all suggested mappings
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Approve all suggested mappings</DialogTitle>
            <DialogDescription>
              Approved mappings become the data analytics runs on. Approval also locks a
              mapping&apos;s questions — changing one afterwards means creating a new version, so
              please check this list before confirming.
            </DialogDescription>
          </DialogHeader>

          {loading && <p className="text-sm text-muted-foreground">Checking mappings…</p>}

          {error && (
            <p role="alert" className="banner banner-critical whitespace-pre-wrap">
              {error}
            </p>
          )}

          {preview && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">
                  {candidates.length === 0
                    ? "No mappings are waiting for approval."
                    : `${candidates.length} mapping${candidates.length === 1 ? "" : "s"} will be approved:`}
                </p>
                {candidates.length > 0 && (
                  <div className="table-frame mt-2 max-h-60 overflow-y-auto">
                    <table className="data-table data-table--dense">
                      <thead className="sticky top-0">
                        <tr>
                          <th scope="col">Mapping</th>
                          <th scope="col">Type</th>
                          <th scope="col">Energy source</th>
                          <th scope="col">Version</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((c) => (
                          <tr key={c.id}>
                            <td>{c.name}</td>
                            <td>{mappingTypeLabel(c.type)}</td>
                            <td>{c.energySource ?? "—"}</td>
                            <td className="tabular-nums">v{c.version}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {preview.alreadyApproved > 0 && (
                <p className="text-xs text-muted-foreground">
                  {preview.alreadyApproved} mapping
                  {preview.alreadyApproved === 1 ? " is" : "s are"} already approved and will not be
                  touched.
                </p>
              )}

              {preview.excluded.length > 0 && (
                <details className="rounded border border-hairline px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-ink-secondary">
                    {preview.excluded.length} suggested mapping
                    {preview.excluded.length === 1 ? "" : "s"} deliberately left out
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {preview.excluded.map((e) => (
                      <li key={e.name}>
                        <span className="font-medium">{e.name}</span> ({mappingTypeLabel(e.type)}) —{" "}
                        {e.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    These stay available in the studio if you want to approve one individually.
                  </p>
                </details>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirm}
              disabled={busy || loading || candidates.length === 0}
            >
              {busy
                ? "Approving…"
                : `Approve ${candidates.length} mapping${candidates.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
