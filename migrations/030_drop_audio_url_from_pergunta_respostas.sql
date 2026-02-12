-- Remover coluna audio_url: o URL é sempre derivado de pergunta_id/gestora_id (áudio em audio_data).

ALTER TABLE ch_pergunta_respostas
  DROP COLUMN audio_url;
