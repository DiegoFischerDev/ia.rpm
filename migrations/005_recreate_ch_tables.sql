-- =============================================================================
-- Crédito Habitação (CH): recriar tabelas com nomes ch_gestoras e ch_leads
-- Executar uma vez no phpMyAdmin (ou MySQL) depois de apagar a tabela antiga.
-- ATENÇÃO: isto apaga gestora_de_credito e gestoras e cria as novas tabelas.
-- =============================================================================

DROP TABLE IF EXISTS gestora_de_credito;
DROP TABLE IF EXISTS gestoras;

-- Gestoras (parceiras) – só as ativas recebem leads
CREATE TABLE ch_gestoras (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  whatsapp VARCHAR(32) NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ch_gestoras_ativo (ativo)
);

-- Leads de crédito habitação (cada lead pode estar associado a uma gestora)
CREATE TABLE ch_leads (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  whatsapp_number VARCHAR(32) NOT NULL,
  nome VARCHAR(255),
  email VARCHAR(255),
  origem_instancia VARCHAR(64),
  estado VARCHAR(32) NOT NULL,
  estado_anterior VARCHAR(32),
  docs_enviados TINYINT(1) NOT NULL DEFAULT 0,
  docs_enviados_em DATETIME NULL,
  estado_civil VARCHAR(128) NULL,
  num_dependentes VARCHAR(16) NULL,
  email_verification_code VARCHAR(10) NULL,
  email_verification_sent_at DATETIME NULL,
  pending_nome VARCHAR(255) NULL,
  pending_email VARCHAR(255) NULL,
  gestora_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ch_leads_whatsapp_number (whatsapp_number),
  KEY idx_ch_leads_gestora_id (gestora_id)
);

-- Opcional: inserir uma gestora de exemplo (descomenta e ajusta)
-- INSERT INTO ch_gestoras (nome, email, whatsapp, ativo) VALUES ('Gestora Exemplo', 'gestora@exemplo.pt', '351912345678', 1);
