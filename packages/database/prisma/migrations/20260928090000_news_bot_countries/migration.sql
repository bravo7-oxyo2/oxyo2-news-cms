-- Country origin is a snapshot on content so existing articles retain their
-- provenance even if a source is later reassigned.
ALTER TABLE "Content" ADD COLUMN "sourceCountryCode" CHAR(2) NOT NULL DEFAULT 'MY';
ALTER TABLE "NewsBotSource" ADD COLUMN "countryCode" CHAR(2) NOT NULL DEFAULT 'MY';

CREATE TABLE "NewsBotCountry" (
  "code" CHAR(2) NOT NULL,
  "retrievalEnabled" BOOLEAN NOT NULL DEFAULT true,
  "displayEnabled" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsBotCountry_pkey" PRIMARY KEY ("code")
);

INSERT INTO "NewsBotCountry" ("code", "retrievalEnabled", "displayEnabled", "isDefault", "updatedAt")
VALUES ('MY', true, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "isDefault" = true, "displayEnabled" = true;

CREATE INDEX "Content_type_sourceCountryCode_status_publishedAt_idx" ON "Content"("type", "sourceCountryCode", "status", "publishedAt");
CREATE INDEX "NewsBotSource_countryCode_isEnabled_idx" ON "NewsBotSource"("countryCode", "isEnabled");
CREATE INDEX "NewsBotCountry_retrievalEnabled_idx" ON "NewsBotCountry"("retrievalEnabled");
CREATE INDEX "NewsBotCountry_displayEnabled_idx" ON "NewsBotCountry"("displayEnabled");
CREATE INDEX "NewsBotCountry_isDefault_idx" ON "NewsBotCountry"("isDefault");
