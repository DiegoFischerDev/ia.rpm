-- Adicionar coluna de comentário interno às leads
ALTER TABLE ch_leads
  ADD COLUMN comentario TEXT NULL AFTER gestora_nome;

