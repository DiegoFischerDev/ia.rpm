-- Entrada (redução) para o simulador por lead
ALTER TABLE ch_leads
  ADD COLUMN simulador_entrada DECIMAL(12,2) NULL;
