"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BookOpen,
  Check,
  Copy,
  Globe,
  History,
  Loader2,
  Plus,
  Radar,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  fetchAuditLogs,
  verifyAllRecordsPropagation,
  verifyRecordPropagation,
  type AuditLogDto,
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

// GitHub Pages apex hosting: the four A + four AAAA addresses GitHub publishes
// for a custom apex domain. https://docs.github.com/pages/configuring-a-custom-domain
const GITHUB_PAGES_RECORDS: { type: "A" | "AAAA"; value: string }[] = [
  { type: "A", value: "185.199.108.153" },
  { type: "A", value: "185.199.109.153" },
  { type: "A", value: "185.199.110.153" },
  { type: "A", value: "185.199.111.153" },
  { type: "AAAA", value: "2606:50c0:8000::153" },
  { type: "AAAA", value: "2606:50c0:8001::153" },
  { type: "AAAA", value: "2606:50c0:8002::153" },
  { type: "AAAA", value: "2606:50c0:8003::153" },
];

// Plain-language, novice-facing explanation for each record type, shown under
// the type picker so people choose by goal rather than by acronym.
const TYPE_EXPLANATIONS: Record<EditableRecordType, string> = {
  A: "Points this hostname at a server's IPv4 address - use this for your own server or VPS.",
  AAAA: "Same as A, but for a server's IPv6 address.",
  CNAME:
    "Makes this hostname an alias of another domain - use for GitHub Pages, Vercel, Netlify and similar hosts.",
  MX: "Tells the internet where to deliver email for this domain.",
  TXT: "Text records for email setup and ownership verification (SPF, DKIM, DMARC, provider tokens).",
};

// Records use a fixed 300s TTL; set expectations after every write so people
// don't read "Synced" as "the whole internet sees it already".
const PROPAGATION_NOTE =
  "Live on our nameservers now. The wider internet can take up to ~5 minutes (the record's TTL) to notice.";

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

/** Result of a public-visibility check for one record; "checking" while in flight. */
type CheckState = "checking" | { visible: boolean; matched: boolean; answers: string[] };

/**
 * Status cell for a record row: the "Synced" badge (written to our PowerDNS)
 * until a public-visibility check has run, then the check's outcome - the
 * question novices actually mean when they ask "is it working?". Hovering a
 * result badge shows exactly what the public resolver answered. Check state
 * lives in the parent so "Check all" can drive every row at once.
 */
function PropagationStatus({ state, onCheck }: { state: CheckState | undefined; onCheck: () => void }) {
  const done = state !== undefined && state !== "checking" ? state : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {done ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {done.matched ? (
              <Badge className="cursor-default bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/15">
                Public
              </Badge>
            ) : (
              <Badge className="cursor-default bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15">
                {done.visible ? "Mismatch" : "Propagating"}
              </Badge>
            )}
          </TooltipTrigger>
          <TooltipContent className="max-w-80 text-wrap text-left">
            {done.matched ? (
              <p>A public resolver sees this exact value.</p>
            ) : done.visible ? (
              <p>
                The public resolver is showing a different value &mdash; old values can stay cached
                for up to ~5 minutes (the TTL).
              </p>
            ) : (
              <p>
                No public answer for this record yet &mdash; new records typically appear within a
                few minutes.
              </p>
            )}
            {done.answers.length > 0 && (
              <p className="mt-1.5 font-mono text-xs">
                Resolver answered: {done.answers.join(", ")}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Badge className="bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/15">
          Synced
        </Badge>
      )}
      <button
        type="button"
        className="inline-flex items-center text-muted-foreground hover:text-foreground disabled:opacity-50"
        onClick={onCheck}
        disabled={state === "checking"}
        title="Check whether the wider internet can see this record yet"
        aria-label="Check public visibility"
      >
        {state === "checking" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Radar className="size-3.5" />
        )}
      </button>
    </span>
  );
}

const AUDIT_ACTION_LABELS: Record<AuditLogDto["action"], { label: string; className: string }> = {
  CREATE: {
    label: "Added",
    className: "bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/15",
  },
  UPDATE: {
    label: "Updated",
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/15",
  },
  DELETE: {
    label: "Deleted",
    className: "bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/15",
  },
  DISABLE: {
    label: "Disabled",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15",
  },
};

