-- Áudios da Rafa usados pelo evo para comunicar com os leads (ex.: boas-vindas)
CREATE TABLE IF NOT EXISTS ch_audios_rafa (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(64) NOT NULL UNIQUE,
  nome VARCHAR(255) NOT NULL,
  audio_data LONGBLOB NULL,
  mimetype VARCHAR(50) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ch_audios_rafa_codigo (codigo)
);

-- Primeiro áudio: Boas vindas
INSERT INTO ch_audios_rafa (codigo, nome) VALUES ('boas_vindas', 'Boas vindas')
ON DUPLICATE KEY UPDATE nome = VALUES(nome);
