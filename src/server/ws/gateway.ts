import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WsEvent } from '../../shared/types.js';

/**
 * M31: per-project rooms. Clients connect with `/ws?project=<id>` (the SPA
 * reads the id from `window.__C4S_PROJECT__`); a missing/empty param is
 * refused — there is no process-wide broadcast channel anymore.
 */
export class WsGateway {
  private wss: WebSocketServer;
  private rooms = new Map<string, Set<WebSocket>>();

  constructor(server: HttpServer) {
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
