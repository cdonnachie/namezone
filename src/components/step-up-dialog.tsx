"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, requestChallenge, stepUp } from "@/lib/client/api";
import { buildPhotonicConnectUrl } from "@/lib/ownership/radiant/connect-link";

/**
 * "Confirm with your wallet" step-up dialog. Runs the same challenge/sign
 * flow as sign-in, but calls /auth/step-up to mint the short-lived step-up
 * cookie rather than a session. Shared by the security settings toggle and
 * by DNS writes that come back STEP_UP_REQUIRED. On success it calls
 * onConfirmed(), which the caller uses to retry whatever it was doing.
 */
export function StepUpDialog({
  namespace,
  address,
  open,
  onOpenChange,
  onConfirmed,
  title = "Confirm with your wallet",
  description = "This address requires a fresh signature before changes. Sign the challenge below to continue.",
}: {
  namespace: string;
  address: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => void;
  title?: string;
  description?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const [loading, setLoading] = useState<"challenge" | "confirm" | null>(null);

  function reset() {
    setMessage(null);
    setSignature("");
    setLoading(null);
  }

  async function handleChallenge() {
    setLoading("challenge");
    try {
      const res = await requestChallenge(namespace, address);
      setMessage(res.message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to generate challenge.");
    } finally {
      setLoading(null);
    }
  }

  async function handleConfirm() {
    if (!message) return;
    setLoading("confirm");
    try {
      await stepUp(namespace, address, message, signature.trim());
      toast.success("Confirmed");
      onOpenChange(false);
      reset();
      onConfirmed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Confirmation failed.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {!message ? (
          <Button onClick={handleChallenge} disabled={loading === "challenge"}>
            {loading === "challenge" && <Loader2 className="size-4 animate-spin" />}
            Generate challenge
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Challenge message</Label>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                {message}
              </pre>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Sign this exact message with the signed-in address, then paste the signature below.
              </p>
              {namespace === "radiant" && (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <a
                    href={buildPhotonicConnectUrl({
                      challenge: message,
                      address,
                      origin: window.location.origin,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Photonic wallet <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="step-up-signature">Signature</Label>
              <Input
                id="step-up-signature"
                placeholder="Base64 signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {message && (
            <Button
              className="w-full"
              onClick={handleConfirm}
              disabled={!signature.trim() || loading === "confirm"}
            >
              {loading === "confirm" && <Loader2 className="size-4 animate-spin" />}
              Confirm
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
