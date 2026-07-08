import { avianNamespace } from "./avian";
import { radiantNamespace } from "./radiant";
import type { NamespaceConfig } from "./types";

const ALL_NAMESPACES: NamespaceConfig[] = [avianNamespace, radiantNamespace];

for (const ns of ALL_NAMESPACES) {
  if (!ns.dnsZone.startsWith(`${ns.tld}.`)) {
    throw new Error(
      `Namespace "${ns.key}" misconfigured: dnsZone "${ns.dnsZone}" must start with "${ns.tld}."`,
    );
  }
}

const NAMESPACES: Record<string, NamespaceConfig> = Object.fromEntries(
  ALL_NAMESPACES.map((ns) => [ns.key, ns]),
);

export class NamespaceNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown or disabled namespace: "${key}"`);
    this.name = "NamespaceNotFoundError";
  }
}

/** Throws NamespaceNotFoundError for an unknown key or a disabled namespace. */
export function getNamespace(key: string): NamespaceConfig {
  const ns = NAMESPACES[key?.toLowerCase()];
  if (!ns || !ns.enabled) throw new NamespaceNotFoundError(key);
  return ns;
}

export function listEnabledNamespaces(): NamespaceConfig[] {
  return ALL_NAMESPACES.filter((ns) => ns.enabled);
}

export function listAllNamespaces(): NamespaceConfig[] {
  return ALL_NAMESPACES;
}
