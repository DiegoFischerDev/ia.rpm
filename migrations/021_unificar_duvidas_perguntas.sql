-- Unificar ch_perguntas + ch_duvidas_pendentes + embeddings numa única tabela ch_duvidas
-- eh_pendente: 1 = pendente (sem resposta no FAQ), 0 = respondida (no FAQ com respostas)
-- embedding: coluna na própria tabela (JSON)

-- 1. Criar nova tabela ch_duvidas
CREATE TABLE IF NOT EXISTS ch_duvidas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  texto TEXT NOT NULL,
  eh_pendente TINYINT(1) NOT NULL DEFAULT 1,
  eh_spam TINYINT(1) NOT NULL DEFAULT 0,
  contacto_whatsapp VARCHAR(32) NULL,
  lead_id INT UNSIGNED NULL,
  origem VARCHAR(32) NULL DEFAULT 'evo',
  frequencia INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  embedding JSON NULL,
  KEY idx_eh_pendente (eh_pendente),
  KEY idx_eh_spam (eh_spam),
  KEY idx_frequencia (frequencia),
  KEY idx_lead (lead_id),
  CONSTRAINT fk_duvida_lead FOREIGN KEY (lead_id) REFERENCES ch_leads (id) ON DELETE SET NULL
);

-- 2. Copiar perguntas do FAQ (eh_pendente=0) com embedding e eh_spam
INSERT INTO ch_duvidas (id, texto, eh_pendente, eh_spam, frequencia, created_at, updated_at, embedding)
SELECT p.id, p.texto, 0, 0, p.frequencia, p.created_at, p.updated_at, e.embedding
FROM ch_perguntas p
LEFT JOIN ch_pergunta_embeddings e ON e.pergunta_id = p.id;

-- 3. Ajustar AUTO_INCREMENT para não colidir com ids que vamos inserir a seguir
SET @maxid = (SELECT COALESCE(MAX(id), 0) FROM ch_duvidas);
SET @sql = CONCAT('ALTER TABLE ch_duvidas AUTO_INCREMENT = ', @maxid + 1);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Copiar dúvidas pendentes (respondida=0) com embedding e eh_spam
INSERT INTO ch_duvidas (texto, eh_pendente, eh_spam, contacto_whatsapp, lead_id, origem, created_at, updated_at, embedding)
SELECT d.texto, 1, 0, d.contacto_whatsapp, d.lead_id, d.origem, d.created_at, d.updated_at, e.embedding
FROM ch_duvidas_pendentes d
LEFT JOIN ch_duvida_pendente_embeddings e ON e.duvida_id = d.id
WHERE d.respondida = 0;

-- 5. Remover FKs que referenciam tabelas que vamos dropar
ALTER TABLE ch_pergunta_respostas DROP FOREIGN KEY fk_resposta_pergunta;
ALTER TABLE ch_duvidas_pendentes DROP FOREIGN KEY fk_duvida_pergunta;
ALTER TABLE ch_duvidas_pendentes DROP FOREIGN KEY fk_duvida_lead;

-- 6. ch_pergunta_respostas.pergunta_id passa a referenciar ch_duvidas (mesmo nome de coluna)
ALTER TABLE ch_pergunta_respostas
  ADD CONSTRAINT fk_resposta_duvida FOREIGN KEY (pergunta_id) REFERENCES ch_duvidas (id) ON DELETE CASCADE;

-- 7. Dropar tabelas antigas
DROP TABLE IF EXISTS ch_duvida_pendente_embeddings;
DROP TABLE IF EXISTS ch_pergunta_embeddings;
DROP TABLE IF EXISTS ch_duvidas_pendentes;
DROP TABLE IF EXISTS ch_perguntas;
