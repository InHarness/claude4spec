import { z } from 'zod';

/**
 * mcp-tool `run-tools-get-run` and `run-tools-cancel-run` — the wire contracts
 * of `get_run` and `cancel_run`, verbatim from the records. Shared by the
 * catalog rows (`core-operations.ts`) and the `run-tools` server.
 */
export const RUN_ID_INPUT_SCHEMA = {
  runId: z.string().describe('Id returned by run_remote.'),
};

export const GET_RUN_DESCRIPTION =
  'Reports the state of a Run ordered earlier with run_remote: state, outcome, reason and the handoff when there is one — never logs. When the Run left a result, tells in which projects its shadow can be reviewed in Releases → Shadows, or that the shadow is already accepted. Use it when the user asks how a Run is doing.';

export const CANCEL_RUN_DESCRIPTION =
  'Cancels a Run ordered earlier with run_remote. Use it only when the user asks to stop the Run. Cancelling a Run that has already finished changes nothing and reports the Run as it is.';

/** spec-operation `get-run`, `podsumowanie`. */
export const GET_RUN_SUMMARY = 'Podaje zwięzły stan Runu zleconego wcześniej i drogę do jego cienia w Releases → Shadows.';

/** spec-operation `cancel-run`, `podsumowanie`. */
export const CANCEL_RUN_SUMMARY = 'Anuluje Run zlecony wcześniej; Run już zakończony wraca bez zmian.';
