-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DnsRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ansName" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "relativeHost" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "ttl" INTEGER NOT NULL DEFAULT 300,
    "isAcmeChallenge" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "powerdnsRecordId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DnsRecord_ansName_fkey" FOREIGN KEY ("ansName") REFERENCES "AnsName" ("name") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DnsRecord" ("ansName", "createdAt", "fqdn", "id", "powerdnsRecordId", "relativeHost", "ttl", "type", "updatedAt", "value") SELECT "ansName", "createdAt", "fqdn", "id", "powerdnsRecordId", "relativeHost", "ttl", "type", "updatedAt", "value" FROM "DnsRecord";
DROP TABLE "DnsRecord";
ALTER TABLE "new_DnsRecord" RENAME TO "DnsRecord";
CREATE INDEX "DnsRecord_ansName_idx" ON "DnsRecord"("ansName");
CREATE INDEX "DnsRecord_expiresAt_idx" ON "DnsRecord"("expiresAt");
CREATE UNIQUE INDEX "DnsRecord_fqdn_type_value_key" ON "DnsRecord"("fqdn", "type", "value");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
