import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsException,
} from '@nestjs/websockets';
import { Inject, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import type { JwtPayload } from '../auth/jwt.strategy';
import { REDIS_PUB_CLIENT, REDIS_SUB_CLIENT } from '../redis/redis.module';
import { ApiTokensService } from '../api-tokens/api-tokens.service';
import type { PresenceViewer } from '@next-lane/shared';
import { SocketEvents } from '@next-lane/shared';

/** Authenticated user attached to the socket after a valid handshake. */
interface SocketUser {
  id: string;
  email: string;
}

/** Enriched user info stored in presence (from DB at subscribe time). */
interface PresenceUserInfo {
  id: string;
  name: string;
  avatarColor: string;
}

/** Private per-user room name. Only the user themself may join it. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Workspace-scoped broadcast room name — mirrors `userRoom`'s `<kind>:<id>`
 * convention (the project room, by contrast, is the bare `projectId` string
 * with no prefix, for historical reasons predating this convention). Used by
 * `RealtimeService.emitToWorkspace` for events with no owning project (e.g.
 * a workspace-level `Page`, `projectId: null`). There is deliberately no
 * `subscribe:workspace` handler yet — no client currently needs to JOIN this
 * room, only the pages service emits to it ahead of the frontend slice that
 * will add a `workspace-docs` view and subscribe to it.
 */
export function workspaceRoom(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

/**
 * In-memory per-project presence store.
 *
 * Maps projectId → Map<userId, PresenceViewer>.
 *
 * NOTE: This is intentionally single-node only. In a multi-replica deployment
 * each replica maintains its own map. Full cross-replica presence would require
 * a Redis pub/sub fan-out layer on top of the existing Redis adapter — a
 * follow-up for when horizontal scaling is needed.
 */
type ProjectPresenceMap = Map<string, Map<string, PresenceViewer>>;

/**
 * Tracks which projectId(s) a socket has subscribed to so we can evict it
 * from the presence map when the socket disconnects.
 */
type SocketProjectsMap = Map<string, Set<string>>;

// Parse CORS_ORIGINS the same way main.ts does. In production with an
// allowlist set, restrict to it; otherwise keep the dev default (allow all).
const _corsOrigins = process.env.CORS_ORIGINS;
const _wsCorsOption: boolean | { origin: string[]; credentials: true } =
  _corsOrigins
    ? {
        origin: _corsOrigins
          .split(',')
          .map((o) => o.trim())
          .filter((o) => o.length > 0),
        credentials: true,
      }
    : true;

@WebSocketGateway({ cors: _wsCorsOption })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  /** projectId → (userId → viewer info) */
  private readonly presence: ProjectPresenceMap = new Map();

  /** socketId → Set<projectId> the socket has joined */
  private readonly socketProjects: SocketProjectsMap = new Map();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly apiTokens: ApiTokensService,
    @Optional() @Inject(REDIS_PUB_CLIENT) private readonly pubClient: Redis | null,
    @Optional() @Inject(REDIS_SUB_CLIENT) private readonly subClient: Redis | null,
  ) {}

  /**
   * Attach the Redis adapter when REDIS_URL is configured.
   * Falls back to the default in-memory adapter when Redis is absent.
   */
  afterInit(server: Server): void {
    if (this.pubClient && this.subClient) {
      server.adapter(createAdapter(this.pubClient, this.subClient));
      this.logger.log('Socket.io Redis adapter attached (multi-replica mode)');
    } else {
      this.logger.log(
        'Socket.io using in-memory adapter (REDIS_URL not set; single-node mode)',
      );
    }
  }

  /**
   * Authenticate every socket at handshake time. The client passes its JWT or
   * PAT in `handshake.auth.token` (preferred) or `?token=` query.
   *
   * When the token starts with the `nlp_` PAT prefix it is validated through
   * `ApiTokensService.validateRawToken()` — the same code path the REST
   * JwtAuthGuard uses for PAT bearer tokens.  Invalid, revoked, or expired PATs
   * are disconnected immediately.  All other tokens are verified as JWTs via the
   * existing path.  Unauthenticated sockets are disconnected so they can never
   * subscribe to any room.
   */
  handleConnection(client: Socket): void {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(`Rejecting socket ${client.id}: missing token`);
      client.disconnect(true);
      return;
    }

    if (ApiTokensService.isPat(token)) {
      // PAT path — async validation; we must void the promise and handle
      // rejection ourselves because handleConnection is called synchronously
      // by Socket.io but the DB lookup is async.
      void this.authenticateWithPat(client, token);
    } else {
      // JWT path — synchronous verification.
      try {
        const payload = this.jwt.verify<JwtPayload>(token);
        const user: SocketUser = { id: payload.sub, email: payload.email };
        client.data.user = user;
      } catch {
        this.logger.warn(`Rejecting socket ${client.id}: invalid JWT`);
        client.disconnect(true);
      }
    }
  }

  /**
   * When a socket disconnects (normally or due to network drop), remove it from
   * every project presence set it had joined and broadcast updated viewer lists.
   */
  handleDisconnect(client: Socket): void {
    const projects = this.socketProjects.get(client.id);
    if (!projects || projects.size === 0) {
      this.socketProjects.delete(client.id);
      return;
    }

    const user = client.data.user as SocketUser | undefined;
    for (const projectId of projects) {
      this.removeFromPresence(projectId, user?.id);
      this.broadcastPresence(projectId);
    }
    this.socketProjects.delete(client.id);
  }

  /**
   * Async PAT validation called from `handleConnection`.
   *
   * Resolves the owning user from the DB, attaches it to `client.data.user`,
   * and disconnects the socket on any validation failure (revoked, expired,
   * unknown token, or DB error).
   */
  private async authenticateWithPat(client: Socket, rawToken: string): Promise<void> {
    try {
      const user = await this.apiTokens.validateRawToken(rawToken);
      client.data.user = { id: user.id, email: user.email } satisfies SocketUser;
    } catch {
      this.logger.warn(`Rejecting socket ${client.id}: invalid/revoked/expired PAT`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() projectId: string,
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean }> {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      throw new WsException('Unauthorized');
    }
    if (typeof projectId !== 'string' || projectId.length === 0) {
      throw new WsException('Invalid projectId');
    }
    // Authorize: the user must be a member of the workspace owning the project
    // before they can join the room and receive its issue.*/comment.* events.
    let userInfo: PresenceUserInfo;
    try {
      await assertProjectMember(this.prisma, user.id, projectId);
      // Fetch the enriched user info needed for presence display.
      const dbUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, name: true, avatarColor: true },
      });
      if (!dbUser) throw new Error('User not found');
      userInfo = dbUser;
    } catch {
      throw new WsException('Forbidden');
    }
    await client.join(projectId);

    // Track which projects this socket has joined.
    if (!this.socketProjects.has(client.id)) {
      this.socketProjects.set(client.id, new Set());
    }
    this.socketProjects.get(client.id)!.add(projectId);

    // Add to presence and broadcast updated viewer list.
    this.addToPresence(projectId, userInfo);
    this.broadcastPresence(projectId);

    return { ok: true };
  }

  /**
   * Explicit unsubscribe: client leaves the project room and is removed from
   * presence. Useful for SPAs that navigate away without disconnecting the socket.
   */
  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @MessageBody() projectId: string,
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean }> {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      throw new WsException('Unauthorized');
    }
    if (typeof projectId !== 'string' || projectId.length === 0) {
      throw new WsException('Invalid projectId');
    }

    await client.leave(projectId);

    // Remove from socket-projects tracking.
    this.socketProjects.get(client.id)?.delete(projectId);

    // Remove from presence and broadcast.
    this.removeFromPresence(projectId, user.id);
    this.broadcastPresence(projectId);

    return { ok: true };
  }

  /**
   * Join the caller's OWN private room (`user:<id>`) so they receive personal
   * notifications live. Authorization is implicit and strict: we always derive
   * the room from the socket's authenticated JWT user — never from a
   * client-supplied id — so a socket can only ever subscribe to itself.
   */
  @SubscribeMessage('subscribe:user')
  handleSubscribeUser(
    @ConnectedSocket() client: Socket,
  ): { ok: boolean } {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      throw new WsException('Unauthorized');
    }
    void client.join(userRoom(user.id));
    return { ok: true };
  }

  // ── Presence helpers ────────────────────────────────────────────────────────

  private addToPresence(projectId: string, userInfo: PresenceUserInfo): void {
    if (!this.presence.has(projectId)) {
      this.presence.set(projectId, new Map());
    }
    const viewer: PresenceViewer = {
      userId: userInfo.id,
      name: userInfo.name,
      avatarColor: userInfo.avatarColor,
    };
    this.presence.get(projectId)!.set(userInfo.id, viewer);
  }

  private removeFromPresence(projectId: string, userId: string | undefined): void {
    if (!userId) return;
    const map = this.presence.get(projectId);
    if (!map) return;
    map.delete(userId);
    // Prune the empty project entry to avoid unbounded growth.
    if (map.size === 0) {
      this.presence.delete(projectId);
    }
  }

  private broadcastPresence(projectId: string): void {
    const map = this.presence.get(projectId);
    const viewers: PresenceViewer[] = map ? Array.from(map.values()) : [];
    this.server.to(projectId).emit(SocketEvents.PresenceUpdate, {
      projectId,
      viewers,
    });
  }

  /**
   * Expose the current viewer list for a project (used in tests + health checks).
   */
  getPresence(projectId: string): PresenceViewer[] {
    const map = this.presence.get(projectId);
    return map ? Array.from(map.values()) : [];
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }
    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken;
    }
    return undefined;
  }
}
