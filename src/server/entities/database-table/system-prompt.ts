import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const databaseTableSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Database Tables',
  countStat: {
    placeholder: 'databaseTableCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM database_table',
    label: 'tables',
  },
  mcpToolsLine:
    'database-tools: create_database_table, get_database_table, update_database_table, delete_database_table, list_database_tables',
  narrativeBlock:
    'Relational tables (dialect-agnostic) — columns (type, nullable, unique, pk, fk, default, enumValues), indexes, tags.',
};
