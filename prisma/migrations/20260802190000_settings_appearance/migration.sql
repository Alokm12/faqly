-- Appearance moves out of the theme app extension's block schema and into
-- the Setting row.
--
-- WHY
-- Theme block settings are stored inside the theme's own JSON, so a
-- merchant who switches or duplicates a theme silently loses every styling
-- choice they made. Owning these here means the widget looks right the
-- moment a new theme goes live.
--
-- Additive only, and every default is byte-identical to the block-schema
-- default it replaces. A merchant who never opened the theme editor sees
-- no visual change; one who did will need to re-apply their choices on the
-- Appearance tab, because their values are in theme JSON we cannot read
-- per placement.
ALTER TABLE "Setting" ADD COLUMN "accentColor" TEXT NOT NULL DEFAULT '#4A5D3A';
ALTER TABLE "Setting" ADD COLUMN "fontSize" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "Setting" ADD COLUMN "radiusWidget" INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "Setting" ADD COLUMN "radiusTabbar" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Setting" ADD COLUMN "radiusPill" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "Setting" ADD COLUMN "radiusCard" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "Setting" ADD COLUMN "radiusButton" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "Setting" ADD COLUMN "radiusIcon" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Setting" ADD COLUMN "searchEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Setting" ADD COLUMN "searchPlaceholder" TEXT NOT NULL DEFAULT 'Search for answers…';
