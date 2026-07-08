"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepUpDialog } from "@/components/step-up-dialog";
import { ApiError, STEP_UP_REQUIRED_ERROR, updateSecuritySettings } from "@/lib/client/api";

/**
 * Toggle for the opt-in "require a fresh signature before changes" setting.
 * Turning it ON is a plain request; turning it OFF while active triggers
 * the step-up dialog (server enforces this too - a hijacked session can't
 * quietly disable the protection).
 */
export function SecuritySettings({
  namespace,
  address,
  initialEnabled,
}: {
  namespace: string;
  address: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  async function apply(next: boolean) {
    setSaving(true);
    try {
      await updateSecuritySettings(namespace, next);
      setEnabled(next);
      toast.success(next ? "Signed writes required" : "Signed writes disabled");
    } catch (err) {
      if (err instanceof ApiError && err.message === STEP_UP_REQUIRED_ERROR) {
        // Disabling needs a fresh signature - open the dialog, then retry.
        setStepUpOpen(true);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Failed to update setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium">Require a fresh signature before changes</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          When on, editing DNS records asks you to re-sign a challenge with your wallet
          (valid for 10 minutes). Protects against someone using a session left open on a
          shared computer - they&apos;d have the session but not your wallet.
        </p>
      </div>
      <Button
        variant={enabled ? "outline" : "default"}
        disabled={saving}
        onClick={() => apply(!enabled)}
        className="shrink-0"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {enabled ? "Turn off" : "Turn on"}
      </Button>

      <StepUpDialog
        namespace={namespace}
        address={address}
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        onConfirmed={() => apply(false)}
        title="Confirm to turn off"
        description="Turning off signed writes requires a fresh signature, so a session left open elsewhere can't disable it. Sign to continue."
      />
    </div>
  );
}
