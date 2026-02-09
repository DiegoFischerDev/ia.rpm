-- Adicionar foto de perfil e mensagem de boas-vindas para gestoras
-- foto_perfil: imagem (data URL) da gestora, guardada como TEXT
-- boas_vindas: texto curto de boas-vindas mostrado aos leads na página de upload

ALTER TABLE ch_gestoras
  ADD COLUMN foto_perfil TEXT NULL AFTER whatsapp,
  ADD COLUMN boas_vindas TEXT NULL AFTER foto_perfil;

