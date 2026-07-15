import type { WsEvent } from '../../shared/types.js';
import type { WsGateway } from './gateway.js';

/**
 * M31: the broadcast surface consumed by services/indexers/routes. Pre-M31
 * they held the process-wide WsGateway; now they hold a per-project emitter,
 * so `file:changed`, `entity:indexed`, `plan:updated`, … reach only the
 * source project's room. Signature-compatible: `broadcast(event)`.
 */
export interface WsEmitter {
  broadcast(event: WsEvent): void;
}

export class ProjectWsEmitter implements WsEmitter {
  constructor(
    private readonly gateway: WsGateway,
    private readonly projectId: string,
  ) {}

  broadcast(event: WsEvent): void {
    this.gateway.broadcast(this.projectId, event);
  }
}
