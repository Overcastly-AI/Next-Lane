/**
 * Unit tests for RealtimeGateway — PAT + JWT authentication and presence tracking.
 *
 * All external dependencies (JwtService, PrismaService, ApiTokensService) are
 * hand-mocked so no real DB or Redis connection is needed.
 *
 * Covered scenarios:
 *   Authentication:
 *   1. A valid PAT (`nlp_` prefix) is authenticated as its owning user.
 *   2. A revoked/expired PAT is rejected (socket disconnected).
 *   3. A normal JWT is still authenticated through the existing path.
 *   4. A garbage/unknown token (no `nlp_` prefix, not a valid JWT) is rejected.
 *   5. A missing token is rejected immediately.
 *   Token extraction:
 *   6. Prefers handshake.auth.token over query.token.
 *   Presence tracking:
 *   7. handleSubscribe adds the user to the project presence map and broadcasts.
 *   8. handleDisconnect removes the user from presence and broadcasts.
 *   9. handleUnsubscribe removes the user from presence and broadcasts.
 *  10. A user subscribing to a second project is tracked independently.
 *  11. Presence map is pruned when the last viewer leaves.
 *  12. handleDisconnect with no projects tracked is a no-op.
 */

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { ApiTokensService } from '../api-tokens/api-tokens.service';
import type { PrismaService } from '../prisma/prisma.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER = {
  id: 'user-1',
  email: 'alice@example.com',
  name: 'Alice',
  avatarColor: '#3b82f6',
};

/**
 * Build a minimal Socket stub. Only the fields that `handleConnection`,
 * `handleSubscribe`, `handleUnsubscribe`, and `handleDisconnect` touch are
 * required.
 */
function makeSocket(token: string | undefined, socketId = 'socket-abc'): {
  id: string;
  handshake: { auth: Record<string, unknown>; query: Record<string, unknown> };
  data: Record<string, unknown>;
  disconnect: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
} {
  return {
    id: socketId,
    handshake: {
      auth: token !== undefined ? { token } : {},
      query: {},
    },
    data: {},
    disconnect: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
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
  prismaUser = jest.fn().mockResolvedValue(USER),
}: {
  jwtVerify?: jest.Mock;
  validateRawToken?: jest.Mock;
  prismaUser?: jest.Mock;
} = {}): RealtimeGateway & { _server: { to: jest.Mock; emit: jest.Mock } } {
  const jwt = { verify: jwtVerify } as unknown as JwtService;

  // Only validateRawToken and isPat (static) are used in handleConnection.
  const apiTokens = {
    validateRawToken,
  } as unknown as ApiTokensService;

  // assertProjectMember needs project.findUnique + membership.findUnique.
  const prisma = {
    user: {
      findUnique: prismaUser,
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: 'project-abc', workspaceId: 'ws-1' }),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER', workspaceId: 'ws-1' }),
    },
  } as unknown as PrismaService;

  const gateway = new RealtimeGateway(jwt, prisma, apiTokens, null, null);

  // Attach a mock server with an emit spy so we can verify presence broadcasts.
  const emitSpy = jest.fn();
  const serverMock = {
    to: jest.fn().mockReturnValue({ emit: emitSpy }),
    emit: emitSpy,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gateway as any).server = serverMock;

  return Object.assign(gateway, { _server: serverMock }) as RealtimeGateway & { _server: { to: jest.Mock; emit: jest.Mock } };
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
        join: jest.fn().mockResolvedValue(undefined),
        leave: jest.fn().mockResolvedValue(undefined),
      };

      gateway.handleConnection(client as never);

      // The auth token should have been used.
      expect(jwtVerify).toHaveBeenCalledWith('auth-token-jwt');
    });
  });
});

// ── Presence tracking ─────────────────────────────────────────────────────────

