-- Country handling is opt-in. Preserve Malaysia as the existing default so
-- historical sources and reader listings retain their current behavior.
ALTER TABLE "NewsBotCountry" ALTER COLUMN "retrievalEnabled" SET DEFAULT false;
ALTER TABLE "NewsBotCountry" ALTER COLUMN "displayEnabled" SET DEFAULT false;

UPDATE "NewsBotCountry"
SET "retrievalEnabled" = false,
    "displayEnabled" = false
WHERE "code" <> 'MY';

INSERT INTO "NewsBotCountry" ("code", "retrievalEnabled", "displayEnabled", "isDefault", "updatedAt")
VALUES ('MY', true, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "retrievalEnabled" = true,
    "displayEnabled" = true,
    "isDefault" = true,
    "updatedAt" = CURRENT_TIMESTAMP;
