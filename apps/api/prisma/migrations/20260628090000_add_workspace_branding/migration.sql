-- Migration: add_workspace_branding
-- Adds three nullable branding columns to the Workspace table so companies can
-- customise their workspace with an accent color and an uploaded logo image.
--
-- Design notes:
--   * All three columns are nullable — null values mean "use product defaults".
--   * brandColor stores a #RRGGBB hex string; format is validated in the
--     application layer (NestJS DTO), not at the DB level, to keep the
--     constraint logic centralised and avoid a check-constraint migration.
--   * logoStorageKey follows the same UUID-based on-disk scheme as
--     Attachment.storageKey (multer diskStorage under UPLOADS_DIR). The value
--     is never derived from a client-supplied filename.
--   * logoMimeType lets the serve endpoint set Content-Type without opening the
--     file; it is always null when logoStorageKey is null.
--   * No indexes are added — branding fields are only accessed on workspace
--     lookup (by id/slug), which is already covered by the primary key and the
--     existing unique index on slug.

-- AlterTable
ALTER TABLE "Workspace"
    ADD COLUMN "brandColor"     TEXT,
    ADD COLUMN "logoStorageKey" TEXT,
    ADD COLUMN "logoMimeType"   TEXT;
