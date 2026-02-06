-- Adicionar estado_civil e num_dependentes à tabela gestora_de_credito
-- Executar no phpMyAdmin (uma vez) se a tabela já existir sem estas colunas.

ALTER TABLE gestora_de_credito ADD COLUMN estado_civil VARCHAR(128) NULL AFTER docs_enviados_em;
ALTER TABLE gestora_de_credito ADD COLUMN num_dependentes VARCHAR(16) NULL AFTER estado_civil;
