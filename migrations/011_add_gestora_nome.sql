-- =============================================================================
-- Adicionar coluna gestora_nome à tabela ch_leads (cópia do nome da gestora)
-- Executar no phpMyAdmin (base de dados partilhada evo/ia-app).
-- =============================================================================

ALTER TABLE ch_leads
  ADD COLUMN gestora_nome VARCHAR(255) NULL AFTER gestora_id;

-- Preencher a partir da tabela ch_gestoras para leads que já têm gestora_id
UPDATE ch_leads l
  INNER JOIN ch_gestoras g ON l.gestora_id = g.id
SET l.gestora_nome = g.nome;
