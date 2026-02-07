-- =============================================================================
-- Email pessoal (login) vs email para encaminhamento dos leads
-- Executar no phpMyAdmin (base de dados partilhada).
-- =============================================================================
-- email = email pessoal (login); só o admin pode alterar
-- email_para_leads = email para onde enviamos os docs dos leads; a gestora pode alterar no Perfil

ALTER TABLE ch_gestoras
  ADD COLUMN email_para_leads VARCHAR(255) NULL AFTER email;

-- Preencher com o email atual para gestoras existentes
UPDATE ch_gestoras SET email_para_leads = email WHERE email_para_leads IS NULL;
