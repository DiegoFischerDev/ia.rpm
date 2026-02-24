-- Adicionar novo áudio \"Boas vindas 2\" para não sobrescrever o original.

INSERT INTO ch_audios_rafa (codigo, nome)
SELECT 'boas_vindas_2', 'Boas vindas 2'
WHERE NOT EXISTS (
  SELECT 1 FROM ch_audios_rafa WHERE codigo = 'boas_vindas_2'
);

