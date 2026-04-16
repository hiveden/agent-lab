-- Session metadata: config_prompt + result_summary
ALTER TABLE chat_sessions ADD COLUMN config_prompt TEXT;
ALTER TABLE chat_sessions ADD COLUMN result_summary TEXT;
