-- Instance-level admin flag — gates instance-wide settings (e.g. the in-app
-- SSO/OIDC configuration screen) that are distinct from workspace-level
-- Membership.role: ADMIN. Backfill: the oldest existing user (by createdAt)
-- becomes the instance admin for already-provisioned installs; brand-new
-- installs get this set at registration time instead (see
-- AuthService.register()'s isFirstUser check — a no-op here since there are
-- no rows yet on a fresh install).
ALTER TABLE "User" ADD COLUMN "isInstanceAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "isInstanceAdmin" = true
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1);

-- Instance-level SSO/OIDC configuration (in-app admin settings screen),
-- single-row table always addressed by the fixed id "singleton". Env vars
-- (OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET) still win over this
-- table when set — see OidcConfigService's precedence rule.
CREATE TABLE "OidcConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuerUrl" TEXT,
    "clientId" TEXT,
    "clientSecretEncrypted" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcConfig_pkey" PRIMARY KEY ("id")
);
