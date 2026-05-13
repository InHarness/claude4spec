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
    'Relational tables, dialect-agnostic. Columns: name/type/nullable/unique/pk/fk/default/enumValues. Indexes: columns/unique/name. Linked to DTOs/endpoints via shared tags (tagged_list_mixed) — no direct junction.',
};
