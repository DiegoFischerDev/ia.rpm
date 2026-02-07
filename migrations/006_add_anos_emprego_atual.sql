-- Campo para a gestora: há quantos anos o lead trabalha no emprego atual
ALTER TABLE ch_leads
  ADD COLUMN anos_emprego_atual VARCHAR(64) NULL AFTER num_dependentes;
