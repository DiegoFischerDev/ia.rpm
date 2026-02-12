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
  const rows = await query('SELECT id, nome, email, email_para_leads, whatsapp, foto_perfil, boas_vindas, ativo, updated_at FROM ch_gestoras WHERE id = ?', [id]);
  return rows[0] || null;
}

/** Para login: gestora por email (inclui password). */
async function getGestoraByEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  const rows = await query(
    'SELECT id, nome, email, whatsapp, ativo, password FROM ch_gestoras WHERE email = ?',
    [e]
  );
  return rows[0] || null;
}

/** Lista leads atribuídos a uma gestora (dashboard gestora). */
async function getLeadsByGestoraId(gestoraId) {
  const rows = await query(
    'SELECT id, whatsapp_number, nome, email, estado_conversa, estado_docs, quer_falar_com_rafa, docs_enviados, docs_enviados_em, gestora_id, gestora_nome, comentario, created_at, updated_at FROM ch_leads WHERE gestora_id = ? ORDER BY updated_at DESC',
    [gestoraId]
  );
  return rows;
}

async function setGestoraPassword(gestoraId, hashedPassword) {
  await query(
    'UPDATE ch_gestoras SET password = ?, password_reset_token = NULL, password_reset_expires_at = NULL, updated_at = NOW() WHERE id = ?',
    [hashedPassword || null, gestoraId]
  );
}

async function setGestoraPasswordResetToken(gestoraId, token, expiresAt) {
  await query(
    'UPDATE ch_gestoras SET password_reset_token = ?, password_reset_expires_at = ? WHERE id = ?',
    [token || null, expiresAt || null, gestoraId]
  );
}

/** Por token de reset (só devolve se não expirado). */
async function getGestoraByResetToken(token) {
  if (!token || typeof token !== 'string') return null;
  const rows = await query(
    'SELECT id, nome, email FROM ch_gestoras WHERE password_reset_token = ? AND password_reset_expires_at > NOW()',
    [token.trim()]
  );
  return rows[0] || null;
}

async function clearGestoraPasswordReset(gestoraId) {
  await query(
    'UPDATE ch_gestoras SET password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = ?',
    [gestoraId]
  );
}

async function getActiveGestoras() {
  const rows = await query('SELECT id, nome, email, whatsapp FROM ch_gestoras WHERE ativo = 1 ORDER BY id ASC');
  return rows;
}

