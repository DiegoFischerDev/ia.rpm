// .env: na Hostinger fica na pasta pai de public_html; em local pode estar na pasta do projeto
const path = require('path');
const envPaths = [
  path.join(__dirname, '..', '.env'),   // pasta pai (Hostinger: pasta pai de public_html)
  path.join(__dirname, '.env'),         // pasta atual (desenvolvimento local)
];
for (const p of envPaths) {
  require('dotenv').config({ path: p });
}

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const {
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
  getNextGestoraForLead,
  updateLeadGestora,
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
} = require('./db');
const {
  saveDocument,
  listDocuments,
  getAttachmentsForLead,
  deleteLeadStorage,
  cleanupOldStorage,
  STANDARD_NAMES,
  saveGestoraRgpd,
  readGestoraRgpd,
  hasGestoraRgpd,
} = require('./storage');

function logStartup(msg) {
  const file = path.join(__dirname, 'startup.log');
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(file, line);
  } catch (_) {}
}

logStartup('server.js carregou');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store de sessões em MySQL para persistir entre vários processos Node (ex.: Hostinger)
const sessionStore = (process.env.DB_HOST && process.env.DB_USER)
  ? new MySQLStore({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      createDatabaseTable: true,
      schema: { tableName: 'dashboard_sessions' },
    })
  : undefined;

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'ia-app-dashboard-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  })
);

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB por ficheiro
});

const DOC_FIELDS = Object.keys(STANDARD_NAMES);

function getExt(originalName) {
  if (!originalName || typeof originalName !== 'string') return '.pdf';
  const i = originalName.lastIndexOf('.');
  if (i === -1) return '.pdf';
  const ext = originalName.slice(i).toLowerCase();
  return ['.pdf', '.jpg', '.jpeg', '.png'].includes(ext) ? ext : '.pdf';
}

const DOC_LABELS = {
  cartao_residencia_ou_passaporte: 'Cartão de residência ou passaporte',
  recibo_vencimento_1: 'Recibo de vencimento 1',
  recibo_vencimento_2: 'Recibo de vencimento 2',
  recibo_vencimento_3: 'Recibo de vencimento 3',
  contrato_ou_declaracao_efetividade: 'Contrato ou declaração de efetividade',
  contrato_temporario: 'Contrato',
  extrato_recibos_12_meses: 'Extrato dos últimos 12 meses de recibos verdes',
  declaracao_abertura_atividade: 'Declaração de abertura de atividade',
  irs_declaracao: 'Declaração de IRS',
  irs_nota_liquidacao: 'Nota de liquidação IRS',
  comprovativo_morada: 'Comprovativo de morada',
  mapa_responsabilidades: 'Mapa de responsabilidades de crédito',
  rgpd_assinado: 'Documento RGPD assinado',
  declaracao_nao_divida_financas: 'Declaração de não dívida (Finanças)',
  declaracao_nao_divida_seguranca_social: 'Declaração de não dívida (Segurança Social)',
  declaracao_predial: 'Declaração Predial negativa',
};

