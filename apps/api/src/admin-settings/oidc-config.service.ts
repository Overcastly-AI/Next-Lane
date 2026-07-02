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
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { OidcConfigDto } from '@next-lane/shared';
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
}

export interface OidcConfigWriteInput {
  enabled: boolean;
  issuerUrl: string | null;
  clientId: string | null;
  /** Pass `undefined` to keep the existing stored secret unchanged. */
  clientSecret?: string;
  label: string | null;
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
        ...(clientSecretEncrypted !== undefined ? { clientSecretEncrypted } : {}),
      },
    });
  }
}