describe('RealtimeGateway — presence tracking', () => {
  const PROJECT_ID = 'project-abc';

  function makeAuthedSocket(userId = USER.id, socketId = 'sock-1') {
    const sock = makeSocket('eyJ.valid.jwt', socketId);
    sock.data.user = { id: userId, email: `${userId}@example.com` };
    return sock;
  }

  it('adds viewer to presence on subscribe and broadcasts presence.update', async () => {
    const gateway = makeGateway();
    const client = makeAuthedSocket();

    await gateway.handleSubscribe(PROJECT_ID, client as never);

    const viewers = gateway.getPresence(PROJECT_ID);
    expect(viewers).toHaveLength(1);
    expect(viewers[0]).toMatchObject({ userId: USER.id, name: USER.name });

    // Presence broadcast should have been sent to the project room.
    expect(gateway._server.to).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('removes viewer from presence on handleDisconnect and broadcasts', async () => {
    const gateway = makeGateway();
    const client = makeAuthedSocket();

    await gateway.handleSubscribe(PROJECT_ID, client as never);
    expect(gateway.getPresence(PROJECT_ID)).toHaveLength(1);

    gateway.handleDisconnect(client as never);

    expect(gateway.getPresence(PROJECT_ID)).toHaveLength(0);
    // to() should have been called at least once for the disconnect broadcast.
    expect(gateway._server.to).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('removes viewer from presence on handleUnsubscribe and broadcasts', async () => {
    const gateway = makeGateway();
    const client = makeAuthedSocket();

    await gateway.handleSubscribe(PROJECT_ID, client as never);
    expect(gateway.getPresence(PROJECT_ID)).toHaveLength(1);

    await gateway.handleUnsubscribe(PROJECT_ID, client as never);

    expect(gateway.getPresence(PROJECT_ID)).toHaveLength(0);
  });

  it('tracks two viewers independently in the same project', async () => {
    const user2 = { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatarColor: '#ef4444' };
    const prismaUser = jest
      .fn()
      .mockResolvedValueOnce(USER)
      .mockResolvedValueOnce(user2);
    const gateway = makeGateway({ prismaUser });

    const client1 = makeAuthedSocket(USER.id, 'sock-1');
    const client2 = makeSocket('eyJ.valid.jwt', 'sock-2');
    client2.data.user = { id: user2.id, email: user2.email };

    await gateway.handleSubscribe(PROJECT_ID, client1 as never);
    await gateway.handleSubscribe(PROJECT_ID, client2 as never);

    const viewers = gateway.getPresence(PROJECT_ID);
    expect(viewers).toHaveLength(2);
    expect(viewers.map((v) => v.userId)).toContain(USER.id);
    expect(viewers.map((v) => v.userId)).toContain(user2.id);
  });

  it('prunes the presence map when the last viewer leaves', async () => {
    const gateway = makeGateway();
    const client = makeAuthedSocket();

    await gateway.handleSubscribe(PROJECT_ID, client as never);
    gateway.handleDisconnect(client as never);

    // The internal map should not retain an empty entry.
    expect(gateway.getPresence(PROJECT_ID)).toHaveLength(0);
  });

  it('disconnect with no subscribed projects is a no-op', () => {
    const gateway = makeGateway();
    const client = makeAuthedSocket();
    // Disconnect without ever subscribing — should not throw.
    expect(() => gateway.handleDisconnect(client as never)).not.toThrow();
  });

  it('tracks a socket subscribed to multiple projects', async () => {
    const PROJECT_B = 'project-xyz';
    const prismaUser = jest.fn().mockResolvedValue(USER);
    const gateway = makeGateway({ prismaUser });
    const client = makeAuthedSocket();

    await gateway.handleSubscribe(PROJECT_ID, client as never);
    await gateway.handleSubscribe(PROJECT_B, client as never);

    expect(gateway.getPresence(PROJECT_ID)).toHaveLength(1);
    expect(gateway.getPresence(PROJECT_B)).toHaveLength(1);

    // Disconnecting should remove from BOTH projects.
    gateway.handleDisconnect(client as never);

    expect(gateway.getPresence(PROJECT_ID)).toHaveLength(0);
    expect(gateway.getPresence(PROJECT_B)).toHaveLength(0);
  });
});
