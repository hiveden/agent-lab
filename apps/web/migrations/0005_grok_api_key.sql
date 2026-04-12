-- Grok API Key 加密存储
ALTER TABLE llm_settings ADD COLUMN grok_api_key_encrypted TEXT;
