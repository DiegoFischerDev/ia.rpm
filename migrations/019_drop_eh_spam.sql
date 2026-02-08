-- Remover coluna eh_spam (feature spam removida)
ALTER TABLE ch_perguntas DROP COLUMN eh_spam;
ALTER TABLE ch_duvidas_pendentes DROP COLUMN eh_spam;
