import { z } from "zod";

// Base58 (Bitcoin/Ravencoin/Avian-style) address: excludes 0, O, I, l.
const BASE58_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{25,40}$/;

export const addressSchema = z
  .string()
  .trim()
  .regex(BASE58_ADDRESS_REGEX, "Invalid address format.");

export const challengeRequestSchema = z.object({
  address: addressSchema,
});

export const verifyRequestSchema = z.object({
  address: addressSchema,
  message: z.string().min(1).max(2000),
  signature: z.string().min(1).max(1000),
  // "This is a shared computer": issue a 30-minute browser-session cookie
  // instead of the persistent 12-hour session.
  sharedComputer: z.boolean().optional(),
});

// Record types creatable via the general Add Record flow. MX/TXT are
// email types, allowlist-gated per name in the route (see src/lib/dns/email.ts);
// the schema just permits the shape - authorization happens downstream.
export const recordTypeSchema = z.enum(["A", "AAAA", "CNAME", "MX", "TXT"]);

export const createRecordSchema = z.object({
  hostname: z.string().trim().min(1).max(253),
  type: recordTypeSchema,
  // Long enough for DKIM public keys / SPF policies as well as A/AAAA/CNAME/MX.
  value: z.string().trim().min(1).max(1024),
});

export const deleteRecordSchema = z.object({
  hostname: z.string().trim().min(1).max(253),
  type: recordTypeSchema,
  // Required to delete one value of a multi-value rrset (MX, email TXT);
  // ignored for single-value A/AAAA/CNAME.
  value: z.string().trim().min(1).max(1024).optional(),
});

// ACME challenge records: `hostname` is the target service host (e.g. "@",
// "www"), not the "_acme-challenge" name itself - the API derives that.
export const createAcmeChallengeSchema = z.object({
  hostname: z.string().trim().min(1).max(253),
  value: z.string().trim().min(1).max(255),
  expiryHours: z.number().int().positive().max(24 * 7).optional(),
});

export const deleteAcmeChallengeSchema = z.object({
  hostname: z.string().trim().min(1).max(253),
  value: z.string().trim().min(1).max(255),
});
