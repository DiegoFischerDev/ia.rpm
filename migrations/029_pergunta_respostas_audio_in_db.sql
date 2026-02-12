-- Armazenar áudio das respostas FAQ na base de dados para sobreviver a deploys
-- (em vez de ficheiros em disco que se perdem no redeploy)

ALTER TABLE ch_pergunta_respostas
  ADD COLUMN audio_data LONGBLOB NULL AFTER audio_transcricao,
  ADD COLUMN audio_mimetype VARCHAR(50) NULL AFTER audio_data;
