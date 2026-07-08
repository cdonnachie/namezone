-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnsName" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
INSERT INTO "new_AnsName" ("createdAt", "id", "name", "ownerAddress", "updatedAt", "verifiedAt") SELECT "createdAt", "id", "name", "ownerAddress", "updatedAt", "verifiedAt" FROM "AnsName";
DROP TABLE "AnsName";
ALTER TABLE "new_AnsName" RENAME TO "AnsName";
CREATE UNIQUE INDEX "AnsName_name_key" ON "AnsName"("name");
CREATE INDEX "AnsName_ownerAddress_idx" ON "AnsName"("ownerAddress");
CREATE INDEX "AnsName_status_idx" ON "AnsName"("status");
CREATE TABLE "new_DnsRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ansName" TEXT NOT NULL,
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
    CONSTRAINT "DnsRecord_ansName_fkey" FOREIGN KEY ("ansName") REFERENCES "AnsName" ("name") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DnsRecord" ("ansName", "createdAt", "expiresAt", "fqdn", "id", "isAcmeChallenge", "powerdnsRecordId", "relativeHost", "ttl", "type", "updatedAt", "value") SELECT "ansName", "createdAt", "expiresAt", "fqdn", "id", "isAcmeChallenge", "powerdnsRecordId", "relativeHost", "ttl", "type", "updatedAt", "value" FROM "DnsRecord";
DROP TABLE "DnsRecord";
ALTER TABLE "new_DnsRecord" RENAME TO "DnsRecord";
CREATE INDEX "DnsRecord_ansName_idx" ON "DnsRecord"("ansName");
CREATE INDEX "DnsRecord_expiresAt_idx" ON "DnsRecord"("expiresAt");
CREATE INDEX "DnsRecord_status_idx" ON "DnsRecord"("status");
CREATE UNIQUE INDEX "DnsRecord_fqdn_type_value_key" ON "DnsRecord"("fqdn", "type", "value");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
