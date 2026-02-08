-- Marcar dúvidas pendentes como spam (admin); gestoras não veem dúvidas marcadas como spam
ALTER TABLE ch_duvidas_pendentes ADD COLUMN eh_spam TINYINT(1) NOT NULL DEFAULT 0 AFTER pergunta_id;
