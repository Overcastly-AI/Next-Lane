-- Images uploaded into a page's markdown body.
--
-- Referenced from Page.content as `![alt](nl-image:<id>)` and resolved by the
-- renderer at display time, which fetches with the caller's token — so an
-- embedded image is exactly as private as the page holding it.

CREATE TABLE "PageImage" (
    "id"           TEXT NOT NULL,
    "pageId"       TEXT NOT NULL,
    "storageKey"   TEXT NOT NULL,
    "filename"     TEXT NOT NULL,
    "mimeType"     TEXT NOT NULL,
    "sizeBytes"    INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageImage_pkey" PRIMARY KEY ("id")
);

-- "every image on this page" — the list and cleanup query.
CREATE INDEX "PageImage_pageId_idx" ON "PageImage"("pageId");

-- Cascade: deleting a page removes its image rows. The BLOBS are deleted by
-- the service before the row goes, because the storage driver is not something
-- the database can reach.
ALTER TABLE "PageImage"
    ADD CONSTRAINT "PageImage_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "Page"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull: keep the image if the uploader's account is deleted.
ALTER TABLE "PageImage"
    ADD CONSTRAINT "PageImage_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
