-- Embeddings das dúvidas pendentes (para o Evo evitar duplicados por similaridade)
CREATE TABLE IF NOT EXISTS ch_duvida_pendente_embeddings (
  duvida_id INT UNSIGNED NOT NULL PRIMARY KEY,
  embedding JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_embedding_duvida FOREIGN KEY (duvida_id) REFERENCES ch_duvidas_pendentes (id) ON DELETE CASCADE
);
