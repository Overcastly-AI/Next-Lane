/**
 * Unit tests for RealtimeGateway.handleConnection — PAT + JWT authentication.
 *
 * All external dependencies (JwtService, PrismaService, ApiTokensService) are
 * hand-mocked so no real DB or Redis connection is needed.
 *
 * Covered scenarios:
 *   1. A valid PAT (`nlp_` prefix) is authenticated as its owning user.
 *   2. A revoked/expired PAT is rejected (socket disconnected).
 *   3. A normal JWT is still authenticated through the existing path.
 *   4. A garbage/unknown token (no `nlp_` prefix, not a valid JWT) is rejected.
 *   5. A missing token is rejected immediately.
 */

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { ApiTokensService } from '../api-tokens/api-tokens.service';
import type { PrismaService } from '../prisma/prisma.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER = { id: 'user-1', email: 'alice@example.com', name: 'Alice' };

/**
 * Build a minimal Socket stub.  Only the fields that `handleConnection` and
 * `extractToken` touch are required.
 */
function makeSocket(token: string | undefined): {
  id: string;
  handshake: { auth: Record<string, unknown>; query: Record<string, unknown> };
  data: Record<string, unknown>;
  disconnect: jest.Mock;
} {
  return {
    id: 'socket-abc',
    handshake: {
      auth: token !== undefined ? { token } : {},
      query: {},
    },
    data: {},
    disconnect: jest.fn(),
  };
}

/** Wait one microtask tick so that async PAT validation can settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ── Test setup ────────────────────────────────────────────────────────────────

function makeGateway({
  jwtVerify = jest.fn(),
  validateRawToken = jest.fn(),
}: {
  jwtVerify?: jest.Mock;
  validateRawToken?: jest.Mock;
} = {}): RealtimeGateway {
  const jwt = { verify: jwtVerify } as unknown as JwtService;

  // Only validateRawToken and isPat (static) are used in handleConnection.
  const apiTokens = {
    validateRawToken,
  } as unknown as ApiTokensService;

  const prisma = {} as unknown as PrismaService;

  return new RealtimeGateway(jwt, prisma, apiTokens, null, null);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RealtimeGateway — handleConnection', () => {
  describe('PAT authentication (nlp_ prefix)', () => {
    it('authenticates the socket as the token owner when the PAT is valid', async () => {
      const validateRawToken = jest.fn().mockResolvedValue(USER);
      const gateway = makeGateway({ validateRawToken });
      const client = makeSocket('nlp_valid_token');

      // handleConnection is sync but PAT path is async internally.
      gateway.handleConnection(client as never);
      await tick();

      expect(validateRawToken).toHaveBeenCalledWith('nlp_valid_token');
      expect(client.data.user).toEqual({ id: USER.id, email: USER.email });
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects the socket when the PAT is revoked', async () => {
      const validateRawToken = jest
        .fn()
        .mockRejectedValue(new UnauthorizedException('API token has been revoked.'));
      const gateway = makeGateway({ validateRawToken });
      const client = makeSocket('nlp_revoked_token');

      gateway.handleConnection(client as never);
      await tick();

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.user).toBeUndefined();
    });

    it('disconnects the socket when the PAT has expired', async () => {
      const validateRawToken = jest
        .fn()
        .mockRejectedValue(new UnauthorizedException('API token has expired.'));
      const gateway = makeGateway({ validateRawToken });
      const client = makeSocket('nlp_expired_token');

      gateway.handleConnection(client as never);
      await tick();

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.user).toBeUndefined();
    });

    it('disconnects the socket when the PAT does not exist in the DB', async () => {
      const validateRawToken = jest
        .fn()
        .mockRejectedValue(new UnauthorizedException('Invalid API token.'));
      const gateway = makeGateway({ validateRawToken });
      const client = makeSocket('nlp_unknown_token');

      gateway.handleConnection(client as never);
      await tick();

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('JWT authentication (existing path)', () => {
    it('authenticates the socket when the JWT is valid', () => {
      const payload = { sub: USER.id, email: USER.email };
      const jwtVerify = jest.fn().mockReturnValue(payload);
      const validateRawToken = jest.fn();
      const gateway = makeGateway({ jwtVerify, validateRawToken });
      const client = makeSocket('eyJhbGciOiJIUzI1NiJ9.valid.jwt');

      gateway.handleConnection(client as never);

      expect(jwtVerify).toHaveBeenCalledWith('eyJhbGciOiJIUzI1NiJ9.valid.jwt');
      expect(validateRawToken).not.toHaveBeenCalled();
      expect(client.data.user).toEqual({ id: USER.id, email: USER.email });
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects the socket when the JWT is invalid/expired', () => {
      const jwtVerify = jest.fn().mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const gateway = makeGateway({ jwtVerify });
      const client = makeSocket('eyJhbGciOiJIUzI1NiJ9.bad.jwt');

      gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.user).toBeUndefined();
    });
  });

  describe('garbage / missing token', () => {
    it('disconnects the socket when the token is missing entirely', () => {
      const jwtVerify = jest.fn();
      const gateway = makeGateway({ jwtVerify });
      const client = makeSocket(undefined);

      gateway.handleConnection(client as never);

      expect(jwtVerify).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects when the token is not a valid JWT and not nlp_-prefixed', () => {
      const jwtVerify = jest.fn().mockImplementation(() => {
        throw new Error('invalid signature');
      });
      const validateRawToken = jest.fn();
      const gateway = makeGateway({ jwtVerify, validateRawToken });
      const client = makeSocket('garbage_token_that_is_not_a_jwt');

      gateway.handleConnection(client as never);

      // Should try JWT verify (not PAT prefix) and fail.
      expect(jwtVerify).toHaveBeenCalled();
      expect(validateRawToken).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('token extraction', () => {
    it('prefers handshake.auth.token over query.token', () => {
      const payload = { sub: USER.id, email: USER.email };
      const jwtVerify = jest.fn().mockReturnValue(payload);
      const gateway = makeGateway({ jwtVerify });

      // Manually build a socket with BOTH auth.token and query.token set.
      const client = {
        id: 'socket-xyz',
        handshake: {
          auth: { token: 'auth-token-jwt' },
          query: { token: 'query-token-jwt' },
        },
        data: {},
        disconnect: jest.fn(),
      };

      gateway.handleConnection(client as never);

      // The auth token should have been used.
      expect(jwtVerify).toHaveBeenCalledWith('auth-token-jwt');
    });
  });
});