function getRequiredDocFieldsByVinculo(vinculo) {
  const common = ['cartao_residencia_ou_passaporte', 'irs_declaracao', 'irs_nota_liquidacao', 'comprovativo_morada', 'mapa_responsabilidades', 'rgpd_assinado'];
  const v = (vinculo || '').trim();
  if (v === 'Contrato temporário') {
    return ['recibo_vencimento_1', 'recibo_vencimento_2', 'recibo_vencimento_3', 'contrato_temporario', ...common];
  }
  if (v === 'Recibos verdes') {
    return ['extrato_recibos_12_meses', 'declaracao_abertura_atividade', ...common];
  }
  return ['recibo_vencimento_1', 'recibo_vencimento_2', 'recibo_vencimento_3', 'contrato_ou_declaracao_efetividade', ...common];
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;
  return new Resend(apiKey.trim());
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Página inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Lead pode aceder à página de upload se existir e estiver em aguardando_docs OU docs_enviados (para mostrar "já enviou")
async function validateLeadUploadPage(leadId) {
  if (!/^\d+$/.test(leadId)) return { error: 400, message: 'ID de lead inválido.' };
  let lead;
  try {
    lead = await getLeadById(leadId);
  } catch (err) {
    logStartup(`validateLeadUploadPage error: ${err.message}`);
    return { error: 500, message: 'Erro ao verificar dados.' };
  }
  if (!lead) return { error: 404, message: 'Link não encontrado.' };
  const docsOk = lead.estado_docs === 'aguardando_docs' || lead.estado_docs === 'docs_enviados' || lead.estado_docs === 'sem_docs';
  if (!docsOk) {
    return { error: 403, message: 'Este link já não está disponível.' };
  }
  return { lead };
}

// Upload: mostrar página se o lead existir e estiver em aguardando_docs ou docs_enviados
app.get('/upload/:leadId', async (req, res) => {
  const leadId = req.params.leadId;
  if (!/^\d+$/.test(leadId)) {
    return res.status(400).sendFile(path.join(__dirname, 'public', 'upload.html'));
  }
  try {
    const v = await validateLeadUploadPage(leadId);
    if (v.error) {
      if (v.error === 404) return res.status(404).send('<p>Link não encontrado.</p>');
      if (v.error === 403) return res.status(403).send('<p>Este link já não está disponível.</p>');
      return res.status(v.error).json({ message: v.message });
    }
    res.sendFile(path.join(__dirname, 'public', 'upload.html'));
  } catch (err) {
    logStartup(`GET /upload/${leadId} error: ${err.message}`);
    res.status(500).send('<p>Erro ao verificar dados.</p>');
  }
});

async function validateLeadAguardandoDocs(leadId) {
  if (!/^\d+$/.test(leadId)) return { error: 400, message: 'ID de lead inválido.' };
  let lead;
  try {
    lead = await getLeadById(leadId);
  } catch (err) {
    logStartup(`validateLead error: ${err.message}`);
    return { error: 500, message: 'Erro ao verificar dados.' };
  }
  if (!lead) return { error: 404, message: 'Link não encontrado.' };
  if (lead.estado_docs !== 'aguardando_docs') {
    return { error: 403, message: 'Este link já não aceita envio de documentos.' };
  }
  return { lead };
}

// Permite envio de documentos quando: estado_docs aguardando_docs OU sem_docs, e ainda não enviou (não reenvio).
async function validateLeadCanSendDocs(leadId) {
  if (!/^\d+$/.test(leadId)) return { error: 400, message: 'ID de lead inválido.' };
  let lead;
  try {
    lead = await getLeadById(leadId);
  } catch (err) {
    logStartup(`validateLeadCanSendDocs error: ${err.message}`);
    return { error: 500, message: 'Erro ao verificar dados.' };
  }
  if (!lead) return { error: 404, message: 'Link não encontrado.' };
  const jaEnviou = !!(lead.docs_enviados && Number(lead.docs_enviados) === 1);
  if (jaEnviou) {
    return { error: 403, message: 'Já enviaste os documentos. Não é possível reenviar.' };
  }
  if (lead.estado_docs !== 'aguardando_docs' && lead.estado_docs !== 'sem_docs') {
    return { error: 403, message: 'Este link já não aceita envio de documentos.' };
  }
  return { lead };
}

function normalizeEmail(e) {
  return (e && typeof e === 'string' ? e.trim().toLowerCase() : '') || '';
}

async function requireEmailAccess(leadId, emailProvided) {
  const v = await validateLeadCanSendDocs(leadId);
  if (v.error) return v;
  const lead = v.lead;
  const hasEmail = !!(lead.email && lead.email.trim());
  if (!hasEmail) return { error: 403, message: 'Confirme primeiro o seu email.' };
  const provided = normalizeEmail(emailProvided);
  const stored = normalizeEmail(lead.email);
  if (provided !== stored) return { error: 403, message: 'Email incorreto.' };
  return { lead };
}

async function getGestoraContactForLead(lead) {
  if (lead && lead.gestora_id) {
    const g = await getGestoraById(lead.gestora_id);
    if (g) {
      return {
        gestoraNome: g.nome || '',
        gestoraEmail: (g.email_para_leads && g.email_para_leads.trim()) ? g.email_para_leads.trim() : (g.email || ''),
        gestoraWhatsapp: (g.whatsapp || '').replace(/\D/g, ''),
      };
    }
  }
  return {
    gestoraNome: '',
    gestoraEmail: process.env.GESTORA_EMAIL || '',
    gestoraWhatsapp: (process.env.GESTORA_WHATSAPP || '').replace(/\D/g, ''),
  };
}

// Lista para Rafa: apenas nome, email e whatsapp (sem dados sensíveis como estado civil, vínculo, etc.)
app.get('/api/leads', async (req, res) => {
  const estadoConversa = (req.query && req.query.estado) || (req.query && req.query.estado_conversa) || '';
  const filter = estadoConversa === 'falar_com_rafa' ? 'com_rafa' : estadoConversa;
  if (filter !== 'com_rafa') {
    return res.status(400).json({ message: 'Parâmetro estado inválido (use estado=falar_com_rafa ou estado_conversa=com_rafa).' });
  }
  try {
    const leads = await getLeadsForRafa('com_rafa');
    res.json(leads);
  } catch (err) {
    logStartup(`getLeadsForRafa error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao listar leads.' });
  }
});

// PDF RGPD: da gestora do lead (cada gestora sube o seu)
app.get('/api/leads/:leadId/rgpd', async (req, res) => {
  const leadId = req.params.leadId;
  if (!/^\d+$/.test(leadId)) return res.status(400).send();
  const lead = await getLeadById(leadId).catch(() => null);
  if (!lead) return res.status(404).send();
  if (lead.gestora_id) {
    const buffer = await readGestoraRgpd(lead.gestora_id).catch(() => null);
    if (buffer && buffer.length) {
      res.type('application/pdf').setHeader('Content-Disposition', 'inline; filename="RGPD.pdf"').send(buffer);
      return;
    }
  }
  res.status(404).json({ message: 'Documento RGPD ainda não disponível para este lead.' });
});

// Estado do lead: tem email? docs já enviados? (para o front saber que ecrã mostrar)
// Quando docsEnviados, não devolvemos contactos da gestora; o lead tem de confirmar email via POST /access
app.get('/api/leads/:leadId/status', async (req, res) => {
  const v = await validateLeadUploadPage(req.params.leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const lead = v.lead;
  const docsEnviados = !!(lead.docs_enviados && Number(lead.docs_enviados) === 1) || lead.estado_docs === 'docs_enviados';
  const semDocs = lead.estado_docs === 'sem_docs';
  const payload = {
    hasEmail: !!(lead.email && lead.email.trim()),
    nome: '', // só devolvido após confirmação de email (POST /access)
    docsEnviados,
    semDocs,
  };
  if (!docsEnviados && !semDocs) {
    const contact = await getGestoraContactForLead(lead);
    payload.gestoraEmail = contact.gestoraEmail;
    payload.gestoraWhatsapp = contact.gestoraWhatsapp;
  } else {
    payload.gestoraEmail = '';
    payload.gestoraWhatsapp = '';
  }
  res.json(payload);
});

// Marcar lead como "não tenho todos os docs" (estado sem_docs) — requer email do lead
app.post('/api/leads/:leadId/sem-docs', async (req, res) => {
  const leadId = req.params.leadId;
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ message: 'Indique o seu email.' });
  const v = await validateLeadAguardandoDocs(leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const lead = v.lead;
  const stored = normalizeEmail(lead.email);
  if (stored !== email) return res.status(403).json({ message: 'Email incorreto.' });
  try {
    await updateLeadEstadoDocs(leadId, 'sem_docs');
    res.json({ ok: true });
  } catch (err) {
    logStartup(`updateLeadEstadoDocs sem_docs error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao atualizar.' });
  }
});

// Pedir código de confirmação (nome + email) — só quando o lead ainda não tem email
app.post('/api/leads/:leadId/request-verification', async (req, res) => {
  const leadId = req.params.leadId;
  const v = await validateLeadAguardandoDocs(leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const lead = v.lead;
  if (lead.email && lead.email.trim()) {
    return res.status(400).json({ message: 'Este lead já tem email confirmado.' });
  }
  const nome = (req.body && req.body.nome && req.body.nome.trim()) || '';
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ message: 'Indique o seu email.' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await setEmailVerification(leadId, nome, email, code);
  } catch (err) {
    logStartup(`setEmailVerification error: ${err.message}`);
    return res.status(500).json({ message: 'Erro ao gerar código.' });
  }
  const resend = getResendClient();
  const mailFrom = process.env.MAIL_FROM || process.env.RESEND_FROM;
  if (resend && mailFrom) {
    try {
      await resend.emails.send({
        from: mailFrom.includes('<') ? mailFrom : `Crédito Habitação <${mailFrom}>`,
        to: [email],
        subject: 'Código de confirmação – Envio de documentos',
        text: `O seu código de confirmação é: ${code}\n\nVálido por 15 minutos.`,
      });
    } catch (err) {
      logStartup(`send verification code error: ${err.message}`);
      return res.status(500).json({ message: 'Erro ao enviar email. Tente novamente.' });
    }
  }
  res.json({ ok: true });
});

// Confirmar código e atribuir nome + email ao lead; atribuir gestora para liberar RGPD
app.post('/api/leads/:leadId/confirm-email', async (req, res) => {
  const v = await validateLeadAguardandoDocs(req.params.leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const code = (req.body && req.body.code && String(req.body.code).trim()) || '';
  const lead = v.lead;
  if (lead.email_verification_code !== code) {
    return res.status(400).json({ message: 'Código inválido ou expirado.' });
  }
  const ok = await confirmEmailAndSetLead(req.params.leadId);
  if (!ok) return res.status(400).json({ message: 'Código inválido ou expirado.' });
  const leadId = req.params.leadId;
  const leadAfter = await getLeadById(leadId).catch(() => null);
  if (leadAfter && !leadAfter.gestora_id) {
    const next = await getNextGestoraForLead();
    if (next) await updateLeadGestora(leadId, next.id);
  }
  res.json({ ok: true });
});

// Acesso quando o lead já tem email: verificar que o email introduzido é o do lead
app.post('/api/leads/:leadId/access', async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ message: 'Indique o seu email.' });
  const v = await validateLeadUploadPage(req.params.leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const lead = v.lead;
  const hasEmail = !!(lead.email && lead.email.trim());
  if (!hasEmail) return res.status(403).json({ message: 'Confirme primeiro o seu email.' });
  const provided = normalizeEmail(email);
  const stored = normalizeEmail(lead.email);
  if (provided !== stored) return res.status(403).json({ message: 'Email incorreto.' });
  const docsEnviados = !!(lead.docs_enviados && Number(lead.docs_enviados) === 1);
  const semDocs = lead.estado_docs === 'sem_docs';
  const contact = await getGestoraContactForLead(lead);
  res.json({
    ok: true,
    docsEnviados,
    semDocs,
    gestoraNome: contact.gestoraNome,
    gestoraEmail: contact.gestoraEmail,
    gestoraWhatsapp: contact.gestoraWhatsapp,
    nome: lead.nome || '',
  });
});

// Listar documentos — requer email confirmado (e, se já tiver, que coincida com o enviado)
app.get('/api/leads/:leadId/documents', async (req, res) => {
  const leadId = req.params.leadId;
  const emailQuery = req.query && req.query.email;
  const v = await validateLeadCanSendDocs(leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const lead = v.lead;
  if (!(lead.email && lead.email.trim())) {
    return res.status(403).json({ message: 'Confirme primeiro o seu email.', step: 'enter_nome_email' });
  }
  const access = await requireEmailAccess(leadId, emailQuery);
  if (access.error) return res.status(access.error).json({ message: access.message });
  const list = {};
  DOC_FIELDS.forEach((f) => { list[f] = { uploaded: false }; });
  res.json({
    nome: lead.nome || '',
    ...list,
  });
});

// Atualizar dados do lead — requer email quando o lead já tem email
app.patch('/api/leads/:leadId', async (req, res) => {
  const leadId = req.params.leadId;
  const body = req.body || {};
  const access = await requireEmailAccess(leadId, body.email);
  if (access.error) return res.status(access.error).json({ message: access.message });
  try {
    await updateLeadDados(leadId, { nome: body.nome });
    res.json({ ok: true });
  } catch (err) {
    logStartup(`PATCH lead error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao atualizar dados.' });
  }
});

// Upload de um único documento — requer email quando o lead já tem email
app.post('/api/leads/:leadId/documents', uploadMemory.single('file'), async (req, res) => {
  const leadId = req.params.leadId;
  const fieldName = (req.body && req.body.fieldName) || (req.query && req.query.fieldName);
  const access = await requireEmailAccess(leadId, req.body && req.body.email);
  if (access.error) return res.status(access.error).json({ message: access.message });
  const allDocFields = Object.keys(STANDARD_NAMES);
  if (!fieldName || !allDocFields.includes(fieldName)) {
    return res.status(400).json({ message: 'Campo de documento inválido.' });
  }
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ message: 'Nenhum ficheiro enviado.' });
  }
  try {
    const filename = await saveDocument(leadId, fieldName, req.file.buffer, req.file.originalname);
    if (!filename) return res.status(400).json({ message: 'Campo desconhecido.' });
    res.json({ ok: true, field: fieldName, filename });
  } catch (err) {
    logStartup(`POST document error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao guardar documento.' });
  }
});

// Envio de email — multipart com todos os ficheiros (guardados só no browser até aqui)
app.post('/api/leads/:leadId/send-email', uploadMemory.any(), async (req, res) => {
  const leadId = req.params.leadId;
  const body = req.body || {};
  const files = req.files || [];
  const access = await requireEmailAccess(leadId, body.email);
  if (access.error) return res.status(access.error).json({ message: access.message });
  const lead = access.lead;

  const emailLead = (body.email || '').trim() || lead.email;
  if (!emailLead) {
    return res.status(400).json({ message: 'Indique o seu email.' });
  }

  try {
    await updateLeadDados(leadId, { nome: body.nome });
  } catch (_) {}

  const vinculo = (body.vinculo_laboral || '').trim();
  const requiredBase = getRequiredDocFieldsByVinculo(vinculo);
  const financiamento100 = body.financiamento_100 === '1' || body.financiamento_100 === 'true';
  const required = financiamento100
    ? [
        ...requiredBase,
        'declaracao_nao_divida_financas',
        'declaracao_nao_divida_seguranca_social',
        'declaracao_predial',
      ]
    : requiredBase;

  const allDocFields = Object.keys(STANDARD_NAMES);
  const byField = {};
  for (const f of files) {
    if (f.fieldname && allDocFields.includes(f.fieldname) && f.buffer && f.buffer.length) {
      byField[f.fieldname] = f;
    }
  }
  const missing = required.filter((f) => !byField[f]);
  if (missing.length) {
    const listLabels = missing.map((m) => DOC_LABELS[m] || m).join(', ');
    return res.status(400).json({
      message: 'Faltam os seguintes documentos: ' + listLabels + '.',
    });
  }

  const attachments = required.map((fieldName) => {
    const file = byField[fieldName];
    const base = STANDARD_NAMES[fieldName] || fieldName;
    const ext = getExt(file.originalname);
    return { filename: base + ext, content: file.buffer };
  });

  let toEmail = process.env.GESTORA_EMAIL || '';
  if (lead.gestora_id) {
    const g = await getGestoraById(lead.gestora_id);
    if (g) toEmail = (g.email_para_leads && g.email_para_leads.trim()) ? g.email_para_leads.trim() : (g.email || '');
  } else {
    const next = await getNextGestoraForLead();
    if (next) {
      await updateLeadGestora(leadId, next.id);
      toEmail = (next.email_para_leads && next.email_para_leads.trim()) ? next.email_para_leads.trim() : (next.email || '');
    }
  }
  if (!toEmail) {
    logStartup('Nenhuma gestora ativa nem GESTORA_EMAIL configurado');
    return res.status(503).json({
      message: 'Envio de email não está configurado. Tente mais tarde.',
    });
  }

  const resend = getResendClient();
  if (!resend) {
    logStartup('RESEND_API_KEY não configurado');
    return res.status(503).json({
      message: 'Envio de email não está configurado. Tente mais tarde.',
    });
  }

  const mailFrom = process.env.MAIL_FROM || process.env.RESEND_FROM;
  if (!mailFrom || !mailFrom.includes('@')) {
    logStartup('MAIL_FROM / RESEND_FROM não configurado (tem de ser um email de domínio verificado na Resend)');
    return res.status(503).json({
      message: 'Envio de email não está configurado. Tente mais tarde.',
    });
  }

  const estadoCivil = (body.estado_civil || '').trim();
  const numDependentes = (body.num_dependentes ?? '').toString().trim();
  const anosEmprego = (body.anos_emprego_atual ?? '').toString().trim();
  const vinculoLab = (body.vinculo_laboral || '').trim();
  const dispFiador = (body.disponibilidade_fiador || '').trim();
  const mensagem = (body.mensagem_gestora || '').trim();

  const textBody = [
    `Nome: ${lead.nome || 'N/A'}`,
    `Email: ${emailLead}`,
    `Estado civil: ${estadoCivil || '—'}`,
    `N.º de dependentes: ${numDependentes || '—'}`,
    `A quantos anos trabalha no emprego atual: ${anosEmprego || '—'}`,
    `Vínculo laboral: ${vinculoLab || '—'}`,
    dispFiador ? `Disponibilidade para apresentar fiador: ${dispFiador}` : '',
    financiamento100 ? 'Pedido no âmbito do financiamento a 100%.' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const nomeLead = (body.nome || lead.nome || 'O lead').trim() || 'O lead';
  const textWithNote = textBody + '\n\n---\n' + (mensagem ? mensagem : `(${nomeLead} não deixou mensagem)`);

  try {
    const { error } = await resend.emails.send({
      from: mailFrom.includes('<') ? mailFrom : `Crédito Habitação <${mailFrom}>`,
      to: [toEmail],
      cc: [emailLead],
      replyTo: emailLead,
      subject: `[Crédito Habitação] Documentos – ${lead.nome || leadId}`,
      text: textWithNote,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })),
    });
    if (error) {
      logStartup(`Resend error: ${JSON.stringify(error)}`);
      return res.status(500).json({
        message: error.message || 'Erro ao enviar email. Tente novamente.',
      });
    }
  } catch (err) {
    logStartup(`Resend send error: ${err.message}`);
    return res.status(500).json({
      message: err.message || 'Erro ao enviar email. Tente novamente.',
    });
  }

  try {
    await updateLeadDocsEnviados(leadId);
  } catch (err) {
    logStartup(`updateLeadDocsEnviados error: ${err.message}`);
  }

  try {
    await deleteLeadStorage(leadId);
  } catch (err) {
    logStartup(`deleteLeadStorage error: ${err.message}`);
  }

  res.status(200).json({ ok: true });
});

// ========== Dashboard (admin) ==========
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function requireDashboardAuth(req, res, next) {
  if (req.session && req.session.dashboardUser) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ message: 'Não autenticado.' });
  res.redirect('/');
}

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.dashboardUser && req.session.dashboardUser.role === 'admin') return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ message: 'Acesso reservado ao administrador.' });
  res.redirect('/');
}

