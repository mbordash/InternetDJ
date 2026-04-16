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
          ) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci

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

ALTER TABLE songs ADD COLUMN stems_url VARCHAR(255) DEFAULT NULL;

ALTER TABLE profiles ADD COLUMN donation_link VARCHAR(255) DEFAULT NULL;

ALTER TABLE songs ADD COLUMN is_featured BOOLEAN DEFAULT FALSE;

ALTER TABLE forum_posts ADD COLUMN image_url VARCHAR(255) DEFAULT NULL;
ALTER TABLE forum_comments ADD COLUMN image_url VARCHAR(255) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS stems (
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

ALTER TABLE stems ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;