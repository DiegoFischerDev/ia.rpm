-- Um número WhatsApp = um lead (impede duplicados e corrida entre pedidos paralelos à API de integração).
-- Antes de executar, resolver duplicados existentes, por exemplo:
--   SELECT whatsapp_number, COUNT(*) AS c FROM ch_leads GROUP BY whatsapp_number HAVING c > 1;

ALTER TABLE ch_leads
  DROP INDEX idx_ch_leads_whatsapp_number,
  ADD UNIQUE KEY ux_ch_leads_whatsapp_number (whatsapp_number);
