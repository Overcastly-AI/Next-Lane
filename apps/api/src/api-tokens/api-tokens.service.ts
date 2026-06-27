import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateApiTokenDto, CreateApiTokenResponse, ApiTokenDto } from './dto/api-token.dto';

/** Prefix for every generated personal API token. */
export const PAT_PREFIX = 'nlp_';

/**
 * Generate a cryptographically-secure personal API token.
 * Format: "nlp_" + 32 random bytes as base64url (no padding / + / / chars).
 */
export function generateRawToken(): string {
  const bytes = randomBytes(32);
  // base64url: replace + → - and / → _, strip =
  const b64url = bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${PAT_PREFIX}${b64url}`;
}

/** SHA-256 hex digest of a raw token value. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function toDto(row: {
  id: string;
  name: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}): ApiTokenDto {
  return {
    id: row.id,
    name: row.name,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ApiTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new personal API token for `userId`.
   *
   * Returns the raw token once — it is never stored and cannot be retrieved
   * again. Only its SHA-256 hash is persisted.
   */
  async create(
    userId: string,
    dto: CreateApiTokenDto,
  ): Promise<CreateApiTokenResponse> {
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);

    const record = await this.prisma.apiToken.create({
      data: {
        userId,
        name: dto.name,
        tokenHash,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return {
      id: record.id,
      name: record.name,
      rawToken,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  /**
   * List all API tokens for `userId` — metadata only, never the token itself.
   * Returns tokens regardless of revocation/expiry so the user can see what
   * they've issued and revoke old ones.
   */
  async findAll(userId: string): Promise<ApiTokenDto[]> {
    const rows = await this.prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  /**
   * Revoke (soft-delete) a token by id.
   *
   * Only the owning user may revoke their own token — attempting to revoke
   * another user's token returns 404 (leaking no information about ownership).
   */
  async revoke(userId: string, tokenId: string): Promise<{ id: string }> {
    const token = await this.prisma.apiToken.findUnique({
      where: { id: tokenId },
    });

    if (!token || token.userId !== userId) {
      throw new NotFoundException('API token not found.');
    }

    await this.prisma.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    return { id: tokenId };
  }

  /**
   * Look up and validate a raw PAT.
   *
   * Used by the auth guard/strategy when it detects a "nlp_" prefix.
   * Returns the owning user record, or throws UnauthorizedException when:
   *   - The token does not exist in the DB,
   *   - The token has been revoked (revokedAt is non-null),
   *   - The token has expired (expiresAt is in the past).
   *
   * Bumps lastUsedAt asynchronously (fire-and-forget) to avoid adding latency
   * to the request path.
   */
  async validateRawToken(rawToken: string): Promise<{ id: string; email: string; name: string }> {
    const hash = hashToken(rawToken);

    const record = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hash },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });

    if (!record) {
      throw new UnauthorizedException('Invalid API token.');
    }
    if (record.revokedAt) {
      throw new UnauthorizedException('API token has been revoked.');
    }
    if (record.expiresAt && record.expiresAt < new Date()) {
      throw new UnauthorizedException('API token has expired.');
    }

    // Bump lastUsedAt asynchronously — do not await to avoid extra latency.
    void this.prisma.apiToken
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Non-critical; log nothing to avoid log spam.
      });

    return record.user;
  }

  /**
   * Guard helper: check if a raw bearer token looks like a PAT.
   * A PAT starts with the `nlp_` prefix; JWTs (base64url-encoded JWS) do not.
   */
  static isPat(rawBearer: string): boolean {
    return rawBearer.startsWith(PAT_PREFIX);
  }
}

export { ForbiddenException };
