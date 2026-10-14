import type { WatchBroadcaster, WatchScope } from '../fs/watcher.js';
import type { WsEvent } from '../../shared/types.js';
import type { WsGateway } from './gateway.js';

/** The slice of `WsGateway` the M40 broadcaster routes onto. */
export type RoomGateway = Pick<WsGateway, 'broadcast' | 'broadcastToEveryRoom'>;

/**
 * M40 (`kc23agex`) → M49 (`l4wsroom`): the broadcast MECHANISM of the process-wide
 * file-watch runtime, routed by the mount's scope.
 *
 * - `context:<projectId>#<instance>` — the room of the project owning that
 *   context (the instance suffix keeps two live contexts of one project apart;
 *   the ROOM is still the project);
 * - `process` — a mount watching a resource shared by every project (the base
 *   plugin pool): the room of EVERY project of the process, each separately.
 *
 * M40 routes; it never authors an event — each owner constructs its own.
 */
export function createRoomBroadcaster(gateway: RoomGateway): WatchBroadcaster {
  return {
    broadcast(scope: WatchScope, event: WsEvent): void {
      if (scope === 'process') {
        gateway.broadcastToEveryRoom(event);
        return;
      }
      gateway.broadcast(scope.slice('context:'.length).split('#')[0]!, event);
    },
  };
}