// Redirecionar /dashboard para a página principal (dashboard está em /)
app.get('/dashboard', (req, res) => res.redirect(301, '/'));
app.get('/dashboard/*', (req, res) => res.redirect(301, '/'));

// Login admin ou gestora
app.post('/api/dashboard/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email) return res.status(400).json({ message: 'Indique o email.' });
  // 1) Tentar admin
  if (ADMIN_EMAIL && ADMIN_PASSWORD && email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.dashboardUser = { role: 'admin', email };
    return res.json({ ok: true, user: req.session.dashboardUser });
  }
  // 2) Tentar gestora
  const gestora = await getGestoraByEmail(email).catch(() => null);
  if (gestora && gestora.ativo) {
    if (!gestora.password) {
      return res.status(401).json({ message: 'Use «Perdi a senha» para definir a sua palavra-passe pela primeira vez.' });
    }
    const match = await bcrypt.compare(password, gestora.password);
    if (match) {
      req.session.dashboardUser = { role: 'gestora', id: gestora.id, email: gestora.email, nome: gestora.nome || '' };
      return res.json({ ok: true, user: req.session.dashboardUser });
    }
  }
  return res.status(401).json({ message: 'Email ou palavra-passe incorretos.' });
});

app.post('/api/dashboard/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.get('/api/dashboard/me', (req, res) => {
  if (!req.session || !req.session.dashboardUser) return res.status(401).json({ message: 'Não autenticado.' });
  res.json({ user: req.session.dashboardUser });
});

