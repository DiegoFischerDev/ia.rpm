-- Flag separada para "quer falar com Rafa": não faz parte do estado_conversa.
-- Permite que o lead use simulador/duvida/gestora e continue a aparecer na lista da Rafa até ela remover a flag.

ALTER TABLE ch_leads
  ADD COLUMN quer_falar_com_rafa TINYINT(1) NOT NULL DEFAULT 0 AFTER estado_docs;

-- Migrar leads que estavam em estado_conversa = 'com_rafa'
UPDATE ch_leads SET quer_falar_com_rafa = 1 WHERE estado_conversa = 'com_rafa';
UPDATE ch_leads SET estado_conversa = 'aguardando_escolha' WHERE quer_falar_com_rafa = 1;
