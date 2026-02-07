-- Remover colunas que não são partilhadas com Rafa (dados só para gestora e pre-fill local no browser)
-- Esses dados passam a ser guardados apenas no IndexedDB do lead e enviados no email à gestora.
ALTER TABLE ch_leads
  DROP COLUMN estado_civil,
  DROP COLUMN num_dependentes,
  DROP COLUMN anos_emprego_atual,
  DROP COLUMN vinculo_laboral,
  DROP COLUMN disponibilidade_fiador;
