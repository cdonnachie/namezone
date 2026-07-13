import type { DnsNamespace } from "@/lib/dns/constants";

/**
 * Per-chain adapter: how to look up on-chain name ownership and verify a
 * wallet's signed message. Every namespace (Avian, Radiant, ...) implements
 * this the same way regardless of how different the underlying chain is -
 * the DNS management, PowerDNS integration, validation, transfer handling,
 * and UI never need to know which chain they're talking to.
 */
export interface OwnershipAdapter {
  /** Returns all source names (lowercase, e.g. "bob.avn") currently owned by `address`. */
  getNamesByOwner(address: string): Promise<string[]>;

  /** Returns the single current owner address of `name`, or null if unowned/nonexistent. */
  getOwnerAddress(name: string): Promise<string | null>;

  /** Returns true if `address` currently owns `name`. */
  verifyOwner(name: string, address: string): Promise<boolean>;

  /** Returns true if `name` exists and is currently active/registered. */
  isNameActive(name: string): Promise<boolean>;

  /** Builds the human-readable challenge message the user must sign to log in. */
  buildLoginChallengeMessage(params: {
    address: string;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
  }): string;

  /** Verifies a signed challenge message against the claimed address. Never throws. */
  verifySignedMessage(address: string, message: string, signatureBase64: string): boolean;
}

export interface NamespaceExample {
  source: string;
  zone: string;
}

export interface NamespaceConfig extends DnsNamespace {
  /** URL segment + internal id, e.g. "avian". Lowercase, stable, never renamed once live. */
  key: string;
  /** e.g. "Avian Name Zone" */
  displayName: string;
  /** e.g. "Avian" */
  chainName: string;
  /**
   * Full network name for first-mention contexts (brand guidelines: "Avian
   * Network" on first mention, "Avian" thereafter). Falls back to chainName.
   */
  networkName?: string;
  /** e.g. "/logomark-gradient.svg". Used as-is in dark mode unless logoPathDark is set. */
  logoPath: string;
  /** Dark-mode variant of logoPath, for chains whose mark needs different contrast per theme. */
  logoPathDark?: string;
  /** e.g. "/avian.ico" */
  faviconPath: string;
  /** Brand accent color (hex) used for this namespace's theme scoping. */
  brandColor: string;
  exampleNames: NamespaceExample[];
  /** Example address shown as the connect form's placeholder, e.g. "RAddressOwningYourName" - each chain has its own address format/prefix. */
  addressPlaceholder: string;
  /**
   * False hides the namespace from the portal and 404s its routes. Used for
   * Radiant until its real ownership adapter replaces the stub.
   */
  enabled: boolean;
  adapter: OwnershipAdapter;
}
