import { Router } from 'express';
import type {
  CreateRunnerHostRequest,
  RemoveRunnerHostResponse,
  RunnerHostResponse,
  TestRunnerHostRequest,
  UpdateRunnerHostRequest,
} from '../../shared/runner-hosts.js';
import { RunnerHostError } from '../runner-hosts/host-input.js';
import type { RunnerHostSupervisor, RunnerHostView } from '../runner-hosts/supervisor.js';
import { nonNegativeInt, positiveInt } from './query-params.js';

export interface RunnerHostsRoutesDeps {
  /** The process's runner-host supervisor (M54 L10 `i58ogfc2`). */
  supervisor: RunnerHostSupervisor;
}

/** L4 `Paginacja`: `limit` + `offset`, 50 by default, 200 at most. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The record and the supervisor's state as `runner-host-response`. The token
 * leaves only as its mask (`isSet`, `last4`): the ciphertext is never copied
 * into the answer (`qc6t2y7m`).
 */
function toRunnerHostResponse({ record, state }: RunnerHostView): RunnerHostResponse {
  const isSet = record.tokenCiphertext !== '';
  return {
    id: record.id,
    url: record.url,
    label: record.label ?? null,
    token: { isSet, last4: isSet ? record.tokenLast4 : null },
    binding: record.binding
      ? {
          hostId: record.binding.hostId,
          hostName: record.binding.hostName,
          runnerVersion: record.binding.runnerVersion,
          startedAt: record.binding.startedAt,
        }
      : null,
    status: state.status,
    statusSince: state.statusSince,
    lastEventAt: state.lastEventAt,
    lastError: state.lastError ? { code: state.lastError.code, message: state.lastError.message } : null,
    restartedAt: state.restartedAt,
  };
}

function invalid(message: string): RunnerHostError {
  return new RunnerHostError('VALIDATION', message);
}

/**
 * The request body as an object with only `allowed` fields. A missing body (a
 * POST without one) reads as `{}`; anything else that is not a plain object, and
 * any field the DTO does not name, is a 400.
 */
function bodyOf(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw invalid('body: must be a JSON object');
  const body = raw as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw invalid(`body: unknown field(s): ${unknown.join(', ')}`);
  return body;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalid(`${field}: must be a string`);
  return value;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = optionalString(body, field);
  if (value === undefined) throw invalid(`${field}: is required`);
  return value;
}

/** DTO `create-runner-host-request`; the url and token rules run in the store. */
function parseCreate(raw: unknown): CreateRunnerHostRequest {
  const body = bodyOf(raw, ['url', 'token', 'label']);
  const label = optionalString(body, 'label');
  return {
    url: requiredString(body, 'url'),
    token: requiredString(body, 'token'),
    ...(label !== undefined ? { label } : {}),
  };
}

/**
 * DTO `update-runner-host-request`: a field left out stays; an empty token (after
 * the trim the token rule applies anyway) means "no change", so it never reaches
 * the store — whose token rule therefore runs only on a non-empty one.
 */
function parseUpdate(raw: unknown): UpdateRunnerHostRequest {
  const body = bodyOf(raw, ['url', 'token', 'label']);
  const url = optionalString(body, 'url');
  const token = optionalString(body, 'token');
  const label = optionalString(body, 'label');
  return {
    ...(url !== undefined ? { url } : {}),
    ...(token !== undefined && token.trim() !== '' ? { token } : {}),
    ...(label !== undefined ? { label } : {}),
  };
}

/** DTO `test-runner-host-request`. */
function parseTest(raw: unknown): TestRunnerHostRequest {
  const body = bodyOf(raw, ['rebind']);
  const rebind = body.rebind;
  if (rebind !== undefined && typeof rebind !== 'boolean') throw invalid('rebind: must be a boolean');
  return rebind !== undefined ? { rebind } : {};
}

/**
 * M54 L4 (`pyxt16pa`, 2.1.62): the runner hosts of the workspace this process
 * serves — `własny router: /api/workspace/runner-hosts`, with no project prefix
 * (the subject is the workspace, M31 `m31l4001`). Mounted at that path before
 * the project dispatch.
 *
 * The list is the supervisor's memory: it sends nothing to any host and reads
 * no file. Add, change and test answer with the attempt's outcome as `status`
 * (201 / 200), never as a route error; the route errors are 400 VALIDATION,
 * 404 NOT_FOUND and 409 RUNNER_HOST_DUPLICATE (`RunnerHostError`, rendered by
 * the layer's `errorHandler`).
 */
export function runnerHostsRouter({ supervisor }: RunnerHostsRoutesDeps): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const rawLimit = req.query.limit;
      const rawOffset = req.query.offset;
      const limit = rawLimit === undefined ? DEFAULT_LIMIT : positiveInt(rawLimit);
      const offset = rawOffset === undefined ? 0 : nonNegativeInt(rawOffset);
      if (limit === undefined || limit > MAX_LIMIT) throw invalid(`limit: must be an integer from 1 to ${MAX_LIMIT}`);
      if (offset === undefined) throw invalid('offset: must be a non-negative integer');
      const all = supervisor.list();
      const data: RunnerHostResponse[] = all.slice(offset, offset + limit).map(toRunnerHostResponse);
      res.json({ data, total: all.length });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const view = await supervisor.add(parseCreate(req.body));
      const data: RunnerHostResponse = toRunnerHostResponse(view);
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const view = await supervisor.update(req.params.id, parseUpdate(req.body));
      const data: RunnerHostResponse = toRunnerHostResponse(view);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/test', async (req, res, next) => {
    try {
      const view = await supervisor.test(req.params.id, parseTest(req.body));
      const data: RunnerHostResponse = toRunnerHostResponse(view);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      supervisor.remove(req.params.id);
      const data: RemoveRunnerHostResponse = { id: req.params.id };
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
