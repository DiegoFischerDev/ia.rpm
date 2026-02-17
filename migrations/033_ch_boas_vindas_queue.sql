-- Fila de passos do fluxo de boas-vindas do evo (persiste entre reinícios do processo)
CREATE TABLE IF NOT EXISTS ch_boas_vindas_queue (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  instance_name VARCHAR(64) NOT NULL,
  remote_jid VARCHAR(128) NOT NULL,
  step TINYINT UNSIGNED NOT NULL,
  execute_at DATETIME NOT NULL,
  payload TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_boas_vindas_execute (execute_at)
);
