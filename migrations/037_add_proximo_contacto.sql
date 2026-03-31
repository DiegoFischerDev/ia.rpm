-- Adicionar coluna de data para próximo contacto (dashboard)
ALTER TABLE ch_leads
  ADD COLUMN proximo_contacto_em DATE NULL AFTER comentario;

