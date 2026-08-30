-- database/schema.sql
CREATE DATABASE IF NOT EXISTS internetdj;
USE internetdj;

CREATE TABLE IF NOT EXISTS users (
    id INT NOT NULL AUTO_INCREMENT,
    google_id VARCHAR(255),
    email VARCHAR(255),
    name VARCHAR(255),
    eq_gains LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin CHECK (json_valid(`eq_gains`)),
    PRIMARY KEY (id),
    UNIQUE KEY google_id (google_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS profiles (
    id INT NOT NULL AUTO_INCREMENT,
    user_id INT,
    name VARCHAR(255),
    location VARCHAR(255),
    genre VARCHAR(100),
    picture_url VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY user_id (user_id),
    CONSTRAINT profiles_ibfk_1 FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS songs (
    id INT NOT NULL AUTO_INCREMENT,
    profile_id INT,
    title VARCHAR(255),
    mp3_url VARCHAR(255),
    plays INT NOT NULL DEFAULT 0,
    image_url VARCHAR(255),
    description TEXT,
    genre VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    peaks MEDIUMTEXT,
    PRIMARY KEY (id),
    KEY profile_id (profile_id),
    CONSTRAINT songs_ibfk_1 FOREIGN KEY (profile_id) REFERENCES profiles(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS reviews (
    id INT NOT NULL AUTO_INCREMENT,
    song_id INT,
    user_id INT,
    rating DECIMAL(3,1) CHECK (rating >= 0.5 AND rating <= 10),
    review TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY song_id (song_id),
    KEY user_id (user_id),
    CONSTRAINT reviews_ibfk_1 FOREIGN KEY (song_id) REFERENCES songs(id),
    CONSTRAINT reviews_ibfk_2 FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS plays (
    id INT NOT NULL AUTO_INCREMENT,
    song_id INT,
    played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY song_id (song_id),
    CONSTRAINT plays_ibfk_1 FOREIGN KEY (song_id) REFERENCES songs(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS song_plays (
    id INT NOT NULL AUTO_INCREMENT,
    song_id INT NOT NULL,
    ip_address VARCHAR(90) NOT NULL,
    played_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_song_ip (song_id, ip_address),
    CONSTRAINT song_plays_ibfk_1 FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE forum_posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE forum_comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE tracks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    track_order INT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Create sample_library table to store user-uploaded samples
CREATE TABLE sample_library (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL, -- Sample name (e.g., filename or user-defined)
    mp3_url VARCHAR(255) NOT NULL, -- URL to the MP3 file in Tigris S3
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create project_samples table to map samples to tracks and measures
CREATE TABLE project_samples
(
    id             INT AUTO_INCREMENT PRIMARY KEY,
    track_id       INT NOT NULL,
    sample_id      INT NOT NULL,
    start_time FLOAT NOT NULL DEFAULT 0
);

CREATE TABLE playlists (
                           id INT AUTO_INCREMENT PRIMARY KEY,
                           profile_id INT NOT NULL,
                           name VARCHAR(255) NOT NULL,
                           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                           updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                           FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE playlist_songs (
                                playlist_id INT NOT NULL,
                                song_id INT NOT NULL,
                                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                PRIMARY KEY (playlist_id, song_id),
                                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE TABLE profile_earnings (
                                  id INT AUTO_INCREMENT PRIMARY KEY,
                                  profile_id INT NOT NULL,
                                  earnings_date DATE NOT NULL,
                                  listens_count INT NOT NULL,
                                  coins_earned INT NOT NULL DEFAULT 0,
                                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                  UNIQUE KEY (profile_id, earnings_date),
                                  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
-- Every coin a profile earns is one row here. The unique key makes awards
-- idempotent: replaying a night or re-running a backfill converges on the same
-- balance instead of double-granting. source_id is whatever makes the award
-- unique for that activity -- an earnings date for daily listens, a review id
-- for a review -- so it is a string rather than an int.
CREATE TABLE coin_events (
                                  id INT AUTO_INCREMENT PRIMARY KEY,
                                  profile_id INT NOT NULL,
                                  activity_type VARCHAR(50) NOT NULL,
                                  source_id VARCHAR(100) NOT NULL,
                                  coins INT NOT NULL,
                                  metadata TEXT DEFAULT NULL,
                                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                  UNIQUE KEY uniq_profile_activity_source (profile_id, activity_type, source_id),
                                  KEY idx_profile (profile_id),
                                  KEY idx_activity (activity_type),
                                  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE TABLE idjc_payments (
                               id INT AUTO_INCREMENT PRIMARY KEY,
                               profile_id INT NOT NULL,
                               amount DECIMAL(18, 9) NOT NULL,
                               transaction_signature VARCHAR(88) NOT NULL,
                               paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                               FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE `follows` (
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
          ) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE users ADD is_admin TINYINT(1) DEFAULT 0;


ALTER TABLE tracks ADD COLUMN effects_settings JSON DEFAULT '{}';



ALTER TABLE reviews ADD COLUMN feedback JSON;

ALTER TABLE projects ADD bpm INTEGER DEFAULT 120;

ALTER TABLE tracks
    ADD COLUMN synth_settings JSON DEFAULT NULL;

ALTER TABLE tracks
    ADD COLUMN instrument_type VARCHAR(50) DEFAULT 'piano',
ADD COLUMN is_polyphonic BOOLEAN DEFAULT FALSE;

ALTER TABLE tracks
    ADD COLUMN volume FLOAT DEFAULT 1.0;

-- Add track_type column
ALTER TABLE tracks
    ADD COLUMN IF NOT EXISTS track_type ENUM('sample', 'midi') NOT NULL DEFAULT 'sample';

-- Add midi_notes column
ALTER TABLE tracks
    ADD COLUMN IF NOT EXISTS midi_notes LONGTEXT DEFAULT NULL;

alter table songs add index(genre);

ALTER TABLE forum_posts
    ADD COLUMN edited_at TIMESTAMP NULL DEFAULT NULL,
MODIFY COLUMN content TEXT NOT NULL;

ALTER TABLE forum_comments
    ADD COLUMN edited_at TIMESTAMP NULL DEFAULT NULL,
MODIFY COLUMN content TEXT NOT NULL;

ALTER TABLE forum_comments
    ADD COLUMN parent_comment_id BIGINT UNSIGNED DEFAULT NULL;


ALTER TABLE users ADD COLUMN relink_token VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD COLUMN relink_google_id VARCHAR(255) DEFAULT NULL;

ALTER TABLE users ADD COLUMN is_email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN verification_token VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD COLUMN reset_password_token VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD COLUMN reset_password_expires DATETIME DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_profile_activity_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_artist_activity_enabled BOOLEAN DEFAULT TRUE;


ALTER TABLE users ADD COLUMN password VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD UNIQUE (email);


ALTER TABLE projects ADD COLUMN is_public BOOLEAN DEFAULT FALSE;


ALTER TABLE reviews DROP FOREIGN KEY reviews_ibfk_2;

ALTER TABLE reviews
    ADD COLUMN profile_id INT NOT NULL AFTER song_id;

UPDATE reviews r
    JOIN profiles p ON r.user_id = p.user_id
    SET r.profile_id = p.id;

ALTER TABLE reviews DROP COLUMN user_id;

ALTER TABLE reviews
    ADD CONSTRAINT fk_reviews_profile_id FOREIGN KEY (profile_id) REFERENCES profiles(id);

ALTER TABLE reviews MODIFY COLUMN song_id INT NOT NULL;

ALTER TABLE profiles ADD COLUMN solana_address VARCHAR(44) NULL;

ALTER TABLE profiles
    ADD background VARCHAR(255) DEFAULT NULL;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hero_background VARCHAR(255) DEFAULT NULL;

ALTER TABLE songs ADD COLUMN stems_url VARCHAR(255) DEFAULT NULL;

ALTER TABLE profiles ADD COLUMN donation_link VARCHAR(255) DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location VARCHAR(255) DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS website_url VARCHAR(255) DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS x_url VARCHAR(255) DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(255) DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS youtube_url VARCHAR(255) DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS instagram_url VARCHAR(255) DEFAULT NULL;

ALTER TABLE songs ADD COLUMN is_featured BOOLEAN DEFAULT FALSE;

ALTER TABLE songs ADD COLUMN IF NOT EXISTS allow_download BOOLEAN NOT NULL DEFAULT FALSE;

-- Consent to use a track to train the model behind InternetDJ's AI loop
-- generator, which writes brand-new material from a prompt. It is not a
-- source-separation model and the track is never taken apart or reproduced.
-- Opt-in and nothing else: the column defaults to FALSE, so a track can only
-- ever be in a training set because its artist said yes, and existing songs
-- stay out when this column is added. `ai_training_opted_in_at` is the record
-- of when that yes was given, and is cleared again if consent is withdrawn, so
-- there is always an answer to "when did this artist agree to this".
ALTER TABLE songs ADD COLUMN IF NOT EXISTS allow_ai_training BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS ai_training_opted_in_at DATETIME DEFAULT NULL;

-- Tempo/key/duration, detected on upload by backend/workers/analysisWorker.js.
-- `musical_key` rather than `key` because KEY is reserved in MySQL/MariaDB.
-- Both bpm and musical_key are suggestions the artist can correct, and stay
-- NULL when detection was not confident enough to be worth showing.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS bpm DECIMAL(6,2) DEFAULT NULL;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS musical_key VARCHAR(20) DEFAULT NULL;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS duration FLOAT DEFAULT NULL;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS analysis_status
    ENUM('pending','queued','analyzing','done','failed') NOT NULL DEFAULT 'pending';
ALTER TABLE songs ADD INDEX IF NOT EXISTS analysis_status_idx (analysis_status);

ALTER TABLE forum_posts ADD COLUMN image_url VARCHAR(255) DEFAULT NULL;
ALTER TABLE forum_comments ADD COLUMN image_url VARCHAR(255) DEFAULT NULL;

-- Output of the AI loop generator: short, brand-new musical segments written
-- from a prompt at a chosen tempo and key. Called `stems` until that word was
-- found to promise source separation, which this is not. Note that
-- songs.stems_url above is unrelated and correctly named -- it is an artist's
-- link to the real bounced submixes of their own track.
CREATE TABLE IF NOT EXISTS loops (
    id VARCHAR(36) PRIMARY KEY,
    type ENUM('bass', 'synth', 'effects', 'drums') NOT NULL,
    prompt TEXT NOT NULL,
    user_id INT NOT NULL,
    status ENUM('queued', 'generating', 'ready', 'failed') DEFAULT 'queued',
    bpm INT DEFAULT 128,
    `key` VARCHAR(20) DEFAULT 'C minor',
    duration INT DEFAULT 30,
    url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

ALTER TABLE loops ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS idjc_claims (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    profile_id INT NOT NULL,
    wallet_address VARCHAR(44) NOT NULL,
    amount INT NOT NULL,
    campaign_code VARCHAR(100) NOT NULL,
    status ENUM('pending', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    transaction_signature VARCHAR(88) DEFAULT NULL,
    error_message VARCHAR(255) DEFAULT NULL,
    attempts INT NOT NULL DEFAULT 1,
    claimed_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_campaign (user_id, campaign_code),
    KEY idx_claim_status (status),
    CONSTRAINT fk_idjc_claims_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_idjc_claims_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recipient_user_id INT NOT NULL,
    actor_user_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    message VARCHAR(500) NOT NULL,
    entity_type VARCHAR(64) DEFAULT NULL,
    entity_id BIGINT DEFAULT NULL,
    metadata JSON DEFAULT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notifications_recipient_created (recipient_user_id, created_at),
    KEY idx_notifications_recipient_read (recipient_user_id, is_read),
    CONSTRAINT fk_notifications_recipient_user FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- Mixing controls: per-track pan and mute (solo is session-only in the editor)
ALTER TABLE tracks
    ADD COLUMN IF NOT EXISTS pan FLOAT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_muted TINYINT(1) NOT NULL DEFAULT 0;

-- Per-clip fades and non-destructive trim (seconds; trim_end NULL = full length)
ALTER TABLE project_samples
    ADD COLUMN IF NOT EXISTS fade_in FLOAT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fade_out FLOAT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS trim_start FLOAT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS trim_end FLOAT DEFAULT NULL;

-- Cache decoded audio duration (seconds) to avoid client-side probing
ALTER TABLE sample_library
    ADD COLUMN IF NOT EXISTS duration FLOAT DEFAULT NULL;

-- Vanity profile URLs: /profile/dj-subspace as well as /profile/18.
-- NULL means "no slug chosen yet", and MySQL/MariaDB allow many NULLs in a
-- UNIQUE index, so existing profiles need no backfill. The table collation is
-- utf8mb4_general_ci, so uniqueness is already case-insensitive.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS slug VARCHAR(40) DEFAULT NULL;
ALTER TABLE profiles ADD UNIQUE KEY IF NOT EXISTS profiles_slug_unique (slug);

-- Expressive reactions on reviews (Steam-style). Deliberately NOT scored:
-- these counts never feed Top Reviewers or any ranking, so there is nothing
-- to farm. The UNIQUE key holds one reaction per user per review, which is
-- what makes switching a replace and re-clicking a removal.
CREATE TABLE IF NOT EXISTS review_reactions (
    id INT NOT NULL AUTO_INCREMENT,
    review_id INT NOT NULL,
    user_id INT NOT NULL,
    reaction ENUM('thumbs_up', 'thumbs_down', 'clown') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY review_reactions_one_per_user (review_id, user_id),
    KEY review_reactions_review (review_id),
    CONSTRAINT fk_review_reactions_review FOREIGN KEY (review_id)
        REFERENCES reviews(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_reactions_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Playlists become shareable. Existing rows stay private on purpose: they were
-- created when every playlist route required auth, so their owners never
-- agreed to publish them. New ones default to public in the UI instead.
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- A mixtape is just a playlist made *for* someone. Null here means it is an
-- ordinary crate, so both kinds live in one table and one set of routes.
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS dedicated_to_profile_id INT DEFAULT NULL;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS dedication_note VARCHAR(280) DEFAULT NULL;

ALTER TABLE playlists ADD CONSTRAINT fk_playlists_dedicated_to
    FOREIGN KEY (dedicated_to_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX playlists_public_idx ON playlists (is_public, updated_at);
CREATE INDEX playlists_dedicated_idx ON playlists (dedicated_to_profile_id);

CREATE TABLE IF NOT EXISTS mastering_jobs (
    id VARCHAR(36) NOT NULL,
    song_id INT NOT NULL,
    user_id INT NOT NULL,
    status ENUM('queued','analyzing','rendering','ready','failed') NOT NULL DEFAULT 'queued',
    analysis MEDIUMTEXT,
    plan MEDIUMTEXT,
    result_url VARCHAR(255),
    error TEXT,
    audio_duration_sec DECIMAL(10,2),
    started_at TIMESTAMP NULL DEFAULT NULL,
    finished_at TIMESTAMP NULL DEFAULT NULL,
    duration_ms INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY song_id (song_id),
    KEY user_id (user_id),
    KEY status_created (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Analysis is the expensive half of auto-mastering and the source never
-- changes, so it is cached against the exact mp3_url it was measured from.
-- Re-uploading the audio changes the url and invalidates the row on its own.
CREATE TABLE IF NOT EXISTS song_analysis (
    song_id INT NOT NULL,
    mp3_url VARCHAR(255) NOT NULL,
    analysis MEDIUMTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (song_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Editorial articles: news, features, interviews and guides.
--
-- Most rows are the recovered InternetDJ.com archive (2001-2017), which is why
-- the legacy columns exist: `legacy_story_id` is the story id from the original
-- CMS, and `source_url` records the Wayback capture a row was rebuilt from, so
-- a bad extraction can always be traced back and re-run. New articles written
-- on the current site simply leave those NULL.
--
-- `category_slug` is stored rather than derived so the URL a category is
-- reachable at can never drift from the label shown on the page.
CREATE TABLE IF NOT EXISTS articles (
    id INT NOT NULL AUTO_INCREMENT,
    slug VARCHAR(220) NOT NULL,
    title VARCHAR(300) NOT NULL,
    deck VARCHAR(600) DEFAULT NULL,
    body_html MEDIUMTEXT,
    body_text MEDIUMTEXT,
    category VARCHAR(80) DEFAULT NULL,
    category_slug VARCHAR(80) DEFAULT NULL,
    author_name VARCHAR(120) DEFAULT NULL,
    -- Set when a legacy byline matches a member on the current site; most
    -- legacy authors have no account here, so it stays NULL.
    profile_id INT DEFAULT NULL,
    hero_image_url VARCHAR(500) DEFAULT NULL,
    published_at DATE DEFAULT NULL,
    -- 'submitted' is a member's article waiting for an editor. The default
    -- stays 'published' because the legacy importer and the submission
    -- endpoint both set this explicitly, and changing it would only affect
    -- rows inserted by hand.
    -- 'deleted' is a soft delete. The row stays so an editor can restore it,
    -- and because importArticles.js never writes `status`: a legacy article
    -- removed here stays removed through the next re-import, where a real
    -- DELETE would simply be re-inserted.
    status ENUM('draft','submitted','published','deleted') NOT NULL DEFAULT 'published',
    is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
    legacy_story_id INT DEFAULT NULL,
    source_url VARCHAR(600) DEFAULT NULL,
    archived_at VARCHAR(20) DEFAULT NULL,
    views INT NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP NULL DEFAULT NULL,
    -- Set by the editor when returning a submission; shown to its author.
    editor_note TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_article_slug (slug),
    KEY idx_article_category (category_slug, published_at),
    KEY idx_article_published (status, published_at),
    KEY idx_article_legacy (legacy_story_id),
    CONSTRAINT articles_ibfk_1 FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
