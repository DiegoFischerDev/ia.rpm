-- Adicionar foto de perfil e mensagem de boas-vindas para gestoras
-- foto_perfil: URL (opcional) da imagem da gestora
-- boas_vindas: texto curto de boas-vindas mostrado aos leads na página de upload

ALTER TABLE ch_gestoras
  ADD COLUMN foto_perfil VARCHAR(512) NULL AFTER whatsapp,
  ADD COLUMN boas_vindas TEXT NULL AFTER foto_perfil;