// Perdi a senha (gestoras): envia link por email
app.post('/api/dashboard/forgot-password', async (req, res) => {
  const email = (req.body && req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Indique o seu email.' });
  const gestora = await getGestoraByEmail(email).catch(() => null);
  if (gestora && gestora.ativo) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await setGestoraPasswordResetToken(gestora.id, token, expiresAt);
    const baseUrl = (process.env.APP_URL || process.env.UPLOAD_BASE_URL || '').replace(/\/$/, '') || req.protocol + '://' + (req.get('host') || '');
    const resetLink = baseUrl + '/#reset-password?token=' + encodeURIComponent(token);
    const resend = getResendClient();
    const mailFrom = process.env.MAIL_FROM || process.env.RESEND_FROM;
    if (resend && mailFrom) {
      try {
        await resend.emails.send({
          from: mailFrom.includes('<') ? mailFrom : `Crédito Habitação <${mailFrom}>`,
          to: [gestora.email],
          subject: 'Redefinir palavra-passe – Dashboard',
          text: `Olá ${gestora.nome || 'Gestora'},\n\nRecebemos um pedido para redefinir a sua palavra-passe. Clique no link abaixo (válido 1 hora):\n\n${resetLink}\n\nSe não pediu isto, ignore este email.`,
        });
      } catch (err) {
        logStartup(`forgot-password send email error: ${err.message}`);
      }
    }
  }
  res.json({ message: 'Se existir uma conta com este email, receberá um link para redefinir a palavra-passe.' });
});

