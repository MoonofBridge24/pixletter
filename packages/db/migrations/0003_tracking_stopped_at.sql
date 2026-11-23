-- Per-email tracking stop: manual stop from the dashboard.
-- NULL = tracking active (still subject to the automatic TTL).
ALTER TABLE `emails` ADD COLUMN `tracking_stopped_at` integer;
