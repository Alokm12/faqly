-- AI FAQ generation: per-shop credit balance, per-call usage log, and the two
-- provenance columns on Faq.
--
-- Additive only. `source` defaults to 'manual', so every FAQ that already
-- exists keeps its meaning and nothing needs backfilling.
--
-- Neither new table references Shop. Uninstall sets `uninstalledAt` rather
-- than deleting the row, so a cascade would never fire; keeping these
-- standalone means the credit balance and the spend audit trail outlive any
-- future change to how shop rows are reaped.
ALTER TABLE "Faq" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Faq" ADD COLUMN "aiConfidence" TEXT;

CREATE TABLE "ShopPlan" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "aiCreditsUsed" INTEGER NOT NULL DEFAULT 0,
    "aiCreditsLimit" INTEGER NOT NULL DEFAULT 5,
    "cycleResetAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AiUsage_shop_createdAt_idx" ON "AiUsage"("shop", "createdAt");
