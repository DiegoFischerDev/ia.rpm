-- Tabela de gestoras (parceiras) – só as ativas recebem leads
-- Executar no phpMyAdmin (uma vez).

CREATE TABLE IF NOT EXISTS gestoras (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  whatsapp VARCHAR(32) NOT NULL COMMENT 'Número com indicativo, sem + (ex.: 351912345678)',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gestoras_ativo (ativo)
);
