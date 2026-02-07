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
    `UPDATE ch_leads SET estado_docs = ?, docs_enviados = 1, docs_enviados_em = NOW(), updated_at = NOW() WHERE id = ?`,
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
  let gestoraNome = null;
  if (gestoraId) {
    const g = await getGestoraById(gestoraId);
    if (g && g.nome) gestoraNome = g.nome.trim() || null;
  }
  await query(
    'UPDATE ch_leads SET gestora_id = ?, gestora_nome = ?, updated_at = NOW() WHERE id = ?',
    [gestoraId || null, gestoraNome, leadId]
  );
}

/** Atualiza estado_docs (ex.: sem_docs). */
async function updateLeadEstadoDocs(leadId, estadoDocs) {
  await query(
    'UPDATE ch_leads SET estado_docs = ?, updated_at = NOW() WHERE id = ?',
    [estadoDocs || null, leadId]
  );
}

/** Lista para Rafa: por estado_conversa (ex.: com_rafa). */
async function getLeadsForRafa(estadoConversa) {
  if (!estadoConversa || typeof estadoConversa !== 'string') return [];
  const rows = await query(
    'SELECT id, nome, email, whatsapp_number, estado_conversa, estado_docs, updated_at FROM ch_leads WHERE estado_conversa = ? ORDER BY updated_at DESC',
    [estadoConversa.trim()]
  );
  return rows;
}

/** Conta leads em estado_conversa = com_rafa (para badge no menu). */
async function getLeadsForRafaCount() {
  const rows = await query(
    'SELECT COUNT(*) AS n FROM ch_leads WHERE estado_conversa = ?',
    ['com_rafa']
  );
  return (rows[0] && rows[0].n) ? Number(rows[0].n) : 0;
}

/** Dashboard: lista todos os leads. */
async function getAllLeads() {
  const rows = await query(
    'SELECT id, whatsapp_number, nome, email, estado_conversa, estado_docs, docs_enviados, docs_enviados_em, gestora_id, gestora_nome, created_at, updated_at FROM ch_leads ORDER BY updated_at DESC'
  );
  return rows;
}

/** Dashboard: atualizar lead (admin). */
async function updateLeadAdmin(id, dados) {
  if (!dados || typeof dados !== 'object') return;
  const allowed = ['nome', 'email', 'estado_conversa', 'estado_docs', 'gestora_id', 'gestora_nome'];
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
  // Se gestora_id foi alterado e gestora_nome não foi enviado, sincronizar nome da gestora
  if ('gestora_id' in dados && !('gestora_nome' in dados)) {
    const gid = dados.gestora_id === '' || dados.gestora_id === null ? null : parseInt(dados.gestora_id, 10) || null;
    if (gid) {
      const g = await getGestoraById(gid);
      set.push('gestora_nome = ?');
      values.push((g && g.nome) ? g.nome.trim() || null : null);
    } else {
      set.push('gestora_nome = ?');
      values.push(null);
    }
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
  await query('UPDATE ch_leads SET gestora_id = NULL, gestora_nome = NULL WHERE gestora_id = ?', [id]);
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
  updateLeadEstadoDocs,
  getLeadsForRafa,
  getLeadsForRafaCount,
  getAllLeads,
  updateLeadAdmin,
  deleteLead,
  getAllGestoras,
  createGestora,
  updateGestora,
  deleteGestora,
};
