-- Armazenar RGPD na própria tabela ch_gestoras (persiste entre deploys)
-- Um PDF por gestora; não usar SELECT * para listar gestoras para não carregar o blob.
ALTER TABLE ch_gestoras ADD COLUMN rgpd_pdf LONGBLOB NULL;