// Redefinir palavra-passe com token (gestoras)
app.post('/api/dashboard/reset-password', async (req, res) => {
  const token = (req.body && req.body.token || '').trim();
  const password = req.body && req.body.password;
  if (!token) return res.status(400).json({ message: 'Token em falta.' });
  if (!password || String(password).length < 6) {
    return res.status(400).json({ message: 'A nova palavra-passe deve ter pelo menos 6 caracteres.' });
  }
  const gestora = await getGestoraByResetToken(token).catch(() => null);
  if (!gestora) return res.status(400).json({ message: 'Link inválido ou expirado. Peça um novo em «Perdi a senha».' });
  const hash = await bcrypt.hash(String(password), 10);
  await setGestoraPassword(gestora.id, hash);
  await clearGestoraPasswordReset(gestora.id);
  res.json({ message: 'Palavra-passe alterada. Pode fazer login.' });
});

// API protegida (admin ou gestora conforme role)
app.get('/api/dashboard/leads', requireDashboardAuth, async (req, res) => {
  try {
    const user = req.session.dashboardUser;
    const rows = user.role === 'gestora'
      ? await getLeadsByGestoraId(user.id)
      : await getAllLeads();
    res.json(rows);
  } catch (err) {
    logStartup(`getLeads error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao listar leads.', detail: err.message });
  }
});

app.get('/api/dashboard/leads/rafa', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  try {
    const rows = await getLeadsForRafa('com_rafa');
    res.json(rows);
  } catch (err) {
    logStartup(`getLeadsForRafa error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao listar leads.', detail: err.message });
  }
});

app.get('/api/dashboard/leads/rafa/count', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  try {
    const count = await getLeadsForRafaCount();
    res.json({ count });
  } catch (err) {
    logStartup(`getLeadsForRafaCount error: ${err.message}`);
    res.status(500).json({ count: 0 });
  }
});

