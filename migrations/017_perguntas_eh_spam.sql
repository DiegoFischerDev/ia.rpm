-- Marcar perguntas como spam: match com estas não gera resposta às gestoras nem grava dúvida
ALTER TABLE ch_perguntas ADD COLUMN eh_spam TINYINT(1) NOT NULL DEFAULT 0 AFTER frequencia;