/** Devolve a gestora ativa com menos leads (distribuição igual entre gestoras). */
async function getNextGestoraForLead() {
  const rows = await query(
    `SELECT g.id, g.nome, g.email, g.email_para_leads, g.whatsapp
     FROM ch_gestoras g
     LEFT JOIN ch_leads l ON l.gestora_id = g.id
     WHERE g.ativo = 1
     GROUP BY g.id, g.nome, g.email, g.email_para_leads, g.whatsapp
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

/** Devolve a gestora mapeada no sistema antigo para o email do lead, ou null. */
async function getGestoraFromLegacyMap(email) {
  if (!email || typeof email !== 'string') return null;
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) return null;
  const rows = await query(
    'SELECT gestora_id, gestora_nome FROM ch_leads_legacy_gestora_map WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  const row = rows[0];
  if (!row || row.gestora_id == null) return null;
  return { id: row.gestora_id, nome: row.gestora_nome || null };
}

/** Atualiza estado_docs (ex.: sem_docs). */
async function updateLeadEstadoDocs(leadId, estadoDocs) {
  await query(
    'UPDATE ch_leads SET estado_docs = ?, updated_at = NOW() WHERE id = ?',
    [estadoDocs || null, leadId]
  );
}

/** Lista leads que querem falar com a Rafa (flag quer_falar_com_rafa = 1). */
async function getLeadsForRafa() {
  const rows = await query(
    'SELECT id, nome, email, whatsapp_number, estado_conversa, estado_docs, quer_falar_com_rafa, updated_at FROM ch_leads WHERE quer_falar_com_rafa = 1 ORDER BY updated_at DESC'
  );
  return rows;
}

/** Conta leads com quer_falar_com_rafa = 1 (para badge no menu). */
async function getLeadsForRafaCount() {
  const rows = await query(
    'SELECT COUNT(*) AS n FROM ch_leads WHERE quer_falar_com_rafa = 1'
  );
  return (rows[0] && rows[0].n) ? Number(rows[0].n) : 0;
}

/** Dashboard: lista todos os leads. */
async function getAllLeads() {
  const rows = await query(
    'SELECT id, whatsapp_number, nome, email, estado_conversa, estado_docs, quer_falar_com_rafa, docs_enviados, docs_enviados_em, gestora_id, gestora_nome, comentario, created_at, updated_at FROM ch_leads ORDER BY updated_at DESC'
  );
  return rows;
}

/** Dashboard: atualizar lead (admin). */
async function updateLeadAdmin(id, dados) {
  if (!dados || typeof dados !== 'object') return;
  const allowed = ['nome', 'email', 'estado_conversa', 'estado_docs', 'gestora_id', 'gestora_nome', 'comentario', 'quer_falar_com_rafa'];
  const set = [];
  const values = [];
  for (const key of allowed) {
    if (!(key in dados)) continue;
    let val = dados[key];
    if (typeof val === 'string') val = val.trim() || null;
    else if (key === 'gestora_id' && (val === '' || val === null)) val = null;
    else if (key === 'gestora_id') val = parseInt(val, 10) || null;
    else if (key === 'quer_falar_com_rafa') val = val ? 1 : 0;
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
  const rows = await query('SELECT id, nome, email, email_para_leads, whatsapp, foto_perfil, boas_vindas, ativo, created_at, updated_at FROM ch_gestoras ORDER BY id ASC');
  return rows;
}

/** Dashboard admin: gestoras com contagens de leads por estado_docs. */
async function getGestorasWithLeadCounts() {
  const rows = await query(
    `SELECT g.id, g.nome, g.email, g.email_para_leads, g.whatsapp, g.ativo, g.created_at, g.updated_at,
       COUNT(l.id) AS total_leads,
       SUM(CASE WHEN l.estado_docs = 'aguardando_docs' THEN 1 ELSE 0 END) AS aguardando_docs,
       SUM(CASE WHEN l.estado_docs = 'docs_enviados' THEN 1 ELSE 0 END) AS docs_enviados,
       SUM(CASE WHEN l.estado_docs = 'credito_aprovado' THEN 1 ELSE 0 END) AS credito_aprovado,
       SUM(CASE WHEN l.estado_docs = 'agendado_escritura' THEN 1 ELSE 0 END) AS agendado_escritura,
       SUM(CASE WHEN l.estado_docs = 'escritura_realizada' THEN 1 ELSE 0 END) AS escritura_realizada,
       SUM(CASE WHEN l.estado_docs = 'inviavel' THEN 1 ELSE 0 END) AS inviavel
     FROM ch_gestoras g
     LEFT JOIN ch_leads l ON l.gestora_id = g.id
     GROUP BY g.id, g.nome, g.email, g.email_para_leads, g.whatsapp, g.ativo, g.created_at, g.updated_at
     ORDER BY g.id ASC`
  );
  return rows.map((r) => ({
    ...r,
    total_leads: Number(r.total_leads) || 0,
    aguardando_docs: Number(r.aguardando_docs) || 0,
    docs_enviados: Number(r.docs_enviados) || 0,
    credito_aprovado: Number(r.credito_aprovado) || 0,
    agendado_escritura: Number(r.agendado_escritura) || 0,
    escritura_realizada: Number(r.escritura_realizada) || 0,
    inviavel: Number(r.inviavel) || 0,
  }));
}

/** Dashboard: criar gestora. */
async function createGestora(dados) {
  const { nome, email, whatsapp, ativo, email_para_leads, foto_perfil, boas_vindas } = dados || {};
  if (!nome || !email || !whatsapp) throw new Error('Nome, email e whatsapp são obrigatórios.');
  const emailVal = String(email).trim().toLowerCase();
  const emailLeads = (email_para_leads != null && String(email_para_leads).trim() !== '')
    ? String(email_para_leads).trim().toLowerCase()
    : emailVal;
  await query(
    'INSERT INTO ch_gestoras (nome, email, email_para_leads, whatsapp, foto_perfil, boas_vindas, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      String(nome).trim(),
      emailVal,
      emailLeads,
      String(whatsapp).replace(/\D/g, ''),
      foto_perfil ? String(foto_perfil).trim() : null,
      boas_vindas ? String(boas_vindas).trim() : null,
      ativo ? 1 : 0,
    ]
  );
  const rows = await query('SELECT id, nome, email, email_para_leads, whatsapp, foto_perfil, boas_vindas, ativo, created_at, updated_at FROM ch_gestoras ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

/** Dashboard: atualizar gestora. */
async function updateGestora(id, dados) {
  if (!dados || typeof dados !== 'object') return;
  const allowed = ['nome', 'email', 'email_para_leads', 'whatsapp', 'foto_perfil', 'boas_vindas', 'ativo'];
  const set = [];
  const values = [];
  for (const key of allowed) {
    if (!(key in dados)) continue;
    let val = dados[key];
    if (key === 'ativo') val = val ? 1 : 0;
    else if (key === 'email_para_leads' && (val === '' || val === null)) val = null;
    else if ((key === 'foto_perfil' || key === 'boas_vindas') && (val === '' || val === null)) val = null;
    else if (typeof val === 'string') {
      if (key === 'email' || key === 'email_para_leads') val = val.trim().toLowerCase();
      else if (key === 'whatsapp') val = val.replace(/\D/g, '');
      else val = val.trim();
    }
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

/** RGPD da gestora: guardado na coluna rgpd_pdf de ch_gestoras (persiste entre deploys) */
async function saveGestoraRgpd(gestoraId, buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return;
  await query('UPDATE ch_gestoras SET rgpd_pdf = ?, updated_at = NOW() WHERE id = ?', [buffer, gestoraId]);
}

async function readGestoraRgpd(gestoraId) {
  const rows = await query('SELECT rgpd_pdf FROM ch_gestoras WHERE id = ?', [gestoraId]);
  const r = rows[0];
  if (!r || r.rgpd_pdf == null) return null;
  const content = r.rgpd_pdf;
  return Buffer.isBuffer(content) ? content : Buffer.from(content);
}

async function hasGestoraRgpd(gestoraId) {
  const rows = await query('SELECT 1 FROM ch_gestoras WHERE id = ? AND rgpd_pdf IS NOT NULL', [gestoraId]);
  return rows.length > 0;
}

// ---------- Dúvidas unificadas (eh_pendente=1 pendentes, eh_pendente=0 FAQ com respostas) ----------

/** Lista perguntas do FAQ (eh_pendente=0) ordenadas por frequência. */
async function listPerguntas() {
  return query(
    `SELECT d.id, d.texto, d.frequencia, d.created_at, d.updated_at,
            (SELECT COUNT(*) FROM ch_pergunta_respostas r WHERE r.pergunta_id = d.id) AS num_respostas
     FROM ch_duvidas d
     WHERE d.eh_pendente = 0
     ORDER BY d.frequencia DESC, d.updated_at DESC`
  );
}

async function getPerguntaById(id) {
  const rows = await query('SELECT id, texto, frequencia, created_at, updated_at FROM ch_duvidas WHERE id = ?', [id]);
  return rows[0] || null;
}

async function createPergunta(texto) {
  const t = typeof texto === 'string' ? texto.trim() : '';
  if (!t) return null;
  await query('INSERT INTO ch_duvidas (texto, eh_pendente) VALUES (?, 0)', [t]);
  const rows = await query('SELECT id, texto, frequencia, created_at, updated_at FROM ch_duvidas ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

async function updatePergunta(id, texto) {
  const t = typeof texto === 'string' ? texto.trim() : null;
  if (t === null) return;
  await query('UPDATE ch_duvidas SET texto = ?, updated_at = NOW() WHERE id = ?', [t, id]);
}

async function incrementPerguntaFrequencia(perguntaId) {
  await query('UPDATE ch_duvidas SET frequencia = frequencia + 1, updated_at = NOW() WHERE id = ?', [perguntaId]);
}

async function deletePergunta(id) {
  await query('DELETE FROM ch_duvidas WHERE id = ?', [id]);
}

/** Respostas de uma pergunta (com nome da gestora). pergunta_id referencia ch_duvidas.id.
 *  audio_in_db = 1 quando o áudio está guardado em audio_data. */
async function listRespostasByPerguntaId(perguntaId) {
  return query(
    `SELECT r.id, r.pergunta_id, r.gestora_id, r.texto, r.audio_transcricao, r.created_at, r.updated_at, g.nome AS gestora_nome,
     (r.audio_data IS NOT NULL AND LENGTH(r.audio_data) > 0) AS audio_in_db
     FROM ch_pergunta_respostas r
     JOIN ch_gestoras g ON g.id = r.gestora_id
     WHERE r.pergunta_id = ?
     ORDER BY r.updated_at ASC`,
    [perguntaId]
  );
}

async function getRespostaByPerguntaAndGestora(perguntaId, gestoraId) {
  const rows = await query(
    `SELECT id, pergunta_id, gestora_id, texto, audio_transcricao, created_at, updated_at,
     (audio_data IS NOT NULL AND LENGTH(audio_data) > 0) AS audio_in_db
     FROM ch_pergunta_respostas WHERE pergunta_id = ? AND gestora_id = ?`,
    [perguntaId, gestoraId]
  );
  return rows[0] || null;
}

/** Devolve apenas o áudio (blob + mimetype) de uma resposta, para servir em rotas GET. */
async function getRespostaAudioData(perguntaId, gestoraId) {
  const rows = await query(
    'SELECT audio_data, audio_mimetype FROM ch_pergunta_respostas WHERE pergunta_id = ? AND gestora_id = ?',
    [perguntaId, gestoraId]
  );
  const r = rows[0];
  if (!r || !r.audio_data || !(r.audio_data instanceof Buffer)) return null;
  return { data: r.audio_data, mimetype: r.audio_mimetype || 'audio/webm' };
}

async function deleteRespostaByPerguntaAndGestora(perguntaId, gestoraId) {
  await query('DELETE FROM ch_pergunta_respostas WHERE pergunta_id = ? AND gestora_id = ?', [perguntaId, gestoraId]);
}

/** Cria ou atualiza resposta de uma gestora a uma pergunta */
async function upsertResposta(perguntaId, gestoraId, texto) {
  const t = typeof texto === 'string' ? texto.trim() : '';
  if (!t) return;
  await query(
    `INSERT INTO ch_pergunta_respostas (pergunta_id, gestora_id, texto) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE texto = VALUES(texto), updated_at = NOW()`,
    [perguntaId, gestoraId, t]
  );
}

/** Cria ou atualiza resposta (texto/áudio) de uma gestora a uma pergunta.
 *  Se audioData (Buffer) for passado, o áudio fica em audio_data (URL deriva de pergunta_id). */
async function upsertRespostaComAudio(perguntaId, gestoraId, { texto, audioTranscricao, audioData, audioMimetype }) {
  const t = typeof texto === 'string' ? texto.trim() : '';
  const aTxt = typeof audioTranscricao === 'string' ? audioTranscricao.trim() : null;
  const hasBlob = audioData instanceof Buffer && audioData.length > 0;
  if (!t && !aTxt && !hasBlob) return;
  const textToStore = t || aTxt || '';
  const mimetype = audioMimetype && String(audioMimetype).trim() ? String(audioMimetype).trim() : null;
  if (hasBlob) {
    await query(
      `INSERT INTO ch_pergunta_respostas (pergunta_id, gestora_id, texto, audio_transcricao, audio_data, audio_mimetype)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         texto = VALUES(texto),
         audio_transcricao = VALUES(audio_transcricao),
         audio_data = VALUES(audio_data),
         audio_mimetype = VALUES(audio_mimetype),
         updated_at = NOW()`,
      [perguntaId, gestoraId, textToStore, aTxt, audioData, mimetype]
    );
  } else {
    await query(
      `INSERT INTO ch_pergunta_respostas (pergunta_id, gestora_id, texto, audio_transcricao)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         texto = VALUES(texto),
         audio_transcricao = VALUES(audio_transcricao),
         updated_at = NOW()`,
      [perguntaId, gestoraId, textToStore, aTxt]
    );
  }
}

/** Dúvidas pendentes: apenas eh_pendente=1 (ainda sem resposta no FAQ). */
async function listDuvidasPendentes(gestoraId) {
  const sql =
    `SELECT d.id, d.contacto_whatsapp, d.lead_id, d.texto, d.origem, d.eh_pendente, d.created_at, d.updated_at,
            l.nome AS lead_nome
     FROM ch_duvidas d
     LEFT JOIN ch_leads l ON l.id = d.lead_id
     WHERE d.eh_pendente = 1
     ORDER BY d.created_at DESC`;
  return query(sql);
}

/** Listar id e texto das dúvidas pendentes (evo pode usar para duplicados). */
async function listDuvidasPendentesTextos() {
  const rows = await query(
    "SELECT id, texto FROM ch_duvidas WHERE eh_pendente = 1 AND texto IS NOT NULL AND TRIM(texto) != '' ORDER BY id ASC"
  );
  return rows.map((r) => ({ id: r.id, texto: (r.texto || '').trim() })).filter((r) => r.texto);
}

/** Contagem de dúvidas pendentes (mesmo filtro que listDuvidasPendentes: só eh_pendente=1). */
async function getDuvidasPendentesCount(gestoraId) {
  const sql = 'SELECT COUNT(*) AS n FROM ch_duvidas d WHERE d.eh_pendente = 1';
  const rows = await query(sql);
  return (rows[0] && rows[0].n != null) ? Number(rows[0].n) : 0;
}

async function createDuvidaPendente({ contactoWhatsapp, leadId, texto, origem = 'evo' }) {
  const contacto = String(contactoWhatsapp || '').replace(/\D/g, '') || null;
  const textoVal = typeof texto === 'string' ? texto.trim() : '';
  if (!contacto || !textoVal) return null;
  await query(
    'INSERT INTO ch_duvidas (texto, eh_pendente, contacto_whatsapp, lead_id, origem) VALUES (?, 1, ?, ?, ?)',
    [textoVal, contacto, leadId || null, origem || 'evo']
  );
  const rows = await query('SELECT * FROM ch_duvidas ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

async function getDuvidaPendenteById(id) {
  const rows = await query(
    'SELECT id, contacto_whatsapp, lead_id, texto, origem, eh_pendente, created_at, updated_at FROM ch_duvidas WHERE id = ?',
    [id]
  );
  return rows[0] || null;
}

/** Marcar dúvida como respondida (passa a FAQ, eh_pendente=0). */
async function markDuvidaRespondida(duvidaId) {
  await query('UPDATE ch_duvidas SET eh_pendente = 0, updated_at = NOW() WHERE id = ?', [duvidaId]);
}

async function updateDuvidaPendenteTexto(id, texto) {
  const t = typeof texto === 'string' ? texto.trim() : '';
  if (!t) return;
  await query('UPDATE ch_duvidas SET texto = ?, updated_at = NOW() WHERE id = ?', [t, id]);
}

async function deleteDuvidaPendente(id) {
  await query('DELETE FROM ch_duvidas WHERE id = ?', [id]);
}

async function setDuvidaEhPendente(id, ehPendente) {
  await query('UPDATE ch_duvidas SET eh_pendente = ?, updated_at = NOW() WHERE id = ?', [ehPendente ? 1 : 0, id]);
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
  getGestoraByEmail,
  getLeadsByGestoraId,
  setGestoraPassword,
  setGestoraPasswordResetToken,
  getGestoraByResetToken,
  clearGestoraPasswordReset,
  getActiveGestoras,
  getNextGestoraForLead,
  updateLeadGestora,
  getGestoraFromLegacyMap,
  updateLeadEstadoDocs,
  getLeadsForRafa,
  getLeadsForRafaCount,
  getAllLeads,
  updateLeadAdmin,
  deleteLead,
  getAllGestoras,
  getGestorasWithLeadCounts,
  createGestora,
  updateGestora,
  deleteGestora,
  saveGestoraRgpd,
  readGestoraRgpd,
  hasGestoraRgpd,
  listPerguntas,
  getPerguntaById,
  createPergunta,
  updatePergunta,
  deletePergunta,
  incrementPerguntaFrequencia,
  listRespostasByPerguntaId,
  getRespostaByPerguntaAndGestora,
  deleteRespostaByPerguntaAndGestora,
  upsertResposta,
  listDuvidasPendentes,
  getDuvidasPendentesCount,
  listDuvidasPendentesTextos,
  createDuvidaPendente,
  getDuvidaPendenteById,
  markDuvidaRespondida,
  updateDuvidaPendenteTexto,
  deleteDuvidaPendente,
  upsertRespostaComAudio,
  getRespostaAudioData,
  setDuvidaEhPendente,
};