app.patch('/api/dashboard/leads/:id', requireDashboardAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  const user = req.session.dashboardUser;
  let body = req.body;
  if (user.role === 'gestora') {
    const lead = await getLeadById(id).catch(() => null);
    if (!lead || lead.gestora_id !== user.id) {
      return res.status(403).json({ message: 'Só pode editar leads que lhe estão atribuídos.' });
    }
    body = { estado_docs: req.body && req.body.estado_docs != null ? String(req.body.estado_docs).trim() : undefined };
  }
  try {
    await updateLeadAdmin(id, body);
    res.json({ ok: true });
  } catch (err) {
    logStartup(`updateLeadAdmin error: ${err.message}`);
    res.status(500).json({ message: err.message || 'Erro ao atualizar.' });
  }
});

app.delete('/api/dashboard/leads/:id', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  try {
    await deleteLead(id);
    res.json({ ok: true });
  } catch (err) {
    logStartup(`deleteLead error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao apagar.' });
  }
});

app.get('/api/dashboard/gestoras', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  try {
    const rows = await getGestorasWithLeadCounts();
    res.json(rows);
  } catch (err) {
    logStartup(`getGestorasWithLeadCounts error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao listar gestoras.' });
  }
});

app.post('/api/dashboard/gestoras', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  try {
    const row = await createGestora(req.body);
    res.status(201).json(row);
  } catch (err) {
    logStartup(`createGestora error: ${err.message}`);
    res.status(400).json({ message: err.message || 'Erro ao criar.' });
  }
});

