-- Mapeamento de leads (por email) para gestora, usado na migração do sistema antigo.
-- Cada linha associa um email de lead a uma gestora específica.

CREATE TABLE IF NOT EXISTS ch_leads_legacy_gestora_map (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  gestora_id INT UNSIGNED NOT NULL,
  gestora_nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_legacy_gestora_email (email),
  KEY idx_lead_legacy_gestora_gestora_id (gestora_id),
  CONSTRAINT fk_lead_legacy_gestora_gestora
    FOREIGN KEY (gestora_id) REFERENCES ch_gestoras(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

