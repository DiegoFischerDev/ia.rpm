const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
    });
  }
  return pool;
}

async function query(sql, params) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function getLeadById(id) {
  const rows = await query('SELECT * FROM ch_leads WHERE id = ?', [id]);
  return rows[0] || null;
}

async function updateLeadDocsEnviados(id) {
  await query(
    `UPDATE ch_leads SET estado = ?, docs_enviados = 1, docs_enviados_em = NOW(), updated_at = NOW() WHERE id = ?`,
    ['docs_enviados', id]
  );
}

async function updateLeadDados(id, dados) {
  if (!dados || typeof dados !== 'object') return;
  const allowed = ['nome'];
  const set = [];
  const values = [];
  for (const key of allowed) {
    if (!(key in dados)) continue;
    let val = dados[key];
    if (typeof val === 'string') val = val.trim() || null;
    else val = null;
    set.push(`${key} = ?`);
    values.push(val);
  }
  if (set.length === 0) return;
  set.push('updated_at = NOW()');
  values.push(id);
  await query(
    `UPDATE ch_leads SET ${set.join(', ')} WHERE id = ?`,
    values
  );
}

async function setEmailVerification(id, pendingNome, pendingEmail, code) {
  await query(
    `UPDATE ch_leads SET pending_nome = ?, pending_email = ?, email_verification_code = ?, email_verification_sent_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [pendingNome || null, pendingEmail || null, code || null, id]
  );
}

async function confirmEmailAndSetLead(id) {
  const rows = await query(
    'SELECT pending_nome, pending_email, email_verification_code, email_verification_sent_at FROM ch_leads WHERE id = ?',
    [id]
  );
  const r = rows[0];
  if (!r || !r.pending_email || !r.email_verification_code) return false;
  const sentAt = r.email_verification_sent_at ? new Date(r.email_verification_sent_at).getTime() : 0;
  const expiryMs = 15 * 60 * 1000; // 15 min
  if (Date.now() - sentAt > expiryMs) return false;
  await query(
    `UPDATE ch_leads SET nome = ?, email = ?, pending_nome = NULL, pending_email = NULL, email_verification_code = NULL, email_verification_sent_at = NULL, updated_at = NOW() WHERE id = ?`,
    [r.pending_nome || null, r.pending_email, id]
  );
  return true;
}

async function getGestoraById(id) {
  const rows = await query('SELECT id, nome, email, whatsapp, ativo FROM ch_gestoras WHERE id = ?', [id]);
  return rows[0] || null;
}

async function getActiveGestoras() {
  const rows = await query('SELECT id, nome, email, whatsapp FROM ch_gestoras WHERE ativo = 1 ORDER BY id ASC');
  return rows;
}

/** Devolve a gestora ativa com menos leads (distribuição igual entre gestoras). */
async function getNextGestoraForLead() {
  const rows = await query(
    `SELECT g.id, g.nome, g.email, g.whatsapp
     FROM ch_gestoras g
     LEFT JOIN ch_leads l ON l.gestora_id = g.id
     WHERE g.ativo = 1
     GROUP BY g.id, g.nome, g.email, g.whatsapp
     ORDER BY COUNT(l.id) ASC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function updateLeadGestora(leadId, gestoraId) {
  await query(
    'UPDATE ch_leads SET gestora_id = ?, updated_at = NOW() WHERE id = ?',
    [gestoraId || null, leadId]
  );
}

async function updateLeadEstado(leadId, estado) {
  await query(
    'UPDATE ch_leads SET estado = ?, updated_at = NOW() WHERE id = ?',
    [estado || null, leadId]
  );
}

/** Lista para Rafa: apenas id, nome, email e whatsapp (sem dados sensíveis). */
async function getLeadsForRafa(estado) {
  if (!estado || typeof estado !== 'string') return [];
  const rows = await query(
    'SELECT id, nome, email, whatsapp_number, estado_anterior, updated_at FROM ch_leads WHERE estado = ? ORDER BY updated_at DESC',
    [estado.trim()]
  );
  return rows;
}

/** Dashboard: lista todos os leads. */
async function getAllLeads() {
  const rows = await query(
    'SELECT id, whatsapp_number, nome, email, estado, estado_anterior, docs_enviados, docs_enviados_em, gestora_id, created_at, updated_at FROM ch_leads ORDER BY updated_at DESC'
  );
  return rows;
}

/** Dashboard: atualizar lead (admin). */
async function updateLeadAdmin(id, dados) {
  if (!dados || typeof dados !== 'object') return;
  const allowed = ['nome', 'email', 'estado', 'gestora_id'];
  const set = [];
  const values = [];
  for (const key of allowed) {
    if (!(key in dados)) continue;
    let val = dados[key];
    if (typeof val === 'string') val = val.trim() || null;
    else if (key === 'gestora_id' && (val === '' || val === null)) val = null;
    else if (key === 'gestora_id') val = parseInt(val, 10) || null;
    set.push(`${key} = ?`);
    values.push(val);
  }
  if (set.length === 0) return;
  set.push('updated_at = NOW()');
  values.push(id);
  await query(`UPDATE ch_leads SET ${set.join(', ')} WHERE id = ?`, values);
}

/** Dashboard: apagar lead. */
async function deleteLead(id) {
  await query('DELETE FROM ch_leads WHERE id = ?', [id]);
}

/** Dashboard: lista todas as gestoras. */
async function getAllGestoras() {
  const rows = await query('SELECT id, nome, email, whatsapp, ativo, created_at, updated_at FROM ch_gestoras ORDER BY id ASC');
  return rows;
}

/** Dashboard: criar gestora. */
async function createGestora(dados) {
  const { nome, email, whatsapp, ativo } = dados || {};
  if (!nome || !email || !whatsapp) throw new Error('Nome, email e whatsapp são obrigatórios.');
  await query(
    'INSERT INTO ch_gestoras (nome, email, whatsapp, ativo) VALUES (?, ?, ?, ?)',
    [String(nome).trim(), String(email).trim().toLowerCase(), String(whatsapp).replace(/\D/g, ''), ativo ? 1 : 0]
  );
  const rows = await query('SELECT id, nome, email, whatsapp, ativo, created_at, updated_at FROM ch_gestoras ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

/** Dashboard: atualizar gestora. */
async function updateGestora(id, dados) {
  if (!dados || typeof dados !== 'object') return;
  const allowed = ['nome', 'email', 'whatsapp', 'ativo'];
  const set = [];
  const values = [];
  for (const key of allowed) {
    if (!(key in dados)) continue;
    let val = dados[key];
    if (key === 'ativo') val = val ? 1 : 0;
    else if (typeof val === 'string') val = key === 'email' ? val.trim().toLowerCase() : (key === 'whatsapp' ? val.replace(/\D/g, '') : val.trim());
    set.push(`${key} = ?`);
    values.push(val);
  }
  if (set.length === 0) return;
  set.push('updated_at = NOW()');
  values.push(id);
  await query(`UPDATE ch_gestoras SET ${set.join(', ')} WHERE id = ?`, values);
}

/** Dashboard: apagar gestora. */
async function deleteGestora(id) {
  await query('UPDATE ch_leads SET gestora_id = NULL WHERE gestora_id = ?', [id]);
  await query('DELETE FROM ch_gestoras WHERE id = ?', [id]);
}

module.exports = {
  getPool,
  query,
  getLeadById,
  updateLeadDocsEnviados,
  updateLeadDados,
  setEmailVerification,
  confirmEmailAndSetLead,
  getGestoraById,
  getActiveGestoras,
  getNextGestoraForLead,
  updateLeadGestora,
  updateLeadEstado,
  getLeadsForRafa,
  getAllLeads,
  updateLeadAdmin,
  deleteLead,
  getAllGestoras,
  createGestora,
  updateGestora,
  deleteGestora,
};
