-- Server酱³ push: per-user SendKey set from the Chrome extension.
-- Replaces the unused Slack webhook column usage in application code.
ALTER TABLE `users` ADD COLUMN `serverchan_sendkey` text;
