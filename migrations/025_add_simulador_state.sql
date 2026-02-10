-- Estado do fluxo do simulador por lead (evo)
ALTER TABLE ch_leads
  ADD COLUMN simulador_step VARCHAR(32) NULL,
  ADD COLUMN simulador_age INT NULL,
  ADD COLUMN simulador_valor_imovel DECIMAL(12,2) NULL,
  ADD COLUMN simulador_anos INT NULL;
