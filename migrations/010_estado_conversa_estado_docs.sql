-- =============================================================================
-- Dividir estado do lead em duas colunas: estado_conversa e estado_docs
-- Executar no phpMyAdmin (base de dados partilhada evo/ia-app).
-- =============================================================================

-- 1) Adicionar as novas colunas (com valores por defeito)
ALTER TABLE ch_leads
  ADD COLUMN estado_conversa VARCHAR(32) NOT NULL DEFAULT 'aguardando_escolha' AFTER estado_anterior,
  ADD COLUMN estado_docs VARCHAR(32) NOT NULL DEFAULT 'aguardando_docs' AFTER estado_conversa;

-- 2) Migrar dados do estado antigo para as novas colunas
-- estado_conversa: aguardando_escolha | com_joana | com_gestora | com_rafa
-- estado_docs: aguardando_docs | sem_docs | docs_enviados
UPDATE ch_leads SET
  estado_conversa = CASE
    WHEN estado = 'aguardando_escolha' THEN 'aguardando_escolha'
    WHEN estado = 'em_conversa' THEN 'com_joana'
    WHEN estado IN ('aguardando_docs', 'sem_docs', 'docs_enviados') THEN 'com_gestora'
    WHEN estado = 'falar_com_rafa' THEN 'com_rafa'
    ELSE 'aguardando_escolha'
  END,
  estado_docs = CASE
    WHEN estado = 'docs_enviados' THEN 'docs_enviados'
    WHEN estado = 'sem_docs' THEN 'sem_docs'
    ELSE 'aguardando_docs'
  END
WHERE estado IS NOT NULL AND estado != '';

-- 3) Garantir que quem tem docs_enviados=1 fica com estado_docs correto
UPDATE ch_leads SET estado_docs = 'docs_enviados' WHERE docs_enviados = 1;

-- 4) Remover as colunas antigas
ALTER TABLE ch_leads
  DROP COLUMN estado,
  DROP COLUMN estado_anterior;
