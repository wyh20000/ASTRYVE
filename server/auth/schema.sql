CREATE TABLE IF NOT EXISTS auth_users (
  id CHAR(36) PRIMARY KEY,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_identities (
  provider VARCHAR(16) NOT NULL,
  subject VARCHAR(128) NOT NULL,
  user_id CHAR(36) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (provider, subject),
  KEY auth_identities_user (user_id),
  CONSTRAINT auth_identities_user_fk FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE TABLE IF NOT EXISTS auth_sms_challenges (
  phone CHAR(14) PRIMARY KEY,
  code_hash CHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  sent_at BIGINT NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT NULL,
  KEY auth_sessions_user (user_id),
  CONSTRAINT auth_sessions_user_fk FOREIGN KEY (user_id) REFERENCES auth_users(id)
);
