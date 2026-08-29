-- CreateTable
CREATE TABLE "ManagedSite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "namespace" TEXT NOT NULL,
    "claimedName" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "relativeHost" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "cnameTarget" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "disabledReason" TEXT,
    "createdByWallet" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ManagedSite_namespace_claimedName_fkey" FOREIGN KEY ("namespace", "claimedName") REFERENCES "ClaimedName" ("namespace", "name") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "isManagedRedirect" BOOLEAN NOT NULL DEFAULT false,
    "isManagedSite" BOOLEAN NOT NULL DEFAULT false,
    "powerdnsRecordId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DnsRecord_namespace_claimedName_fkey" FOREIGN KEY ("namespace", "claimedName") REFERENCES "ClaimedName" ("namespace", "name") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DnsRecord" ("claimedName", "createdAt", "disabledReason", "expiresAt", "fqdn", "id", "isAcmeChallenge", "isManagedRedirect", "namespace", "powerdnsRecordId", "relativeHost", "status", "ttl", "type", "updatedAt", "value") SELECT "claimedName", "createdAt", "disabledReason", "expiresAt", "fqdn", "id", "isAcmeChallenge", "isManagedRedirect", "namespace", "powerdnsRecordId", "relativeHost", "status", "ttl", "type", "updatedAt", "value" FROM "DnsRecord";
DROP TABLE "DnsRecord";
ALTER TABLE "new_DnsRecord" RENAME TO "DnsRecord";
CREATE INDEX "DnsRecord_namespace_claimedName_idx" ON "DnsRecord"("namespace", "claimedName");
CREATE INDEX "DnsRecord_expiresAt_idx" ON "DnsRecord"("expiresAt");
CREATE INDEX "DnsRecord_status_idx" ON "DnsRecord"("status");
CREATE UNIQUE INDEX "DnsRecord_namespace_fqdn_type_value_key" ON "DnsRecord"("namespace", "fqdn", "type", "value");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ManagedSite_namespace_claimedName_idx" ON "ManagedSite"("namespace", "claimedName");

-- CreateIndex
CREATE INDEX "ManagedSite_status_idx" ON "ManagedSite"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedSite_namespace_fqdn_key" ON "ManagedSite"("namespace", "fqdn");
