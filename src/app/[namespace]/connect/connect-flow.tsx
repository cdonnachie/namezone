"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { requestChallenge, verifyChallenge, ApiError } from "@/lib/client/api";
import { buildPhotonicConnectUrl } from "@/lib/ownership/radiant/connect-link";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="Copy"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

export function ConnectFlow({
  namespace,
  chainName,
  addressPlaceholder,
}: {
  namespace: string;
  chainName: string;
  addressPlaceholder: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <ManualVerification namespace={namespace} chainName={chainName} addressPlaceholder={addressPlaceholder} />
      </CardContent>
    </Card>
  );
}

function ManualVerification({
  namespace,
  chainName,
  addressPlaceholder,
}: {
  namespace: string;
  chainName: string;
  addressPlaceholder: string;
}) {
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const [sharedComputer, setSharedComputer] = useState(false);
  const [loading, setLoading] = useState<"challenge" | "verify" | null>(null);

  async function handleRequestChallenge() {
    setLoading("challenge");
    try {
      const res = await requestChallenge(namespace, address.trim());
      setMessage(res.message);
      toast.success(`Challenge generated. Sign it with your ${chainName} wallet.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to generate challenge.");
    } finally {
      setLoading(null);
    }
  }

  async function handleVerify() {
    if (!message) return;
    setLoading("verify");
    try {
      await verifyChallenge(namespace, address.trim(), message, signature.trim(), { sharedComputer });
      toast.success("Ownership verified");
      // Full navigation, deliberately not router.push() + router.refresh():
      // refresh() can cancel the in-flight push (seen on mobile, where the
      // slower RSC fetch loses the race), stranding the user on this page
      // despite being logged in. A hard navigation can't be cancelled and
      // also re-renders the nav bar with the new session state, which is
      // what the refresh() was for.
      window.location.assign(`/${namespace}/dashboard`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Verification failed.");
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="address">{chainName} address</Label>
        <Input
          id="address"
          placeholder={addressPlaceholder}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={!!message}
          className="font-mono"
        />
      </div>

      {!message ? (
        <Button
          className="w-full"
          onClick={handleRequestChallenge}
          disabled={!address.trim() || loading === "challenge"}
        >
          {loading === "challenge" && <Loader2 className="size-4 animate-spin" />}
          Generate Login Challenge
        </Button>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Challenge message</Label>
              <CopyButton value={message} />
            </div>
            <pre className="whitespace-pre-wrap wrap-break-word rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
              {message}
            </pre>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              Sign this exact message using your {chainName} wallet&apos;s &quot;Sign
              Message&quot; tool with the address above, then paste the resulting signature
              below.
            </p>
            {namespace === "radiant" && (
              <Button asChild variant="outline" size="sm" className="w-full">
                <a
                  href={buildPhotonicConnectUrl({
                    challenge: message,
                    address: address.trim(),
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
            <Label htmlFor="signature">Signature</Label>
            <Input
              id="signature"
              placeholder="Base64 signature"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              className="font-mono"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={sharedComputer}
              onChange={(e) => setSharedComputer(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              This is a shared or public computer
              <span className="block text-xs text-muted-foreground">
                Sign me out after 30 minutes and when the browser closes, instead of the usual 12
                hours.
              </span>
            </span>
          </label>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMessage(null);
                setSignature("");
              }}
            >
              Back
            </Button>
            <Button className="flex-1" onClick={handleVerify} disabled={!signature.trim() || loading === "verify"}>
              {loading === "verify" && <Loader2 className="size-4 animate-spin" />}
              Verify & Sign In
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
