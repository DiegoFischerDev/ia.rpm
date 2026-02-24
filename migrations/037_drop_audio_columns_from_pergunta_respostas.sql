-- Remover colunas relacionadas com áudio de ch_pergunta_respostas.
-- IMPORTANTE: só correr esta migration depois de a aplicação deixar de usar áudio.

ALTER TABLE ch_pergunta_respostas
  DROP COLUMN audio_url,
  DROP COLUMN audio_transcricao,
  DROP COLUMN audio_data,
  DROP COLUMN audio_mimetype;

