-- Vínculo laboral e disponibilidade de fiador (pergunta condicional quando não é contrato efetivo)
ALTER TABLE ch_leads
  ADD COLUMN vinculo_laboral VARCHAR(64) NULL AFTER anos_emprego_atual,
  ADD COLUMN disponibilidade_fiador VARCHAR(32) NULL AFTER vinculo_laboral;
