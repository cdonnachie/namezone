"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
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
      await verifyChallenge(namespace, address.trim(), message, signature.trim());
      toast.success("Ownership verified");
      router.push(`/${namespace}/dashboard`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
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
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
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
