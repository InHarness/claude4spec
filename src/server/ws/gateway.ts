import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WsEvent } from '../../shared/types.js';

/**
 * Does this workspace know the project? Injected rather than imported: the
 * gateway is built before any registry lookup is bound (see `startServer`), and
 * membership must be re-read per upgrade — a project registered while the
 * process runs has to become connectable without a restart.
 */
export type ProjectIsRegistered = (projectId: string) => boolean;

/**
 * M31: per-project rooms. Clients connect with `/ws?project=<id>` (the SPA
 * reads the id from `window.__C4S_PROJECT__`); a missing/empty param is
 * refused — there is no process-wide broadcast channel anymore.
 *
 * The id is a TRANSPORT ADDRESS here, exactly as in the `/api/projects/:id`
 * prefix: resolved by id alone, never by display name. The upgrade used to
 * accept any non-empty string and open a room for it, which made the same key
 * mean two different things on two transports — HTTP answered
 * `404 PROJECT_NOT_IN_WORKSPACE` for a project this channel happily served. It
 * was harmless only because rooms are written to exclusively by services that
 * already hold a context, i.e. by accident of who emits rather than by the
 * check that was missing.
 */
export class WsGateway {
  private wss: WebSocketServer;
  private rooms = new Map<string, Set<WebSocket>>();

  constructor(server: HttpServer, isRegistered?: ProjectIsRegistered) {
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      if (url.pathname !== '/ws') return;
      const projectId = url.searchParams.get('project');
      if (!projectId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      /**
       * Rejected at UPGRADE with an HTTP status, not accepted and then closed
       * with a WS code — the same shape as the missing-param case just above,
       * which is this file's only precedent. `404` rather than `400` because
       * the request is well-formed and the project is simply not here, which is
       * the distinction `PROJECT_NOT_IN_WORKSPACE` draws on the HTTP side.
       */
      if (isRegistered && !isRegistered(projectId)) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        let room = this.rooms.get(projectId);
        if (!room) {
          room = new Set<WebSocket>();
          this.rooms.set(projectId, room);
        }
        room.add(ws);
        ws.on('close', () => {
          room.delete(ws);
          if (room.size === 0) this.rooms.delete(projectId);
        });
        this.send(ws, { kind: 'hello', ts: Date.now() });
      });
    });
  }

  broadcast(projectId: string, event: WsEvent): void {
    const room = this.rooms.get(projectId);
    if (!room) return;
    const payload = JSON.stringify(event);
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  /**
   * M31 dispose: notify the room its project context is gone, then close all
   * sockets. The SPA reacts to `project:disposed` (e.g. full reload).
   */
  closeRoom(projectId: string): void {
    const room = this.rooms.get(projectId);
    if (!room) return;
    const payload = JSON.stringify({ kind: 'project:disposed' satisfies WsEvent['kind'] });
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
      ws.close();
    }
    this.rooms.delete(projectId);
  }

  private send(ws: WebSocket, event: WsEvent): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  }

  async close(): Promise<void> {
    for (const room of this.rooms.values()) {
      for (const ws of room) ws.close();
    }
    this.rooms.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
