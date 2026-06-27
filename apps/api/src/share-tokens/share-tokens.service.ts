import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectRole } from '../common/membership.util';
import { Role } from '@next-lane/shared';
import type { ShareTokenDto, CreateShareTokenResponse } from './dto/share-token.dto';

/** Prefix for every generated share token. */
export const SHARE_TOKEN_PREFIX = 'nls_';

/**
 * Generate a cryptographically-secure share token.
 * Format: "nls_" + 32 random bytes as base64url (no padding / + / / chars).
 */
export function generateShareToken(): string {
  const bytes = randomBytes(32);
  const b64url = bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${SHARE_TOKEN_PREFIX}${b64url}`;
}

/** SHA-256 hex digest of a raw share token value. */
export function hashShareToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function toDto(row: {
  id: string;
  projectId: string;
  createdById: string;
  createdAt: Date;
  revokedAt: Date | null;
}): ShareTokenDto {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ShareTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mint a new share token for a project. ADMIN-only (enforced here).
   *
   * Returns the raw token once — it is never stored, only its SHA-256 hash is
   * persisted. The caller must copy it immediately.
   */
  async create(
    userId: string,
    projectId: string,
  ): Promise<CreateShareTokenResponse> {
    // Only ADMINs may create share links.
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const rawToken = generateShareToken();
    const tokenHash = hashShareToken(rawToken);

    const record = await this.prisma.shareToken.create({
      data: { projectId, tokenHash, createdById: userId },
    });

    return {
      id: record.id,
      projectId: record.projectId,
      rawToken,
      createdAt: record.createdAt.toISOString(),
    };
  }

  /**
   * List all share tokens for a project (including revoked). ADMIN-only.
   * The raw token is never returned here.
   */
  async findAll(userId: string, projectId: string): Promise<ShareTokenDto[]> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);
    const rows = await this.prisma.shareToken.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  /**
   * Revoke (soft-delete) a share token. ADMIN-only.
   *
   * Returns 404 if the token does not exist or belongs to a different project
   * (to avoid leaking token IDs across projects).
   */
  async revoke(
    userId: string,
    projectId: string,
    tokenId: string,
  ): Promise<ShareTokenDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const token = await this.prisma.shareToken.findUnique({
      where: { id: tokenId },
    });
    if (!token || token.projectId !== projectId) {
      throw new NotFoundException('Share token not found.');
    }

    const updated = await this.prisma.shareToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    return toDto(updated);
  }

  /**
   * Validate a raw share token and return its projectId.
   *
   * Throws NotFoundException when the token is missing or revoked so we give
   * identical 404 responses to both invalid and revoked tokens (no oracle).
   */
  async validateToken(rawToken: string): Promise<{ projectId: string }> {
    const hash = hashShareToken(rawToken);
    const record = await this.prisma.shareToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!record || record.revokedAt !== null) {
      throw new NotFoundException('Share link not found or has been revoked.');
    }

    return { projectId: record.projectId };
  }
}
