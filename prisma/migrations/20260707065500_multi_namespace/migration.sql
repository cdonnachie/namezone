-- Multi-namespace platform migration.
-- Hand-written (not `prisma migrate dev`-generated): Prisma's diff engine
-- sees AnsName -> ClaimedName as a drop-and-recreate, which would destroy
-- real data. This uses SQLite's table-rebuild pattern throughout, backfills
-- the new `namespace` column with 'avian' (the only namespace that existed
-- before this migration), and preserves every existing row and its id.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- UserSession: add `namespace`, backfill 'avian'.
CREATE TABLE "new_UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "namespace" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_UserSession" ("id", "namespace", "address", "nonce", "message", "verified", "expiresAt", "createdAt")
  SELECT "id", 'avian', "address", "nonce", "message", "verified", "expiresAt", "createdAt" FROM "UserSession";
DROP TABLE "UserSession";
ALTER TABLE "new_UserSession" RENAME TO "UserSession";
CREATE UNIQUE INDEX "UserSession_nonce_key" ON "UserSession"("nonce");
CREATE INDEX "UserSession_namespace_address_idx" ON "UserSession"("namespace", "address");
CREATE INDEX "UserSession_nonce_idx" ON "UserSession"("nonce");

-- AnsName -> ClaimedName: rename table, add `namespace`, backfill 'avian'.
CREATE TABLE "new_ClaimedName" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "namespace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "previousOwnerAddress" TEXT,
    "transferredAt" DATETIME,
    "verifiedAt" DATETIME NOT NULL,
    "lastOwnershipCheckAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ClaimedName" ("id", "namespace", "name", "ownerAddress", "status", "previousOwnerAddress", "transferredAt", "verifiedAt", "lastOwnershipCheckAt", "createdAt", "updatedAt")
  SELECT "id", 'avian', "name", "ownerAddress", "status", "previousOwnerAddress", "transferredAt", "verifiedAt", "lastOwnershipCheckAt", "createdAt", "updatedAt" FROM "AnsName";
DROP TABLE "AnsName";
ALTER TABLE "new_ClaimedName" RENAME TO "ClaimedName";
CREATE UNIQUE INDEX "ClaimedName_namespace_name_key" ON "ClaimedName"("namespace", "name");
CREATE INDEX "ClaimedName_namespace_ownerAddress_idx" ON "ClaimedName"("namespace", "ownerAddress");
CREATE INDEX "ClaimedName_namespace_status_idx" ON "ClaimedName"("namespace", "status");

-- DnsRecord: rename `ansName` -> `claimedName`, add `namespace`, backfill
-- 'avian', re-point FK at ClaimedName(namespace, name).
CREATE TABLE "new_DnsRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "namespace" TEXT NOT NULL,
    "claimedName" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "relativeHost" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "ttl" INTEGER NOT NULL DEFAULT 300,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "disabledReason" TEXT,
    "isAcmeChallenge" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "powerdnsRecordId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DnsRecord_namespace_claimedName_fkey" FOREIGN KEY ("namespace", "claimedName") REFERENCES "ClaimedName" ("namespace", "name") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DnsRecord" ("id", "namespace", "claimedName", "fqdn", "relativeHost", "type", "value", "ttl", "status", "disabledReason", "isAcmeChallenge", "expiresAt", "powerdnsRecordId", "createdAt", "updatedAt")
  SELECT "id", 'avian', "ansName", "fqdn", "relativeHost", "type", "value", "ttl", "status", "disabledReason", "isAcmeChallenge", "expiresAt", "powerdnsRecordId", "createdAt", "updatedAt" FROM "DnsRecord";
DROP TABLE "DnsRecord";
ALTER TABLE "new_DnsRecord" RENAME TO "DnsRecord";
CREATE UNIQUE INDEX "DnsRecord_namespace_fqdn_type_value_key" ON "DnsRecord"("namespace", "fqdn", "type", "value");
CREATE INDEX "DnsRecord_namespace_claimedName_idx" ON "DnsRecord"("namespace", "claimedName");
CREATE INDEX "DnsRecord_expiresAt_idx" ON "DnsRecord"("expiresAt");
CREATE INDEX "DnsRecord_status_idx" ON "DnsRecord"("status");

-- AuditLog: rename `ansName` -> `claimedName`, add `namespace`, backfill
-- 'avian'. No FK - audit history survives independently.
CREATE TABLE "new_AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "namespace" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "claimedName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AuditLog" ("id", "namespace", "address", "claimedName", "action", "fqdn", "type", "oldValue", "newValue", "ipAddress", "userAgent", "createdAt")
  SELECT "id", 'avian', "address", "ansName", "action", "fqdn", "type", "oldValue", "newValue", "ipAddress", "userAgent", "createdAt" FROM "AuditLog";
DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
CREATE INDEX "AuditLog_namespace_claimedName_idx" ON "AuditLog"("namespace", "claimedName");
CREATE INDEX "AuditLog_namespace_address_idx" ON "AuditLog"("namespace", "address");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
