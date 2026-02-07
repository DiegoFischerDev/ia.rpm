-- Associar cada lead à gestora que recebeu os documentos
-- Executar no phpMyAdmin (uma vez) após 003_create_gestoras.sql.

ALTER TABLE gestora_de_credito
  ADD COLUMN gestora_id INT UNSIGNED NULL AFTER pending_email,
  ADD KEY idx_gestora_de_credito_gestora_id (gestora_id);

-- Opcional: se quiseres FK (garante que gestora_id existe em gestoras):
-- ALTER TABLE gestora_de_credito
--   ADD CONSTRAINT fk_lead_gestora FOREIGN KEY (gestora_id) REFERENCES gestoras(id) ON DELETE SET NULL;
