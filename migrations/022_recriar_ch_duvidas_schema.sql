-- Recriar apenas o schema de dúvidas (executar depois de apagar as tabelas).
-- Ordem para apagar (por causa das FKs):
--   1. ch_pergunta_respostas  2. ch_duvidas  3. ch_pergunta_embeddings
--   4. ch_duvida_pendente_embeddings  5. ch_duvidas_pendentes  6. ch_perguntas

-- Opcional: descomentar as linhas abaixo para apagar tudo antes de recriar
-- DROP TABLE IF EXISTS ch_pergunta_respostas;
-- DROP TABLE IF EXISTS ch_duvidas;
-- DROP TABLE IF EXISTS ch_pergunta_embeddings;
-- DROP TABLE IF EXISTS ch_duvida_pendente_embeddings;
-- DROP TABLE IF EXISTS ch_duvidas_pendentes;
-- DROP TABLE IF EXISTS ch_perguntas;

-- 1. Tabela unificada: perguntas FAQ (eh_pendente=0) + dúvidas pendentes (eh_pendente=1)
-- embedding na própria tabela (JSON); evo escreve/ lê para busca por similaridade
CREATE TABLE IF NOT EXISTS ch_duvidas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  texto TEXT NOT NULL,
  eh_pendente TINYINT(1) NOT NULL DEFAULT 1,
  contacto_whatsapp VARCHAR(32) NULL,
  lead_id INT UNSIGNED NULL,
  origem VARCHAR(32) NULL DEFAULT 'evo',
  frequencia INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  embedding JSON NULL,
  KEY idx_eh_pendente (eh_pendente),
  KEY idx_frequencia (frequencia),
  KEY idx_lead (lead_id),
  CONSTRAINT fk_ch_duvidas_lead FOREIGN KEY (lead_id) REFERENCES ch_leads (id) ON DELETE SET NULL
);

-- 2. Respostas das gestoras por “pergunta” (pergunta_id = ch_duvidas.id)
CREATE TABLE IF NOT EXISTS ch_pergunta_respostas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pergunta_id INT UNSIGNED NOT NULL,
  gestora_id INT UNSIGNED NOT NULL,
  texto TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_pergunta_gestora (pergunta_id, gestora_id),
  KEY idx_pergunta (pergunta_id),
  KEY idx_gestora (gestora_id),
  CONSTRAINT fk_resposta_duvida FOREIGN KEY (pergunta_id) REFERENCES ch_duvidas (id) ON DELETE CASCADE,
  CONSTRAINT fk_resposta_gestora FOREIGN KEY (gestora_id) REFERENCES ch_gestoras (id) ON DELETE CASCADE
);
