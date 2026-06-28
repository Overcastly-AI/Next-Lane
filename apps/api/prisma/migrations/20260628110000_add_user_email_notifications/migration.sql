-- AddColumn: emailNotifications on User (additive; backfills existing rows with default true)
ALTER TABLE "User" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
