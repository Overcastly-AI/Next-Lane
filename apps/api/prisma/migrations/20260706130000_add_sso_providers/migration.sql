-- SSO/OIDC Phase 2 — SAML + multi-provider + JIT provisioning.
--
-- Purely additive: the Phase-1 `OidcConfig` singleton table is untouched
-- apart from two new NULLABLE/defaulted columns (JIT provisioning), so every
-- existing single-OIDC-provider deployment keeps working unmigrated with no
-- behavior change (jitDefaultWorkspaceId defaults to NULL = JIT off, exactly
-- today's create-user-with-no-membership behavior).

-- CreateEnum
CREATE TYPE "SsoProviderType" AS ENUM ('OIDC', 'SAML');

-- AlterTable: OidcConfig gains opt-in JIT provisioning (Phase-1 legacy provider)
ALTER TABLE "OidcConfig"
  ADD COLUMN "jitDefaultWorkspaceId" TEXT,
  ADD COLUMN "jitDefaultRole" "Role" NOT NULL DEFAULT 'VIEWER';

-- CreateTable: the new N-simultaneous-providers list (OIDC and/or SAML rows)
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "type" "SsoProviderType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "issuerUrl" TEXT,
    "clientId" TEXT,
    "clientSecretEncrypted" TEXT,
    "samlEntryPoint" TEXT,
    "samlIdpIssuer" TEXT,
    "samlIdpCertificate" TEXT,
    "samlSpEntityId" TEXT,
    "samlWantAssertionsSigned" BOOLEAN NOT NULL DEFAULT true,
    "jitDefaultWorkspaceId" TEXT,
    "jitDefaultRole" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SsoProvider_slug_key" ON "SsoProvider"("slug");

-- CreateIndex
CREATE INDEX "SsoProvider_type_idx" ON "SsoProvider"("type");

-- CreateIndex
CREATE INDEX "SsoProvider_jitDefaultWorkspaceId_idx" ON "SsoProvider"("jitDefaultWorkspaceId");

-- AddForeignKey
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_jitDefaultWorkspaceId_fkey" FOREIGN KEY ("jitDefaultWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
