-- =============================================================================
-- Autenticação das gestoras: password e recuperação por email
-- Executar no phpMyAdmin (base de dados partilhada).
-- =============================================================================

ALTER TABLE ch_gestoras
  ADD COLUMN password VARCHAR(255) NULL AFTER ativo,
  ADD COLUMN password_reset_token VARCHAR(64) NULL AFTER password,
  ADD COLUMN password_reset_expires_at DATETIME NULL AFTER password_reset_token;
