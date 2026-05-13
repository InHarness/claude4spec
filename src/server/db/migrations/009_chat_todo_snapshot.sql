-- M05 extension: persistent snapshot of the main-agent TODO list per thread.
-- Populated from the `todo_list_updated` runtime event (isSubagent=false only).

ALTER TABLE chat_thread ADD COLUMN current_todo_items TEXT;
