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
  const rows = await query('SELECT * FROM gestora_de_credito WHERE id = ?', [id]);
  return rows[0] || null;
}

async function updateLeadDocsEnviados(id) {
  await query(
    `UPDATE gestora_de_credito SET estado = ?, docs_enviados = 1, docs_enviados_em = NOW(), updated_at = NOW() WHERE id = ?`,
    ['docs_enviados', id]
  );
}

async function updateLeadDados(id, dados) {
  if (!dados || typeof dados !== 'object') return;
  const allowed = ['nome', 'estado_civil', 'num_dependentes'];
  const set = [];
  const values = [];
  for (const key of allowed) {
    if (!(key in dados)) continue;
    let val = dados[key];
    if (key === 'num_dependentes') val = val !== undefined && val !== null ? String(val).trim() : null;
    else if (typeof val === 'string') val = val.trim() || null;
    else val = null;
    set.push(`${key} = ?`);
    values.push(val);
  }
  if (set.length === 0) return;
  set.push('updated_at = NOW()');
  values.push(id);
  await query(
    `UPDATE gestora_de_credito SET ${set.join(', ')} WHERE id = ?`,
    values
  );
}

async function setEmailVerification(id, pendingNome, pendingEmail, code) {
  await query(
    `UPDATE gestora_de_credito SET pending_nome = ?, pending_email = ?, email_verification_code = ?, email_verification_sent_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [pendingNome || null, pendingEmail || null, code || null, id]
  );
}

async function confirmEmailAndSetLead(id) {
  const rows = await query(
    'SELECT pending_nome, pending_email, email_verification_code, email_verification_sent_at FROM gestora_de_credito WHERE id = ?',
    [id]
  );
  const r = rows[0];
  if (!r || !r.pending_email || !r.email_verification_code) return false;
  const sentAt = r.email_verification_sent_at ? new Date(r.email_verification_sent_at).getTime() : 0;
  const expiryMs = 15 * 60 * 1000; // 15 min
  if (Date.now() - sentAt > expiryMs) return false;
  await query(
    `UPDATE gestora_de_credito SET nome = ?, email = ?, pending_nome = NULL, pending_email = NULL, email_verification_code = NULL, email_verification_sent_at = NULL, updated_at = NOW() WHERE id = ?`,
    [r.pending_nome || null, r.pending_email, id]
  );
  return true;
}

module.exports = {
  getPool,
  query,
  getLeadById,
  updateLeadDocsEnviados,
  updateLeadDados,
  setEmailVerification,
  confirmEmailAndSetLead,
};
