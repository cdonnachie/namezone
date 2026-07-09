"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Copy, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/info-tooltip";
import { StepUpProvider, useStepUp } from "@/components/step-up-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  createAcmeChallenge,
  createOrUpdateRecord,
  deleteAcmeChallenge,
  deleteRecord,
  type EditableRecordType,
  type DnsRecordDto,
} from "@/lib/client/api";
import {
  isAcmeChallengeHost,
  validateAcmeTxtValue,
  validateCnameTarget,
  validateRecordValue,
  validateRelativeHost,
} from "@/lib/dns/validation";
import { validateEmailTxtValue, validateMxValue } from "@/lib/dns/email";
import {
  ACME_TXT_DEFAULT_EXPIRY_HOURS,
  MAX_ACME_TXT_RECORDS,
  MAX_HOSTNAMES_PER_NAME,
} from "@/lib/dns/constants";
import { formatRelativeTime } from "@/lib/utils";

const EXAMPLES = [
  { host: "@", desc: "apex" },
  { host: "www", desc: "www subdomain" },
  { host: "test", desc: "test subdomain" },
  { host: "api", desc: "api subdomain" },
];

const EXPIRY_OPTIONS = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
];

function CopyInline({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      aria-label={`Copy ${value}`}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

type DeleteTarget =
  | { kind: "basic"; record: DnsRecordDto }
  | { kind: "acme"; record: DnsRecordDto };

export function DnsManager({
  namespace,
  address,
  name,
  zone,
  emailEnabled,
  initialRecords,
}: {
  namespace: string;
  address: string;
  name: string;
  zone: string;
  emailEnabled: boolean;
  initialRecords: DnsRecordDto[];
}) {
  return (
    <StepUpProvider namespace={namespace} address={address}>
      <DnsManagerInner
        namespace={namespace}
        name={name}
        zone={zone}
        emailEnabled={emailEnabled}
        initialRecords={initialRecords}
      />
    </StepUpProvider>
  );
}

function DnsManagerInner({
  namespace,
  name,
  zone,
  emailEnabled,
  initialRecords,
}: {
  namespace: string;
  name: string;
  zone: string;
  emailEnabled: boolean;
  initialRecords: DnsRecordDto[];
}) {
  const runWithStepUp = useStepUp();
  // `zone` is the absolute FQDN (trailing dot) used internally; show and copy
  // the browser-friendly form without it.
  const displayZone = zone.replace(/\.$/, "");
  const [records, setRecords] = useState<DnsRecordDto[]>(initialRecords);
  const [addOpen, setAddOpen] = useState(false);
  const [acmeOpen, setAcmeOpen] = useState(false);
  const [editing, setEditing] = useState<DnsRecordDto | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

  const basicRecords = records.filter((r) => !r.isAcmeChallenge);
  const acmeRecords = records.filter((r) => r.isAcmeChallenge);

  const distinctHostCount = new Set(basicRecords.map((r) => r.relativeHost)).size;
  const atHostCapacity = distinctHostCount >= MAX_HOSTNAMES_PER_NAME;
  const atAcmeCapacity = acmeRecords.length >= MAX_ACME_TXT_RECORDS;

  // Match by id, not (fqdn, type, value): multiple values coexist at one
  // fqdn+type now (several A/MX/TXT), and an edit that changes a CNAME's value
  // returns the same row id from the server - so id is the only stable key.
  function upsertLocal(record: DnsRecordDto) {
    setRecords((prev) => {
      const idx = prev.findIndex((r) => r.id === record.id);
      if (idx === -1) return [...prev, record];
      const next = [...prev];
      next[idx] = record;
      return next;
    });
  }

  function removeLocal(record: DnsRecordDto) {
    setRecords((prev) => prev.filter((r) => r.id !== record.id));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* min-w-0 lets this side shrink instead of pushing the action
              buttons out of the card; flex-wrap + break-all let long names
              (labels can be up to 63 chars) wrap onto extra lines. */}
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
              <span className="break-all font-mono">{name}</span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="break-all font-mono text-primary">{displayZone}</span>
              <CopyInline value={displayZone} />
            </CardTitle>
            <CardDescription className="mt-1">
              {distinctHostCount}/{MAX_HOSTNAMES_PER_NAME} hostnames &middot; {acmeRecords.length}/
              {MAX_ACME_TXT_RECORDS} active SSL challenges
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            <Dialog
              open={acmeOpen}
              onOpenChange={setAcmeOpen}
            >
              <DialogTrigger asChild>
                <Button variant="outline" disabled={atAcmeCapacity}>
                  <ShieldCheck className="size-4" /> Add SSL Challenge
                </Button>
              </DialogTrigger>
              <AcmeDialogContent
                namespace={namespace}
                name={name}
                zone={zone}
                onSaved={(record) => {
                  upsertLocal(record);
                  setAcmeOpen(false);
                }}
              />
            </Dialog>
            <Dialog
              open={addOpen}
              onOpenChange={(open) => {
                setAddOpen(open);
                if (!open) setEditing(null);
              }}
            >
              <DialogTrigger asChild>
                <Button disabled={atHostCapacity}>
                  <Plus className="size-4" /> Add Record
                </Button>
              </DialogTrigger>
              <RecordDialogContent
                key={editing?.id ?? "new"}
                namespace={namespace}
                name={name}
                zone={zone}
                emailEnabled={emailEnabled}
                existing={editing}
                onSaved={(record) => {
                  upsertLocal(record);
                  setAddOpen(false);
                  setEditing(null);
                }}
              />
            </Dialog>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">DNS records</CardTitle>
          <CardDescription>
            Hostname examples: {EXAMPLES.map((e) => e.host).join(", ")} &mdash; relative to{" "}
            <span className="font-mono">{zone}</span>. A hostname holds either a single CNAME or a
            mix of the other types, never a CNAME alongside others.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {basicRecords.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No DNS records yet. Add your first A, AAAA, or CNAME record above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hostname</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>TTL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {basicRecords.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">
                      <span className="inline-flex items-center gap-1.5">
                        {r.relativeHost}
                        {/* A/AAAA/CNAME resolve to a name a user can point at,
                            so offer a one-click copy of the full FQDN. */}
                        {(r.type === "A" || r.type === "AAAA" || r.type === "CNAME") && (
                          <CopyInline value={r.fqdn.replace(/\.$/, "")} />
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">{r.value}</TableCell>
                    <TableCell className="text-muted-foreground">{r.ttl}s</TableCell>
                    <TableCell>
                      <Badge className="bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/15">
                        Synced
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Only CNAME is single-value/editable. A/AAAA, MX and
                          TXT are multi-value per hostname, so they're add/delete
                          (change by removing and re-adding), like ACME. */}
                      {r.type === "CNAME" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(r);
                            setAddOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting({ kind: "basic", record: r })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            SSL challenges (ACME)
            <InfoTooltip>
              A TXT record proving to a certificate authority (e.g. Let&apos;s Encrypt via
              Certbot) that you control this domain, so it can issue you a free SSL certificate.
            </InfoTooltip>
          </CardTitle>
          <CardDescription>
            Temporary <code className="font-mono">_acme-challenge.*</code> TXT records for
            Certbot/ACME DNS-01 validation. Each auto-expires and is removed automatically.{" "}
            <Link href={`/${namespace}/help`} className="underline underline-offset-2 hover:text-foreground">
              What&apos;s this?
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {acmeRecords.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No active SSL challenges.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hostname</TableHead>
                  <TableHead>TXT value</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {acmeRecords.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.relativeHost}</TableCell>
                    <TableCell className="max-w-55 truncate font-mono" title={r.value}>
                      {r.value}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.expiresAt ? formatRelativeTime(r.expiresAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting({ kind: "acme", record: r })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete DNS record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the {deleting?.record.type} record for{" "}
              <span className="font-mono">{deleting?.record.fqdn}</span> from PowerDNS. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await runWithStepUp(() => {
                    if (deleting.kind === "basic") {
                      return deleteRecord(namespace, name, {
                        hostname: deleting.record.relativeHost,
                        type: deleting.record.type as EditableRecordType,
                        // Multi-value rrsets (MX, email TXT) need the value to
                        // pick which one; harmless for single-value types.
                        value: deleting.record.value,
                      });
                    }
                    // ACME relativeHost is stored as "_acme-challenge[.host]" -
                    // the API expects the target service host, so strip the prefix.
                    const targetHost = deleting.record.relativeHost.replace(/^_acme-challenge\.?/, "") || "@";
                    return deleteAcmeChallenge(namespace, name, {
                      hostname: targetHost,
                      value: deleting.record.value,
                    });
                  });
                  removeLocal(deleting.record);
                  toast.success("DNS record deleted and synced");
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : "Failed to delete record.");
                } finally {
                  setDeleting(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const VALUE_PLACEHOLDER: Record<EditableRecordType, string> = {
  A: "203.0.113.20",
  AAAA: "2001:db8::1",
  CNAME: "craigd.github.io.",
  MX: "10 mail.example.com",
  TXT: "v=spf1 include:example.com -all",
};

function RecordDialogContent({
  namespace,
  name,
  zone,
  emailEnabled,
  existing,
  onSaved,
}: {
  namespace: string;
  name: string;
  zone: string;
  emailEnabled: boolean;
  existing: DnsRecordDto | null;
  onSaved: (record: DnsRecordDto) => void;
}) {
  const runWithStepUp = useStepUp();
  const [hostname, setHostname] = useState(existing?.relativeHost ?? "");
  const [type, setType] = useState<EditableRecordType>((existing?.type as EditableRecordType) ?? "A");
  const [value, setValue] = useState(existing?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nsShape = { tld: zone.split(".")[0], dnsZone: zone.replace(/\.$/, "") };
  const zoneBase = zone.replace(/\.$/, ""); // e.g. "craigd.rxd.zone"
  const parentZone = zoneBase.split(".").slice(1).join("."); // e.g. "rxd.zone"
  const tld = parentZone.split(".")[0]; // e.g. "rxd"

  const previewFqdn = useMemo(() => {
    const host = hostname.trim().toLowerCase();
    if (!host) return zone;
    return host === "@" ? zone : `${host}.${zone}`;
  }, [hostname, zone]);

  // People sometimes type the whole domain (e.g. "www.rxd.zone") here, expecting
  // it to BE the final name - but the hostname is relative and gets your zone
  // appended, so that becomes "www.rxd.zone.craigd.rxd.zone.". Nudge them.
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, "");
  const looksLikeFullDomain =
    normalizedHost !== "" &&
    normalizedHost !== "@" &&
    (normalizedHost.endsWith(".zone") || normalizedHost.endsWith(`.${tld}`) || normalizedHost.includes(parentZone));

  async function handleSave() {
    setError(null);
    const hostResult = validateRelativeHost(hostname, { allowEmailLabels: emailEnabled });
    if (!hostResult.ok) {
      setError(hostResult.error);
      return;
    }
    if (isAcmeChallengeHost(hostResult.value)) {
      setError('Use "Add SSL Challenge" for _acme-challenge records.');
      return;
    }
    // Client-side preview validation; the server re-validates authoritatively.
    let outValue: string;
    if (type === "CNAME") {
      const r = validateCnameTarget(value, previewFqdn, name, nsShape);
      if (!r.ok) return setError(r.error);
      outValue = r.value;
    } else if (type === "MX") {
      const r = validateMxValue(value, name, nsShape);
      if (!r.ok) return setError(r.error);
      outValue = r.value.content;
    } else if (type === "TXT") {
      const r = validateEmailTxtValue(hostResult.value, value);
      if (!r.ok) return setError(r.error);
      outValue = r.value;
    } else {
      const r = validateRecordValue(type, value);
      if (!r.ok) return setError(r.error);
      outValue = r.value;
    }

    setSaving(true);
    try {
      const { record } = await runWithStepUp(() =>
        createOrUpdateRecord(namespace, name, {
          hostname: hostResult.value,
          type,
          value: outValue,
        }),
      );
      toast.success("DNS record saved and synced to PowerDNS");
      onSaved(record);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{existing ? "Edit DNS record" : "Add DNS record"}</DialogTitle>
        <DialogDescription>
          Records use a fixed TTL of 300 seconds. A hostname can have a single CNAME or any mix
          of A/AAAA{emailEnabled ? "/MX/TXT" : ""}, never a CNAME alongside others.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="hostname">Hostname</Label>
          <Input
            id="hostname"
            placeholder={emailEnabled ? "@, www, _dmarc, sel._domainkey" : "@, www, test, api"}
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            disabled={!!existing}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Just the part before your domain (e.g. <span className="font-mono">www</span>), or{" "}
            <span className="font-mono">@</span> for the domain itself. Your name is added
            automatically:
          </p>
          <p className="font-mono text-xs text-muted-foreground">{previewFqdn}</p>
          {looksLikeFullDomain && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Looks like you included your domain. You don&apos;t need to &mdash; enter just{" "}
              <span className="font-mono">www</span> (not{" "}
              <span className="font-mono">www.{parentZone}</span>), or{" "}
              <span className="font-mono">@</span> for <span className="font-mono">{zoneBase}</span>{" "}
              itself.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            Record type
            <InfoTooltip>
              A points a hostname at an IPv4 address, AAAA at an IPv6 address, and CNAME points
              it at another hostname instead (e.g. your GitHub Pages/Vercel/Netlify URL).
              {emailEnabled
                ? " MX routes email to a mail server; TXT here carries SPF (plain host), DKIM (under _domainkey) or DMARC (under _dmarc)."
                : ""}{" "}
              A hostname can have one CNAME or a mix of the others, never both.
            </InfoTooltip>
          </Label>
          <Select value={type} onValueChange={(v) => setType(v as EditableRecordType)} disabled={!!existing}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A">A (IPv4)</SelectItem>
              <SelectItem value="AAAA">AAAA (IPv6)</SelectItem>
              <SelectItem value="CNAME">CNAME (alias)</SelectItem>
              {emailEnabled && <SelectItem value="MX">MX (mail server)</SelectItem>}
              {emailEnabled && <SelectItem value="TXT">TXT (SPF / DKIM / DMARC)</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="value">
            {type === "CNAME" ? "Target hostname" : type === "MX" ? "Priority and mail host" : "Value"}
          </Label>
          <Input
            id="value"
            placeholder={VALUE_PLACEHOLDER[type]}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono"
          />
          {type === "CNAME" && (
            <p className="text-xs text-muted-foreground">
              Must be a hostname, not an IP (e.g. GitHub Pages, Vercel, Netlify targets).
            </p>
          )}
          {type === "MX" && (
            <p className="text-xs text-muted-foreground">
              Format: priority then mail host, e.g. <span className="font-mono">10 mail.example.com</span>.
            </p>
          )}
          {type === "TXT" && (
            <p className="text-xs text-muted-foreground">
              At a normal host: SPF or your provider&apos;s verification record (e.g.{" "}
              <span className="font-mono">hosted-email-verify=…</span>). DMARC under{" "}
              <span className="font-mono">_dmarc</span>, DKIM under{" "}
              <span className="font-mono">&lt;selector&gt;._domainkey</span>.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>TTL</Label>
          <Input value="300 (fixed)" disabled />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AcmeDialogContent({
  namespace,
  name,
  zone,
  onSaved,
}: {
  namespace: string;
  name: string;
  zone: string;
  onSaved: (record: DnsRecordDto) => void;
}) {
  const runWithStepUp = useStepUp();
  const [hostname, setHostname] = useState("@");
  const [value, setValue] = useState("");
  const [expiryHours, setExpiryHours] = useState(ACME_TXT_DEFAULT_EXPIRY_HOURS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewFqdn = useMemo(() => {
    const host = hostname.trim().toLowerCase();
    const base = host === "@" || !host ? zone : `${host}.${zone}`;
    return `_acme-challenge.${base}`;
  }, [hostname, zone]);

  async function handleSave() {
    setError(null);
    const hostResult = validateRelativeHost(hostname);
    if (!hostResult.ok) {
      setError(hostResult.error);
      return;
    }
    if (isAcmeChallengeHost(hostResult.value)) {
      setError("Enter the target hostname (e.g. \"www\"), not the _acme-challenge name.");
      return;
    }
    const valueResult = validateAcmeTxtValue(value);
    if (!valueResult.ok) {
      setError(valueResult.error);
      return;
    }

    setSaving(true);
    try {
      const { record } = await runWithStepUp(() =>
        createAcmeChallenge(namespace, name, {
          hostname: hostResult.value,
          value: valueResult.value,
          expiryHours,
        }),
      );
      toast.success("SSL challenge record created and synced to PowerDNS");
      onSaved(record);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create SSL challenge.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add SSL challenge</DialogTitle>
        <DialogDescription>
          Creates a temporary TXT record under <code className="font-mono">_acme-challenge.*</code>{" "}
          for Certbot/ACME DNS-01 validation. It expires and is removed automatically.{" "}
          <Link href={`/${namespace}/help`} className="underline underline-offset-2 hover:text-foreground">
            What&apos;s this?
          </Link>
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="acme-hostname">Hostname</Label>
          <Input
            id="acme-hostname"
            placeholder="@, www, test, api"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            className="font-mono"
          />
          <p className="font-mono text-xs text-muted-foreground">{previewFqdn}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="acme-value">TXT value</Label>
          <Input
            id="acme-value"
            placeholder="Challenge token from your ACME client"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label>Expires</Label>
          <Select
            value={String(expiryHours)}
            onValueChange={(v) => setExpiryHours(Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((opt) => (
                <SelectItem key={opt.hours} value={String(opt.hours)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving && <Loader2 className="size-4 animate-spin" />}
          Create challenge
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
