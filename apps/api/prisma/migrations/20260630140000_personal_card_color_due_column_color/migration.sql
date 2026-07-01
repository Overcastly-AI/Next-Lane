-- Personal board enrichment: card color + due date, column color
ALTER TABLE "PersonalCard" ADD COLUMN "color" TEXT;
ALTER TABLE "PersonalCard" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "PersonalColumn" ADD COLUMN "color" TEXT;
