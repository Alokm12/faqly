-- Faqly data layer: FAQs, Categories and Settings move out of Shopify
-- app-reserved metaobjects and into our own database.
--
-- Additive only. The existing Session table is untouched apart from a new
-- lookup index, so running this cannot lose sessions.
--
-- NOTE: this file is the SQLite version, matching the current datasource.
-- If you switch the datasource to PostgreSQL, delete this migration and
-- regenerate the baseline instead of hand-porting it:
--   rm -rf prisma/migrations && npx prisma migrate dev --name init

-- CreateTable
-- The migration is named "create_session_table" but never created it: the
-- table was produced by an early `prisma db push` and only the index was ever
-- captured here. That made this migration unappliable to any fresh database —
-- `prisma migrate deploy` died on "no such table: main.Session" before a
-- single table was created, so the app could not be deployed to new hosting
-- at all.
--
-- Both statements are IF NOT EXISTS so this is safe in both directions: a
-- fresh database gets the table, and a database that already has one (every
-- existing dev and production install) is untouched.
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_shop_idx" ON "Session"("shop");

-- CreateTable
CREATE TABLE "Shop" (
    "domain" TEXT NOT NULL PRIMARY KEY,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "lastSyncAt" DATETIME,
    "lastSyncError" TEXT
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "iconImageUrl" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "metaobjectId" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Category_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("domain") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Faq" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "collectionIds" TEXT NOT NULL DEFAULT '[]',
    "metaobjectId" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Faq_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("domain") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Deleting a category must never delete the merchant's written answers.
    CONSTRAINT "Faq_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "poweredByVisible" BOOLEAN NOT NULL DEFAULT true,
    "schemaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "feedbackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "analyticsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Setting_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("domain") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_shop_handle_key" ON "Category"("shop", "handle");
CREATE INDEX "Category_shop_position_idx" ON "Category"("shop", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Faq_shop_handle_key" ON "Faq"("shop", "handle");
CREATE INDEX "Faq_shop_position_idx" ON "Faq"("shop", "position");
CREATE INDEX "Faq_shop_status_idx" ON "Faq"("shop", "status");
CREATE INDEX "Faq_categoryId_idx" ON "Faq"("categoryId");
