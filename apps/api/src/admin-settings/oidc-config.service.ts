/**
 * OidcConfigService — resolves the SSO/OIDC configuration actually in effect
 * for this deployment, and owns the single-row `OidcConfig` DB table backing
 * the in-app admin settings screen.
 *
 * Precedence (12-factor): `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/
 * `OIDC_CLIENT_SECRET` env vars WIN over the DB row when all three are set —
 * operators who pin config in the environment keep that behavior unchanged.
 * The DB row is the fallback/UI-editable path for self-hosters who'd rather
 * configure SSO from a settings page than redeploy.
 *
 * No explicit cache-invalidation event is needed: `getEffectiveConfig()`
 * reads the DB fresh on every call (a single indexed PK lookup, cheap), and
 * `OidcService`'s own OIDC-client discovery cache is keyed by a fingerprint
 * derived from this config's issuer/client id/secret — so a save from the UI
 * naturally busts that cache without any restart or manual invalidation.
 *
 * SSO/OIDC Phase 2 note: this remains the Phase-1 "legacy" single-provider
 * config, entirely unmigrated — `SsoProvidersService`/`SsoProvider` is a
 * SEPARATE, additive table for N additional providers (OIDC and/or SAML).
 * This service also now carries an optional JIT-provisioning rule
 * (`jitDefaultWorkspaceId`/`jitDefaultRole`) for THIS provider, mirroring
 * `SsoProvider`'s own JIT fields exactly.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, type OidcConfigDto } from '@next-lane/shared';
import { getOidcButtonLabel, getOidcEnvConfig } from '../auth/oidc/oidc.config';
import {
  decryptOidcClientSecret,
  encryptOidcClientSecret,
} from '../auth/oidc/oidc-secret-crypto.util';

/** Fixed id — this table only ever has one row. */
export const OIDC_CONFIG_SINGLETON_ID = 'singleton';

export interface EffectiveOidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  label: string;
  source: 'env' | 'db';
  /** SSO/OIDC Phase 2 JIT rule. Always off (`null`/`VIEWER`) for `source: 'env'` — env vars have no room for it. */
  jitDefaultWorkspaceId: string | null;
  jitDefaultRole: Role;
}

export interface OidcConfigWriteInput {
  enabled: boolean;
  issuerUrl: string | null;
  clientId: string | null;
  /** Pass `undefined` to keep the existing stored secret unchanged. */
  clientSecret?: string;
  label: string | null;
  /** SSO/OIDC Phase 2 — JIT provisioning. `null` = off. */
  jitDefaultWorkspaceId: string | null;
  jitDefaultRole: Role;
}

@Injectable()
export class OidcConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** The raw stored row, or null if never configured. Secret stays encrypted. */
  async getRawDbConfig() {
    return this.prisma.oidcConfig.findUnique({
      where: { id: OIDC_CONFIG_SINGLETON_ID },
    });
  }

  /**
   * The config actually used for login right now: env vars when all three
   * are set, otherwise the DB row (only when `enabled` and fully populated).
   * Returns null when SSO is off. Decrypts the secret only for internal use
   * (OidcService's token exchange) — never returned from this method to a
   * controller/DTO.
   */
  async getEffectiveConfig(): Promise<EffectiveOidcConfig | null> {
    const env = getOidcEnvConfig();
    if (env) {
      return {
        issuerUrl: env.issuerUrl,
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        label: getOidcButtonLabel(),
        source: 'env',
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
      };
    }

    const db = await this.getRawDbConfig();
    if (!db || !db.enabled || !db.issuerUrl || !db.clientId || !db.clientSecretEncrypted) {
      return null;
    }
    return {
      issuerUrl: db.issuerUrl,
      clientId: db.clientId,
      clientSecret: decryptOidcClientSecret(db.clientSecretEncrypted),
      label: db.label?.trim() || 'Single sign-on',
      source: 'db',
      jitDefaultWorkspaceId: db.jitDefaultWorkspaceId,
      jitDefaultRole: db.jitDefaultRole as Role,
    };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.getEffectiveConfig()) !== null;
  }

  /**
   * DTO for the admin settings GET / after a PATCH. Never leaks the secret —
   * `hasClientSecret` only. When env vars are present the DB row's contents
   * (if any) are irrelevant to the *effective* config, but we still report
   * `envManaged: true` so the UI renders the read-only banner instead of a
   * form that would silently save something env vars override anyway.
   */
  async toDto(): Promise<OidcConfigDto> {
    const env = getOidcEnvConfig();
    if (env) {
      return {
        envManaged: true,
        enabled: true,
        issuerUrl: env.issuerUrl,
        clientId: env.clientId,
        label: getOidcButtonLabel(),
        hasClientSecret: true,
        updatedAt: null,
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
      };
    }

    const db = await this.getRawDbConfig();
    return {
      envManaged: false,
      enabled: !!db?.enabled,
      issuerUrl: db?.issuerUrl ?? null,
      clientId: db?.clientId ?? null,
      label: db?.label?.trim() || 'Single sign-on',
      hasClientSecret: !!db?.clientSecretEncrypted,
      updatedAt: db?.updatedAt.toISOString() ?? null,
      jitDefaultWorkspaceId: db?.jitDefaultWorkspaceId ?? null,
      jitDefaultRole: (db?.jitDefaultRole as Role) ?? Role.VIEWER,
    };
  }

  /** Upsert the singleton row. Encrypts `clientSecret` when provided; leaves the stored secret untouched otherwise. */
  async upsert(input: OidcConfigWriteInput) {
    const clientSecretEncrypted =
      input.clientSecret !== undefined ? encryptOidcClientSecret(input.clientSecret) : undefined;

    const existing = await this.getRawDbConfig();

    if (!existing) {
      return this.prisma.oidcConfig.create({
        data: {
          id: OIDC_CONFIG_SINGLETON_ID,
          enabled: input.enabled,
          issuerUrl: input.issuerUrl,
          clientId: input.clientId,
          label: input.label,
          clientSecretEncrypted: clientSecretEncrypted ?? null,
          jitDefaultWorkspaceId: input.jitDefaultWorkspaceId,
          jitDefaultRole: input.jitDefaultRole,
        },
      });
    }

    return this.prisma.oidcConfig.update({
      where: { id: OIDC_CONFIG_SINGLETON_ID },
      data: {
        enabled: input.enabled,
        issuerUrl: input.issuerUrl,
        clientId: input.clientId,
        label: input.label,
        jitDefaultWorkspaceId: input.jitDefaultWorkspaceId,
        jitDefaultRole: input.jitDefaultRole,
        ...(clientSecretEncrypted !== undefined ? { clientSecretEncrypted } : {}),
      },
    });
  }
}
