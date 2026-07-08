-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AnsName" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DnsRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ansName" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "relativeHost" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "ttl" INTEGER NOT NULL DEFAULT 300,
    "powerdnsRecordId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DnsRecord_ansName_fkey" FOREIGN KEY ("ansName") REFERENCES "AnsName" ("name") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "ansName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_nonce_key" ON "UserSession"("nonce");

-- CreateIndex
CREATE INDEX "UserSession_address_idx" ON "UserSession"("address");

-- CreateIndex
CREATE INDEX "UserSession_nonce_idx" ON "UserSession"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "AnsName_name_key" ON "AnsName"("name");

-- CreateIndex
CREATE INDEX "AnsName_ownerAddress_idx" ON "AnsName"("ownerAddress");

-- CreateIndex
CREATE INDEX "DnsRecord_ansName_idx" ON "DnsRecord"("ansName");

-- CreateIndex
CREATE UNIQUE INDEX "DnsRecord_fqdn_type_key" ON "DnsRecord"("fqdn", "type");

-- CreateIndex
CREATE INDEX "AuditLog_ansName_idx" ON "AuditLog"("ansName");

-- CreateIndex
CREATE INDEX "AuditLog_address_idx" ON "AuditLog"("address");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_key_key" ON "RateLimitBucket"("key");

-- CreateIndex
CREATE INDEX "RateLimitBucket_key_idx" ON "RateLimitBucket"("key");
