-- Add optional scope array to ApiToken.
-- An empty array (the default) means "unrestricted" — fully backward-compatible
-- with existing tokens which should behave as before (owner full-permission).
ALTER TABLE "ApiToken" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT '{}';
