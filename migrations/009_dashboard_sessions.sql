-- Tabela para sessões do dashboard (express-mysql-session).
-- Só é necessário executar se a criação automática falhar (ex.: permissões).
-- O pacote express-mysql-session cria esta tabela sozinho quando tem permissão.

CREATE TABLE IF NOT EXISTS dashboard_sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT(11) UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
