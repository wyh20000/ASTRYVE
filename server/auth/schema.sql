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
  flow_id CHAR(32) NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  sent_at BIGINT NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_desktop_flows (
  id CHAR(32) PRIMARY KEY,
  redirect_uri VARCHAR(128) NOT NULL,
  state CHAR(43) NOT NULL,
  code_challenge CHAR(43) NOT NULL,
  browser_cookie_hash CHAR(64) NULL,
  csrf_hash CHAR(64) NULL,
  status VARCHAR(12) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  KEY auth_desktop_flows_expires (expires_at)
);

CREATE TABLE IF NOT EXISTS auth_link_flows (
  id CHAR(32) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  session_hash CHAR(64) NOT NULL,
  browser_cookie_hash CHAR(64) NULL,
  csrf_hash CHAR(64) NULL,
  status VARCHAR(12) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  KEY auth_link_flows_expires (expires_at),
  KEY auth_link_flows_session (session_hash),
  CONSTRAINT auth_link_flows_user_fk FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE TABLE IF NOT EXISTS auth_desktop_codes (
  code_hash CHAR(64) PRIMARY KEY,
  flow_id CHAR(32) NOT NULL,
  user_id CHAR(36) NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT NULL,
  KEY auth_desktop_codes_flow (flow_id),
  KEY auth_desktop_codes_expires (expires_at),
  CONSTRAINT auth_desktop_codes_flow_fk FOREIGN KEY (flow_id) REFERENCES auth_desktop_flows(id),
  CONSTRAINT auth_desktop_codes_user_fk FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE TABLE IF NOT EXISTS auth_oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  flow_id CHAR(32) NOT NULL,
  provider VARCHAR(16) NOT NULL,
  browser_cookie_hash CHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT NULL,
  KEY auth_oauth_states_flow (flow_id),
  KEY auth_oauth_states_expires (expires_at),
  CONSTRAINT auth_oauth_states_flow_fk FOREIGN KEY (flow_id) REFERENCES auth_desktop_flows(id)
);

CREATE TABLE IF NOT EXISTS auth_link_oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  flow_id CHAR(32) NOT NULL,
  provider VARCHAR(16) NOT NULL,
  browser_cookie_hash CHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT NULL,
  KEY auth_link_oauth_states_flow (flow_id),
  KEY auth_link_oauth_states_expires (expires_at),
  CONSTRAINT auth_link_oauth_states_flow_fk FOREIGN KEY (flow_id) REFERENCES auth_link_flows(id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT NULL,
  KEY auth_sessions_user (user_id),
  KEY auth_sessions_expires (expires_at),
  CONSTRAINT auth_sessions_user_fk FOREIGN KEY (user_id) REFERENCES auth_users(id)
);
