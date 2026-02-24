-- Limpar perguntas e respostas antigas (texto/áudio) para recriar base em texto.
-- ATENÇÃO: esta migration apaga TODAS as dúvidas e respostas existentes
-- nas tabelas ch_duvidas e ch_pergunta_respostas.

SET FOREIGN_KEY_CHECKS = 0;

-- Apagar respostas ligadas a dúvidas (inclui áudio e transcrições antigas)
DELETE FROM ch_pergunta_respostas;

-- Apagar todas as dúvidas (pendentes e FAQ)
DELETE FROM ch_duvidas;

SET FOREIGN_KEY_CHECKS = 1;

