ALTER TABLE ch_leads
  ADD COLUMN atendimento_status VARCHAR(32) NULL AFTER proximo_contacto_em,
  ADD COLUMN atendimento_solicitado_em DATETIME NULL AFTER atendimento_status,
  ADD COLUMN atendimento_realizado_em DATETIME NULL AFTER atendimento_solicitado_em;

CREATE INDEX idx_ch_leads_atendimento_status ON ch_leads (atendimento_status);
CREATE INDEX idx_ch_leads_atendimento_gestora ON ch_leads (gestora_id, atendimento_status, atendimento_solicitado_em);
