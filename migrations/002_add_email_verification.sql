-- Confirmação de email: códigos e dados pendentes
-- Executar no phpMyAdmin (uma vez) se a tabela já existir.

ALTER TABLE gestora_de_credito ADD COLUMN email_verification_code VARCHAR(10) NULL AFTER num_dependentes;
ALTER TABLE gestora_de_credito ADD COLUMN email_verification_sent_at DATETIME NULL AFTER email_verification_code;
ALTER TABLE gestora_de_credito ADD COLUMN pending_nome VARCHAR(255) NULL AFTER email_verification_sent_at;
ALTER TABLE gestora_de_credito ADD COLUMN pending_email VARCHAR(255) NULL AFTER pending_nome;
