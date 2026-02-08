-- Colar no phpMyAdmin (separador SQL) e executar. Não cortar linhas ao copiar.

CREATE TABLE IF NOT EXISTS ch_perguntas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  texto TEXT NOT NULL,
  frequencia INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ch_perguntas_frequencia (frequencia)
);

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
  CONSTRAINT fk_resposta_pergunta FOREIGN KEY (pergunta_id) REFERENCES ch_perguntas (id) ON DELETE CASCADE,
  CONSTRAINT fk_resposta_gestora FOREIGN KEY (gestora_id) REFERENCES ch_gestoras (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ch_duvidas_pendentes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contacto_whatsapp VARCHAR(32) NOT NULL,
  lead_id INT UNSIGNED NULL,
  texto TEXT NOT NULL,
  origem VARCHAR(32) NOT NULL DEFAULT 'evo',
  respondida TINYINT(1) NOT NULL DEFAULT 0,
  pergunta_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_respondida (respondida),
  KEY idx_pergunta (pergunta_id),
  CONSTRAINT fk_duvida_lead FOREIGN KEY (lead_id) REFERENCES ch_leads (id) ON DELETE SET NULL,
  CONSTRAINT fk_duvida_pergunta FOREIGN KEY (pergunta_id) REFERENCES ch_perguntas (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ch_pergunta_embeddings (
  pergunta_id INT UNSIGNED NOT NULL PRIMARY KEY,
  embedding JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_embedding_pergunta FOREIGN KEY (pergunta_id) REFERENCES ch_perguntas (id) ON DELETE CASCADE
);
