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
});

// Basic (non-ACME) record types creatable via the general Add Record flow.
export const recordTypeSchema = z.enum(["A", "AAAA", "CNAME"]);

export const createRecordSchema = z.object({
  hostname: z.string().trim().min(1).max(253),
  type: recordTypeSchema,
  value: z.string().trim().min(1).max(253),
});

export const deleteRecordSchema = z.object({
  hostname: z.string().trim().min(1).max(253),
  type: recordTypeSchema,
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
