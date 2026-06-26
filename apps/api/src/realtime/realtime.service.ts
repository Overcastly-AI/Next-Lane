import { Injectable } from '@nestjs/common';
import { RealtimeGateway, userRoom } from './realtime.gateway';

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  /** Emit an event to everyone subscribed to a project room. */
  emitToProject(projectId: string, event: string, payload: unknown): void {
    this.gateway.server.to(projectId).emit(event, payload);
  }

  /** Emit an event to a single user's private room (their notification feed). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.gateway.server.to(userRoom(userId)).emit(event, payload);
  }

  /** Emit an event to all connected clients. */
  emit(event: string, payload: unknown): void {
    this.gateway.server.emit(event, payload);
  }
}