app.patch('/api/dashboard/gestoras/:id', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  try {
    await updateGestora(id, req.body);
    res.json({ ok: true });
  } catch (err) {
    logStartup(`updateGestora error: ${err.message}`);
    res.status(500).json({ message: err.message || 'Erro ao atualizar.' });
  }
});

app.delete('/api/dashboard/gestoras/:id', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  try {
    await deleteGestora(id);
    res.json({ ok: true });
  } catch (err) {
    logStartup(`deleteGestora error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao apagar.' });
  }
});

// Perfil da gestora (só role gestora): ver e atualizar dados próprios + RGPD
app.get('/api/dashboard/profile', requireDashboardAuth, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).json({ message: 'Acesso reservado à gestora.' });
  try {
    const g = await getGestoraById(user.id);
    if (!g) return res.status(404).json({ message: 'Gestora não encontrada.' });
    const has_rgpd = await hasGestoraRgpd(user.id);
    res.json({ nome: g.nome, email: g.email, email_para_leads: g.email_para_leads || g.email || '', whatsapp: g.whatsapp || '', has_rgpd });
  } catch (err) {
    logStartup(`getProfile error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao carregar perfil.' });
  }
});

// PDF RGPD da própria gestora (para ver no perfil)
app.get('/api/dashboard/profile/rgpd', requireDashboardAuth, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).send();
  try {
    const buffer = await readGestoraRgpd(user.id);
    if (!buffer || !buffer.length) return res.status(404).json({ message: 'Ainda não enviou nenhum documento RGPD.' });
    res.type('application/pdf').setHeader('Content-Disposition', 'inline; filename="RGPD.pdf"').send(buffer);
  } catch (err) {
    logStartup(`getProfileRgpd error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao obter o documento.' });
  }
});

const profileUpload = uploadMemory.fields([
  { name: 'whatsapp', maxCount: 1 },
  { name: 'email', maxCount: 1 },
  { name: 'currentPassword', maxCount: 1 },
  { name: 'newPassword', maxCount: 1 },
  { name: 'rgpd', maxCount: 1 },
]);

app.post('/api/dashboard/profile', requireDashboardAuth, profileUpload, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).json({ message: 'Acesso reservado à gestora.' });
  const gestoraId = user.id;
  const body = req.body || {};
  const whatsapp = (body.whatsapp !== undefined && body.whatsapp !== null ? String(body.whatsapp) : '').trim();
  const emailParaLeads = (body.email_para_leads !== undefined && body.email_para_leads !== null ? String(body.email_para_leads) : '').trim().toLowerCase();
  const currentPassword = (body.currentPassword != null ? String(body.currentPassword) : '').trim();
  const newPassword = (body.newPassword != null ? String(body.newPassword) : '').trim();
  const rgpdFile = req.files && req.files.rgpd && req.files.rgpd[0] ? req.files.rgpd[0] : null;

  try {
    const updates = {};
    if (whatsapp !== '') updates.whatsapp = whatsapp.replace(/\D/g, '');
    if (emailParaLeads !== undefined) updates.email_para_leads = emailParaLeads === '' ? null : emailParaLeads;
    if (Object.keys(updates).length) await updateGestora(gestoraId, updates);

    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ message: 'Indique a palavra-passe atual para alterar.' });
      const gestora = await getGestoraByEmail(user.email).catch(() => null) || await getGestoraById(gestoraId);
      if (!gestora || !gestora.password) return res.status(400).json({ message: 'Palavra-passe atual incorreta.' });
      const match = await bcrypt.compare(currentPassword, gestora.password);
      if (!match) return res.status(400).json({ message: 'Palavra-passe atual incorreta.' });
      if (newPassword.length < 6) return res.status(400).json({ message: 'A nova palavra-passe deve ter pelo menos 6 caracteres.' });
      const hash = await bcrypt.hash(newPassword, 10);
      await setGestoraPassword(gestoraId, hash);
    }

    if (rgpdFile && rgpdFile.buffer && rgpdFile.buffer.length) {
      const name = (rgpdFile.originalname || '').toLowerCase();
      if (!name.endsWith('.pdf')) return res.status(400).json({ message: 'O documento RGPD deve ser um PDF.' });
      await saveGestoraRgpd(gestoraId, rgpdFile.buffer);
    }

    res.json({ ok: true, message: 'Perfil atualizado.' });
  } catch (err) {
    logStartup(`updateProfile error: ${err.message}`);
    res.status(500).json({ message: err.message || 'Erro ao atualizar perfil.' });
  }
});

// Limpeza de ficheiros com mais de 30 dias (ao arrancar e de 24 em 24 h)
cleanupOldStorage().catch((err) => logStartup(`cleanupOldStorage: ${err.message}`));
setInterval(() => cleanupOldStorage().catch((err) => logStartup(`cleanupOldStorage: ${err.message}`)), 24 * 60 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  logStartup(`Servidor ouvindo na porta ${PORT}`);
  console.log(`Servidor ouvindo na porta ${PORT}`);
}).on('error', (err) => {
  logStartup(`ERRO listen: ${err.message}`);
  process.exit(1);
});
