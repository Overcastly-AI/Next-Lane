-- AlterTable: add optional color + group to QuickLink
ALTER TABLE "QuickLink" ADD COLUMN "color" TEXT;
ALTER TABLE "QuickLink" ADD COLUMN "group" TEXT;
