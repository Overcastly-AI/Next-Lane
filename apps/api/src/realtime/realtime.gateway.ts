import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
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

/** Authenticated user attached to the socket after a valid handshake. */
interface SocketUser {
  id: string;
  email: string;
}

/** Private per-user room name. Only the user themself may join it. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

@WebSocketGateway({ cors: true })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
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
   * Authenticate every socket at handshake time. The client passes its JWT in
   * `handshake.auth.token` (preferred) or `?token=` query. Unauthenticated
   * sockets are disconnected so they can never subscribe to any room.
   */
  handleConnection(client: Socket): void {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(`Rejecting socket ${client.id}: missing token`);
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user: SocketUser = { id: payload.sub, email: payload.email };
      client.data.user = user;
    } catch {
      this.logger.warn(`Rejecting socket ${client.id}: invalid token`);
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
    try {
      await assertProjectMember(this.prisma, user.id, projectId);
    } catch {
      throw new WsException('Forbidden');
    }
    await client.join(projectId);
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