/**
 * "Recent changes" panel: the caller's own audit trail for this name, so
 * people can self-debug ("oh, *I* deleted that record yesterday") without
 * asking for support. Re-fetches whenever the records list changes identity,
 * which every save/delete in this page does.
 */
function RecentChanges({
  namespace,
  name,
  refreshToken,
}: {
  namespace: string;
  name: string;
  refreshToken: unknown;
}) {
  // null = first load in flight; on later refreshes the previous list stays
  // visible until the new one lands.
  const [logs, setLogs] = useState<AuditLogDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAuditLogs(namespace, name)
      .then(({ logs }) => {
        if (!cancelled) setLogs(logs);
      })
      .catch(() => {
        if (!cancelled) setLogs((prev) => prev ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [namespace, name, refreshToken]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <History className="size-4 text-muted-foreground" /> Recent changes
        </CardTitle>
        <CardDescription>
          Your last changes to this name - useful when something stopped working and you want to
          see what changed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logs === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-1.5 inline size-3.5 animate-spin" /> Loading&hellip;
          </p>
        ) : logs.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {logs.slice(0, 10).map((log) => {
              const action = AUDIT_ACTION_LABELS[log.action];
              return (
                <li key={log.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Badge className={`${action.className} hover:${action.className.split(" ")[0]} shrink-0`}>
                    {action.label}
                  </Badge>
                  <Badge variant="outline" className="shrink-0">
                    {log.type}
                  </Badge>
                  <span className="break-all font-mono text-xs">{log.fqdn.replace(/\.$/, "")}</span>
                  {(log.newValue ?? log.oldValue) && (
                    <span
                      className="max-w-48 truncate font-mono text-xs text-muted-foreground"
                      title={log.newValue ?? log.oldValue ?? undefined}
                    >
                      {log.newValue ?? log.oldValue}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(log.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Goal-oriented setup cards ("host a website", "point to my server", "learn").
 * Shown inline when a name has no records yet, and reachable any time after
 * that via the "Quick setup" dialog in the header.
 */
function GoalCards({
  namespace,
  zoneLabel,
  onHostWebsite,
  onPointServer,
}: {
  namespace: string;
  zoneLabel: string;
  onHostWebsite: () => void;
  onPointServer: () => void;
}) {
  return (
    <div className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-3">
      <button
        type="button"
        onClick={onHostWebsite}
        className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors hover:border-primary/50 hover:bg-accent"
      >
        <Globe className="size-5 text-primary" />
        <span className="text-sm font-medium">Host a website</span>
        <span className="text-xs text-muted-foreground">
          Free hosting via GitHub Pages - we add the records for you.
        </span>
      </button>
      <button
        type="button"
        onClick={onPointServer}
        className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors hover:border-primary/50 hover:bg-accent"
      >
        <Server className="size-5 text-primary" />
        <span className="text-sm font-medium">Point to my own server</span>
        <span className="text-xs text-muted-foreground">
          Have a VPS or home server? Point {zoneLabel} at its IP address.
        </span>
      </button>
      <Link
        href={`/${namespace}/help`}
        className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors hover:border-primary/50 hover:bg-accent"
      >
        <BookOpen className="size-5 text-primary" />
        <span className="text-sm font-medium">Learn what&apos;s possible</span>
        <span className="text-xs text-muted-foreground">
          Websites, subdomains, SSL certificates and more - see the guide.
        </span>
      </Link>
    </div>
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
  const [ghOpen, setGhOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [editing, setEditing] = useState<DnsRecordDto | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  // Pre-fills the Add Record dialog when opened from a "get started" goal
  // button (e.g. "Point to my own server" -> host @, type A).
  const [preset, setPreset] = useState<{ hostname: string; type: EditableRecordType } | null>(null);
  // Public-visibility check results, keyed by record id (see PropagationStatus).
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [checkingAll, setCheckingAll] = useState(false);

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

  async function checkOne(record: DnsRecordDto) {
    setChecks((prev) => ({ ...prev, [record.id]: "checking" }));
    try {
      const r = await verifyRecordPropagation(namespace, name, {
        hostname: record.relativeHost,
        type: record.type,
        value: record.value,
      });
      setChecks((prev) => ({
        ...prev,
        [record.id]: { visible: r.visible, matched: r.matched, answers: r.answers },
      }));
    } catch (err) {
      setChecks((prev) => {
        const next = { ...prev };
        delete next[record.id];
        return next;
      });
      toast.error(err instanceof ApiError ? err.message : "Couldn't reach the public resolver.");
    }
  }

  async function checkAll() {
    setCheckingAll(true);
    setChecks((prev) => {
      const next = { ...prev };
      for (const r of basicRecords) next[r.id] = "checking";
      return next;
    });
    try {
      const { results } = await verifyAllRecordsPropagation(namespace, name);
      setChecks((prev) => {
        const next = { ...prev };
        // Clear spinners for anything the server didn't report on.
        for (const r of basicRecords) if (next[r.id] === "checking") delete next[r.id];
        for (const r of results) {
          if (!r.failed) next[r.id] = { visible: r.visible, matched: r.matched, answers: r.answers };
        }
        return next;
      });
      const checked = results.filter((r) => !r.failed);
      const good = checked.filter((r) => r.matched).length;
      if (checked.length > 0 && good === checked.length) {
        toast.success(`All ${checked.length} records are publicly visible.`);
      } else {
        toast.info(`${good} of ${checked.length} records publicly visible so far.`, {
          description:
            "Recent changes can take up to ~5 minutes to propagate - hover a status badge to see what the resolver answered.",
        });
      }
    } catch (err) {
      setChecks((prev) => {
        const next = { ...prev };
        for (const r of basicRecords) if (next[r.id] === "checking") delete next[r.id];
        return next;
      });
      toast.error(err instanceof ApiError ? err.message : "Couldn't reach the public resolver.");
    } finally {
      setCheckingAll(false);
    }
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
            <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Sparkles className="size-4" /> Quick setup
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>What do you want to do with {displayZone}?</DialogTitle>
                  <DialogDescription>
                    Pick a goal and we&apos;ll set up the right records &mdash; no DNS knowledge
                    needed.
                  </DialogDescription>
                </DialogHeader>
                <GoalCards
                  namespace={namespace}
                  zoneLabel={displayZone}
                  onHostWebsite={() => {
                    setQuickOpen(false);
                    setGhOpen(true);
                  }}
                  onPointServer={() => {
                    setQuickOpen(false);
                    setPreset({ hostname: "@", type: "A" });
                    setAddOpen(true);
                  }}
                />
              </DialogContent>
            </Dialog>
            {/* Controlled, trigger-less: opened from the Quick setup goals and
                the empty-state cards. */}
            <Dialog open={ghOpen} onOpenChange={setGhOpen}>
              <GithubPagesDialogContent
                key={ghOpen ? "open" : "closed"}
                namespace={namespace}
                name={name}
                zone={zone}
                records={records}
                onRecordSaved={upsertLocal}
                onClose={() => setGhOpen(false)}
              />
            </Dialog>
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
                if (!open) {
                  setEditing(null);
                  setPreset(null);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button disabled={atHostCapacity}>
                  <Plus className="size-4" /> Add Record
                </Button>
              </DialogTrigger>
              <RecordDialogContent
                key={editing?.id ?? (preset ? `preset-${preset.type}-${preset.hostname}` : "new")}
                namespace={namespace}
                name={name}
                zone={zone}
                emailEnabled={emailEnabled}
                existing={editing}
                initial={preset}
                onSaved={(record) => {
                  upsertLocal(record);
                  setAddOpen(false);
                  setEditing(null);
                  setPreset(null);
                }}
              />
            </Dialog>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">DNS records</CardTitle>
            <CardDescription className="mt-1.5">
              Hostname examples: {EXAMPLES.map((e) => e.host).join(", ")} &mdash; relative to{" "}
              <span className="font-mono">{zone}</span>. A hostname holds either a single CNAME or a
              mix of the other types, never a CNAME alongside others. All records use a fixed 300s
              (5 minute) TTL.
            </CardDescription>
          </div>
          {basicRecords.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="sm:shrink-0"
              onClick={checkAll}
              disabled={checkingAll}
              title="Ask a public resolver whether every record is visible to the wider internet"
            >
              {checkingAll ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
              Check all
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {basicRecords.length === 0 ? (
            <div className="py-8">
              <p className="mb-1 text-center text-sm font-medium">What do you want to do with {displayZone}?</p>
              <p className="mb-6 text-center text-sm text-muted-foreground">
                Pick a goal and we&apos;ll set up the right records - no DNS knowledge needed.
              </p>
              <GoalCards
                namespace={namespace}
                zoneLabel={displayZone}
                onHostWebsite={() => setGhOpen(true)}
                onPointServer={() => {
                  setPreset({ hostname: "@", type: "A" });
                  setAddOpen(true);
                }}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hostname</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
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
                    <TableCell className="font-mono">
                      {/* Long values (DKIM CNAME targets, SPF) would otherwise
                          force the whole table to scroll - truncate with the
                          full value on hover and a copy button. */}
                      <span className="flex items-center gap-1.5">
                        <span className="max-w-55 truncate lg:max-w-80" title={r.value}>
                          {r.value}
                        </span>
                        <CopyInline value={r.value} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <PropagationStatus state={checks[r.id]} onCheck={() => checkOne(r)} />
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

      <RecentChanges namespace={namespace} name={name} refreshToken={records} />

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
                  toast.success("DNS record deleted", { description: PROPAGATION_NOTE });
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

// Remembers the GitHub username across visits (per browser) so the preset can
// prefill it - the same account is used for all of a person's names.
const GITHUB_USER_STORAGE_KEY = "namezone_github_user";

// GitHub usernames: 1-39 chars, alphanumeric or single hyphens, no leading/
// trailing hyphen and no consecutive hyphens.
function isValidGithubUser(user: string): boolean {
  return /^[a-z\d](?:-(?=[a-z\d])|[a-z\d]){0,38}$/i.test(user);
}

/**
 * One-click GitHub Pages setup. At the apex (@) a custom domain must be address
 * records, so it writes GitHub's four A + four AAAA IPs (only the ones missing).
 * At a subdomain GitHub recommends a single CNAME to <username>.github.io, so it
 * writes that instead - cleaner, and it auto-follows if GitHub changes IPs.
 */
function GithubPagesDialogContent({
  namespace,
  name,
  zone,
  records,
  onRecordSaved,
  onClose,
}: {
  namespace: string;
  name: string;
  zone: string;
  records: DnsRecordDto[];
  onRecordSaved: (record: DnsRecordDto) => void;
  onClose: () => void;
}) {
  const runWithStepUp = useStepUp();
  const [host, setHost] = useState("@");
  // Prefill the GitHub username from the last time they used this (same account
  // across all their names) - a convenience only, so localStorage, not the DB.
  const [ghUser, setGhUser] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem(GITHUB_USER_STORAGE_KEY) ?? ""),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayZone = zone.replace(/\.$/, "");
  const hostResult = validateRelativeHost(host);
  const relHost = hostResult.ok ? hostResult.value : host.trim().toLowerCase();
  const isApex = relHost === "@";
  const targetFqdn = isApex ? displayZone : `${relHost}.${displayZone}`;
  const ghUserValue = ghUser.trim().toLowerCase();
  const cnameTarget = `${ghUserValue || "<username>"}.github.io.`;

  // Apex: which of the 8 address records aren't already present.
  const ghMissing = GITHUB_PAGES_RECORDS.filter(
    (d) => !records.some((r) => r.relativeHost === relHost && r.type === d.type && r.value === d.value),
  );
  // A CNAME can't coexist with anything else, so flag the conflicts up front.
  const apexHasCname = records.some((r) => r.relativeHost === "@" && r.type === "CNAME");
  const subHostHasOthers = records.some((r) => r.relativeHost === relHost && r.type !== "CNAME");

  async function handleSubmit() {
    setError(null);
    if (!hostResult.ok) return setError(hostResult.error);
    if (isAcmeChallengeHost(relHost)) {
      return setError('Pick a normal host - "_acme-challenge" is managed under SSL challenges.');
    }
    if (isApex) {
      if (ghMissing.length === 0) {
        toast.info("GitHub Pages records are already set up on your apex (@).");
        return onClose();
      }
    } else if (!isValidGithubUser(ghUserValue)) {
      return setError("Enter your GitHub username (e.g. octocat).");
    }

    setSaving(true);
    try {
      if (isApex) {
        // One step-up covers the whole batch; records added are kept in state as
        // we go, so a retry after a partial failure only adds the rest.
        await runWithStepUp(async () => {
          for (const d of ghMissing) {
            const { record } = await createOrUpdateRecord(namespace, name, {
              hostname: "@",
              type: d.type,
              value: d.value,
            });
            onRecordSaved(record);
          }
        });
        toast.success(
          `Added ${ghMissing.length} GitHub Pages record${ghMissing.length === 1 ? "" : "s"} to your apex (@).`,
        );
      } else {
        const { record } = await runWithStepUp(() =>
          createOrUpdateRecord(namespace, name, {
            hostname: relHost,
            type: "CNAME",
            value: `${ghUserValue}.github.io.`,
          }),
        );
        onRecordSaved(record);
        localStorage.setItem(GITHUB_USER_STORAGE_KEY, ghUserValue);
        toast.success(`Pointed ${targetFqdn} at ${ghUserValue}.github.io.`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to set up GitHub Pages.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Set up GitHub Pages</DialogTitle>
        <DialogDescription>
          Point a host at GitHub Pages. The apex needs address records; subdomains use a CNAME.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gh-host">Host</Label>
          <Input
            id="gh-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="@"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">@</span> for {displayZone} itself, or a subdomain like{" "}
            <span className="font-mono">www</span>. Target: <span className="font-mono">{targetFqdn}</span>
          </p>
        </div>

        {!isApex && (
          <div className="space-y-2">
            <Label htmlFor="gh-user">GitHub username</Label>
            <Input
              id="gh-user"
              value={ghUser}
              onChange={(e) => setGhUser(e.target.value)}
              placeholder="octocat"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Creates <span className="font-mono">{targetFqdn}</span> &rarr;{" "}
              <span className="font-mono">{cnameTarget}</span> (a CNAME). Set{" "}
              <span className="font-mono">{targetFqdn}</span> as the custom domain on your Pages repo.
            </p>
          </div>
        )}

        {isApex && (
          <p className="text-xs text-muted-foreground">
            {ghMissing.length === 0
              ? "All eight GitHub Pages address records are already present."
              : `Adds ${ghMissing.length} missing address record${ghMissing.length === 1 ? "" : "s"} (GitHub's four A + four AAAA IPs). Set ${displayZone} as the custom domain on your Pages repo.`}
          </p>
        )}

        {isApex && apexHasCname && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Your apex has a CNAME, which can&apos;t coexist with address records. Remove it first.
          </p>
        )}
        {!isApex && subHostHasOthers && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            <span className="font-mono">{relHost}</span> already has other records; a CNAME can&apos;t
            coexist with them. Remove them first.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {isApex
            ? ghMissing.length === 0
              ? "Already set up"
              : `Add ${ghMissing.length} record${ghMissing.length === 1 ? "" : "s"}`
            : "Add CNAME"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function RecordDialogContent({
  namespace,
  name,
  zone,
  emailEnabled,
  existing,
  initial,
  onSaved,
}: {
  namespace: string;
  name: string;
  zone: string;
  emailEnabled: boolean;
  existing: DnsRecordDto | null;
  /** Optional pre-fill when opened from a "get started" goal button. */
  initial?: { hostname: string; type: EditableRecordType } | null;
  onSaved: (record: DnsRecordDto) => void;
}) {
  const runWithStepUp = useStepUp();
  const [hostname, setHostname] = useState(existing?.relativeHost ?? initial?.hostname ?? "");
  const [type, setType] = useState<EditableRecordType>(
    (existing?.type as EditableRecordType) ?? initial?.type ?? "A",
  );
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
      toast.success("DNS record saved", { description: PROPAGATION_NOTE });
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
          <p className="text-xs text-muted-foreground">{TYPE_EXPLANATIONS[type]}</p>
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
