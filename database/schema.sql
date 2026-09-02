-- database/schema.sql
--
-- Generated from the live production schema, not written by hand. This file is
-- only ever applied when the MariaDB container initialises from an empty data
-- directory (database/dockerfile copies it to /docker-entrypoint-initdb.d/),
-- so it never touches a running database and editing it alone changes nothing
-- in production. A column added here still needs its own idempotent script in
-- backend/scripts/, chained into release_command in fly.toml.
--
-- It had drifted badly. reviews declared a user_id column the live table has
-- never had, which made every song share card fail: the Open Graph query
-- joined on it, threw 1054, and the catch turned that into "no metadata", so
-- crawlers got a bare page. Sixteen tables were missing outright and nine more
-- were missing columns. A database built from the old file could not have run
-- the app.
--
-- To regenerate, dump SHOW CREATE TABLE for every table from production and
-- rerun the reconcile. AUTO_INCREMENT counters are stripped; CREATE TABLE IF
-- NOT EXISTS is restored; foreign key checks are disabled around the whole
-- file so table order does not matter.

CREATE DATABASE IF NOT EXISTS internetdj;
USE internetdj;

-- Tables are emitted alphabetically, so a foreign key can reference a table
-- that does not exist yet. Turning the check off for the duration is simpler
-- and less fragile than maintaining a hand-sorted dependency order.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `articles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(220) NOT NULL,
  `title` varchar(300) NOT NULL,
  `deck` varchar(600) DEFAULT NULL,
  `body_html` mediumtext DEFAULT NULL,
  `body_text` mediumtext DEFAULT NULL,
  `category` varchar(80) DEFAULT NULL,
  `category_slug` varchar(80) DEFAULT NULL,
  `author_name` varchar(120) DEFAULT NULL,
  `profile_id` int(11) DEFAULT NULL,
  `hero_image_url` varchar(500) DEFAULT NULL,
  `published_at` date DEFAULT NULL,
  `status` enum('draft','submitted','published','deleted') NOT NULL DEFAULT 'published',
  `is_legacy` tinyint(1) NOT NULL DEFAULT 0,
  `legacy_story_id` int(11) DEFAULT NULL,
  `source_url` varchar(600) DEFAULT NULL,
  `archived_at` varchar(20) DEFAULT NULL,
  `views` int(11) NOT NULL DEFAULT 0,
  `submitted_at` timestamp NULL DEFAULT NULL,
  `editor_note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_article_slug` (`slug`),
  KEY `idx_article_category` (`category_slug`,`published_at`),
  KEY `idx_article_published` (`status`,`published_at`),
  KEY `idx_article_legacy` (`legacy_story_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `coin_events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profile_id` int(11) NOT NULL,
  `activity_type` varchar(50) NOT NULL,
  `source_id` varchar(100) NOT NULL,
  `coins` int(11) NOT NULL,
  `metadata` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_profile_activity_source` (`profile_id`,`activity_type`,`source_id`),
  KEY `idx_profile` (`profile_id`),
  KEY `idx_activity` (`activity_type`),
  CONSTRAINT `coin_events_ibfk_1` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `collaborations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profile_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `is_public` tinyint(1) DEFAULT 0,
  `allow_uploads` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_profile_id` (`profile_id`),
  CONSTRAINT `fk_collaborations_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `collaboration_invitations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `collaboration_id` int(11) NOT NULL,
  `email` varchar(255) NOT NULL,
  `token` varchar(100) NOT NULL,
  `status` enum('pending','accepted','declined','removed') DEFAULT 'pending',
  `invited_at` timestamp NULL DEFAULT current_timestamp(),
  `accepted_at` timestamp NULL DEFAULT NULL,
  `can_upload` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_email_collaboration` (`collaboration_id`,`email`),
  KEY `idx_token` (`token`),
  CONSTRAINT `fk_invitations_collaboration_id` FOREIGN KEY (`collaboration_id`) REFERENCES `collaborations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `collaboration_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `collaboration_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  `can_view` tinyint(1) DEFAULT 1,
  `can_upload` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_collaboration_profile` (`collaboration_id`,`profile_id`),
  KEY `fk_permissions_profile_id` (`profile_id`),
  CONSTRAINT `fk_permissions_collaboration_id` FOREIGN KEY (`collaboration_id`) REFERENCES `collaborations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_permissions_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `collaboration_tracks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `collaboration_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `mp3_url` varchar(255) NOT NULL,
  `is_master` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_tracks_profile_id` (`profile_id`),
  KEY `idx_collaboration_id` (`collaboration_id`),
  CONSTRAINT `fk_tracks_collaboration_id` FOREIGN KEY (`collaboration_id`) REFERENCES `collaborations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tracks_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `follows` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `follower_id` int(11) NOT NULL,
  `followed_profile_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_follow` (`follower_id`,`followed_profile_id`),
  KEY `followed_profile_id` (`followed_profile_id`),
  KEY `idx_follower` (`follower_id`,`followed_profile_id`),
  CONSTRAINT `follows_ibfk_1` FOREIGN KEY (`follower_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `follows_ibfk_2` FOREIGN KEY (`followed_profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `forum_comments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `post_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `content` text NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `image_url` varchar(255) DEFAULT NULL,
  `parent_comment_id` bigint(20) unsigned DEFAULT NULL,
  `edited_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `post_id` (`post_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `forum_comments_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `forum_posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `forum_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `forum_posts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `image_url` varchar(255) DEFAULT NULL,
  `edited_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `forum_posts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `idjc_claims` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  `wallet_address` varchar(44) NOT NULL,
  `amount` int(11) NOT NULL,
  `campaign_code` varchar(100) NOT NULL,
  `status` enum('pending','completed','failed') NOT NULL DEFAULT 'pending',
  `transaction_signature` varchar(88) DEFAULT NULL,
  `error_message` varchar(255) DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 1,
  `claimed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_campaign` (`user_id`,`campaign_code`),
  KEY `idx_claim_status` (`status`),
  KEY `fk_idjc_claims_profile` (`profile_id`),
  CONSTRAINT `fk_idjc_claims_profile` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_idjc_claims_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `idjc_payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profile_id` int(11) NOT NULL,
  `amount` decimal(18,9) NOT NULL,
  `transaction_signature` varchar(88) NOT NULL,
  `paid_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `profile_id` (`profile_id`),
  CONSTRAINT `idjc_payments_ibfk_1` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dispatch for the background workers (loop generation, audio analysis,
-- auto-master). This replaced BullMQ/Redis: the job's real state already lived
-- in loops / songs / mastering_jobs, so all Redis held was the waiting list.
-- Rows are deleted on success and kept for two weeks on failure.
CREATE TABLE IF NOT EXISTS `job_queue` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `queue` varchar(64) NOT NULL,
  `payload` text NOT NULL,
  `priority` int(11) NOT NULL DEFAULT 100,
  `status` enum('waiting','active','failed') NOT NULL DEFAULT 'waiting',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `max_attempts` int(11) NOT NULL DEFAULT 1,
  `backoff_ms` int(11) NOT NULL DEFAULT 0,
  `run_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `locked_by` varchar(120) DEFAULT NULL,
  `lease_expires_at` timestamp NULL DEFAULT NULL,
  `last_error` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `started_at` timestamp NULL DEFAULT NULL,
  `finished_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `claim` (`queue`,`status`,`priority`,`run_at`),
  KEY `lease` (`status`,`lease_expires_at`),
  KEY `prune` (`status`,`finished_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `loops` (
  `id` varchar(36) NOT NULL,
  `type` enum('bass','synth','effects','drums') NOT NULL,
  `prompt` text NOT NULL,
  `user_id` int(11) NOT NULL,
  `status` enum('queued','generating','ready','failed') DEFAULT 'queued',
  `bpm` int(11) DEFAULT 128,
  `key` varchar(20) DEFAULT 'C minor',
  `duration` int(11) DEFAULT 30,
  `url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `loops_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `mastering_jobs` (
  `id` varchar(36) NOT NULL,
  `song_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `status` enum('queued','analyzing','rendering','ready','failed') NOT NULL DEFAULT 'queued',
  `analysis` mediumtext DEFAULT NULL,
  `plan` mediumtext DEFAULT NULL,
  `result_url` varchar(255) DEFAULT NULL,
  `error` text DEFAULT NULL,
  `audio_duration_sec` decimal(10,2) DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `finished_at` timestamp NULL DEFAULT NULL,
  `duration_ms` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `song_id` (`song_id`),
  KEY `user_id` (`user_id`),
  KEY `status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `messages` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `collab_id` bigint(20) unsigned DEFAULT NULL,
  `sender_id` bigint(20) unsigned NOT NULL,
  `receiver_id` bigint(20) unsigned NOT NULL,
  `content` text NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `is_read` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `recipient_user_id` int(11) NOT NULL,
  `actor_user_id` int(11) NOT NULL,
  `type` varchar(64) NOT NULL,
  `message` varchar(500) NOT NULL,
  `entity_type` varchar(64) DEFAULT NULL,
  `entity_id` bigint(20) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notifications_recipient_created` (`recipient_user_id`,`created_at`),
  KEY `idx_notifications_recipient_read` (`recipient_user_id`,`is_read`),
  KEY `fk_notifications_actor_user` (`actor_user_id`),
  CONSTRAINT `fk_notifications_actor_user` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notifications_recipient_user` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `playlists` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profile_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_public` tinyint(1) NOT NULL DEFAULT 0,
  `dedicated_to_profile_id` int(11) DEFAULT NULL,
  `dedication_note` varchar(280) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `profile_id` (`profile_id`),
  KEY `playlists_public_idx` (`is_public`,`updated_at`),
  KEY `playlists_dedicated_idx` (`dedicated_to_profile_id`),
  CONSTRAINT `fk_playlists_dedicated_to` FOREIGN KEY (`dedicated_to_profile_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `playlists_ibfk_1` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `playlist_songs` (
  `playlist_id` int(11) NOT NULL,
  `song_id` int(11) NOT NULL,
  `added_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`playlist_id`,`song_id`),
  KEY `song_id` (`song_id`),
  CONSTRAINT `playlist_songs_ibfk_1` FOREIGN KEY (`playlist_id`) REFERENCES `playlists` (`id`) ON DELETE CASCADE,
  CONSTRAINT `playlist_songs_ibfk_2` FOREIGN KEY (`song_id`) REFERENCES `songs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `plays` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `song_id` int(11) DEFAULT NULL,
  `played_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `song_id` (`song_id`),
  CONSTRAINT `plays_ibfk_1` FOREIGN KEY (`song_id`) REFERENCES `songs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `profiles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `genre` varchar(100) DEFAULT NULL,
  `picture_url` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `background` varchar(255) DEFAULT NULL,
  `donation_link` varchar(255) DEFAULT NULL,
  `solana_address` varchar(44) DEFAULT NULL,
  `hero_background` varchar(255) DEFAULT NULL,
  `website_url` varchar(255) DEFAULT NULL,
  `x_url` varchar(255) DEFAULT NULL,
  `facebook_url` varchar(255) DEFAULT NULL,
  `youtube_url` varchar(255) DEFAULT NULL,
  `instagram_url` varchar(255) DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `slug` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `profiles_slug_unique` (`slug`),
  CONSTRAINT `profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `profile_earnings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profile_id` int(11) NOT NULL,
  `earnings_date` date NOT NULL,
  `listens_count` int(11) NOT NULL,
  `coins_earned` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_id` (`profile_id`,`earnings_date`),
  CONSTRAINT `profile_earnings_ibfk_1` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `projects` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `is_public` tinyint(1) DEFAULT 0,
  `bpm` int(11) DEFAULT 120,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `project_samples` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `track_id` int(11) NOT NULL,
  `sample_id` int(11) NOT NULL,
  `start_time` float NOT NULL DEFAULT 0,
  `fade_in` float NOT NULL DEFAULT 0,
  `fade_out` float NOT NULL DEFAULT 0,
  `trim_start` float NOT NULL DEFAULT 0,
  `trim_end` float DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `reviews` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `song_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  `rating` decimal(3,1) DEFAULT NULL CHECK (`rating` >= 0.5 and `rating` <= 10),
  `review` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `feedback` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`feedback`)),
  PRIMARY KEY (`id`),
  KEY `song_id` (`song_id`),
  KEY `fk_reviews_profile_id` (`profile_id`),
  CONSTRAINT `fk_reviews_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`),
  CONSTRAINT `reviews_ibfk_1` FOREIGN KEY (`song_id`) REFERENCES `songs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `review_reactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `review_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `reaction` enum('thumbs_up','thumbs_down','clown') NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `review_reactions_one_per_user` (`review_id`,`user_id`),
  KEY `review_reactions_review` (`review_id`),
  KEY `fk_review_reactions_user` (`user_id`),
  CONSTRAINT `fk_review_reactions_review` FOREIGN KEY (`review_id`) REFERENCES `reviews` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_review_reactions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `sample_library` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `mp3_url` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `duration` float DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `sample_library_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `songs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profile_id` int(11) DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `mp3_url` varchar(255) DEFAULT NULL,
  `plays` int(11) NOT NULL DEFAULT 0,
  `image_url` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `genre` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `peaks` mediumtext DEFAULT NULL,
  `stems_url` varchar(255) DEFAULT NULL,
  `is_featured` tinyint(1) DEFAULT 0,
  `allow_download` tinyint(1) NOT NULL DEFAULT 0,
  `bpm` decimal(6,2) DEFAULT NULL,
  `musical_key` varchar(20) DEFAULT NULL,
  `duration` float DEFAULT NULL,
  `analysis_status` enum('pending','queued','analyzing','done','failed') NOT NULL DEFAULT 'pending',
  `allow_ai_training` tinyint(1) NOT NULL DEFAULT 0,
  `ai_training_opted_in_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `profile_id` (`profile_id`),
  KEY `genre` (`genre`),
  KEY `analysis_status_idx` (`analysis_status`),
  CONSTRAINT `songs_ibfk_1` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `song_analysis` (
  `song_id` int(11) NOT NULL,
  `mp3_url` varchar(255) NOT NULL,
  `analysis` mediumtext NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`song_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `song_plays` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `song_id` int(11) NOT NULL,
  `ip_address` varchar(90) DEFAULT NULL,
  `played_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_song_ip` (`song_id`,`ip_address`),
  CONSTRAINT `song_plays_ibfk_1` FOREIGN KEY (`song_id`) REFERENCES `songs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `tracks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `project_id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `track_order` int(11) NOT NULL,
  `track_type` enum('sample','midi') NOT NULL DEFAULT 'sample',
  `midi_notes` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`midi_notes`)),
  `volume` float DEFAULT 1,
  `instrument_type` varchar(50) DEFAULT 'piano',
  `is_polyphonic` tinyint(1) DEFAULT 0,
  `synth_settings` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`synth_settings`)),
  `effects_settings` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT '{}' CHECK (json_valid(`effects_settings`)),
  `pan` float NOT NULL DEFAULT 0,
  `is_muted` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `project_id` (`project_id`),
  CONSTRAINT `tracks_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `google_id` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `eq_gains` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`eq_gains`)),
  `password` varchar(255) DEFAULT NULL,
  `is_email_verified` tinyint(1) DEFAULT 0,
  `verification_token` varchar(255) DEFAULT NULL,
  `reset_password_token` varchar(255) DEFAULT NULL,
  `reset_password_expires` datetime DEFAULT NULL,
  `relink_token` varchar(255) DEFAULT NULL,
  `relink_google_id` varchar(255) DEFAULT NULL,
  `is_admin` tinyint(1) DEFAULT 0,
  `email_notifications_enabled` tinyint(1) DEFAULT 1,
  `email_profile_activity_enabled` tinyint(1) DEFAULT 1,
  `email_artist_activity_enabled` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `google_id` (`google_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;
