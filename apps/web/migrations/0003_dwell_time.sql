-- 隐式行为追踪：停留时长
-- SQLite 不支持 IF NOT EXISTS for ALTER TABLE，用 try-catch 方式处理
-- 如果列已存在会报错但不影响后续 migration
ALTER TABLE user_states ADD COLUMN view_duration_ms INTEGER NOT NULL DEFAULT 0;
