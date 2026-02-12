-- Respostas das gestoras com suporte a áudio
-- Adiciona colunas para guardar URL do áudio e transcrição de apoio a embeddings.

ALTER TABLE ch_pergunta_respostas
  ADD COLUMN audio_url VARCHAR(500) NULL AFTER texto,
  ADD COLUMN audio_transcricao TEXT NULL AFTER audio_url;

