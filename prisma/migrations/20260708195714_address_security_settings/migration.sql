-- CreateTable
CREATE TABLE "AddressSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "namespace" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "requireSignedWrites" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AddressSetting_namespace_address_key" ON "AddressSetting"("namespace", "address");
