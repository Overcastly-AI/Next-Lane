-- Add showOnCard flag to custom field definitions (pin value as a chip on board cards)
ALTER TABLE "CustomFieldDefinition" ADD COLUMN "showOnCard" BOOLEAN NOT NULL DEFAULT false;
