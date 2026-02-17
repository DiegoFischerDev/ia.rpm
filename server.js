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
const sharp = require('sharp');
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
  getFirstGestoraIdWithAudio,
  deleteRespostaByPerguntaAndGestora,
  setDuvidaEhPendente,
} = require('./db');
const {
  saveDocument,
  listDocuments,
  getAttachmentsForLead,
  deleteLeadStorage,
  cleanupOldStorage,
  STANDARD_NAMES,
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

// Ficheiros de áudio de respostas das gestoras (FAQ) – rota customizada para servir ficheiro ou 404 JSON
// (após deploy os ficheiros podem não existir; 404 em JSON permite ao dashboard mostrar mensagem e "Substituir áudio")
const faqAudioDir = path.join(__dirname, 'storage', 'faq-audio');
if (!fs.existsSync(faqAudioDir)) {
  try {
    fs.mkdirSync(faqAudioDir, { recursive: true });
  } catch (e) {
    logStartup(`Não foi possível criar pasta faq-audio: ${e.message}`);
  }
}
app.get('/faq-audio/:filename', function (req, res) {
  const filename = req.params.filename;
  if (!filename || filename.includes('..') || path.isAbsolute(filename)) {
    return res.status(400).json({ error: 'invalid_filename' });
  }
  const filePath = path.join(faqAudioDir, filename);
  fs.promises.access(filePath, fs.constants.R_OK)
    .then(function () {
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === '.ogg' ? 'audio/ogg' : 'audio/webm';
      res.setHeader('Content-Type', mime);
      res.sendFile(filePath);
    })
    .catch(function () {
      res.status(404).json({ error: 'file_not_found', message: 'Áudio não disponível (perdido após atualização). Podes gravar um novo.' });
    });
});

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

const SESSION_MAX_AGE_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS || 60); // por defeito ~2 meses

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'ia-app-dashboard-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
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
  const estadosComAcessoUpload = ['aguardando_docs', 'docs_enviados', 'sem_docs', 'inviavel', 'credito_aprovado', 'agendado_escritura', 'escritura_realizada'];
  const docsOk = estadosComAcessoUpload.includes(lead.estado_docs);
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

// Lead em fase de preparação de documentos: aceitamos tanto 'aguardando_docs' como 'sem_docs'
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
  if (lead.estado_docs !== 'aguardando_docs' && lead.estado_docs !== 'sem_docs') {
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
        gestoraFotoPerfil: g.foto_perfil || '',
        gestoraBoasVindas: g.boas_vindas || '',
        gestoraFotoVersion: g.updated_at || null,
      };
    }
  }
  return {
    gestoraNome: '',
    gestoraEmail: process.env.GESTORA_EMAIL || '',
    gestoraWhatsapp: (process.env.GESTORA_WHATSAPP || '').replace(/\D/g, ''),
    gestoraFotoPerfil: '',
    gestoraBoasVindas: '',
    gestoraFotoVersion: null,
  };
}

// Lista para Rafa: apenas nome, email e whatsapp (sem dados sensíveis como estado civil, vínculo, etc.)
app.get('/api/leads', async (req, res) => {
  const estadoConversa = (req.query && req.query.estado) || (req.query && req.query.estado_conversa) || '';
  if (estadoConversa !== 'falar_com_rafa') {
    return res.status(400).json({ message: 'Parâmetro estado inválido (use estado=falar_com_rafa).' });
  }
  try {
    const leads = await getLeadsForRafa();
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

// Foto de perfil da gestora do lead (para a página de upload) — devolve imagem leve via endpoint dedicado
app.get('/api/leads/:leadId/foto-gestora', async (req, res) => {
  const leadId = req.params.leadId;
  if (!/^\d+$/.test(leadId)) return res.status(400).send();
  const lead = await getLeadById(leadId).catch(() => null);
  if (!lead || !lead.gestora_id) return res.status(404).send();
  const g = await getGestoraById(lead.gestora_id).catch(() => null);
  if (!g || !g.foto_perfil) return res.status(404).send();
  const raw = String(g.foto_perfil).trim();
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    if (raw.startsWith('data:')) {
      // dataURL: data:image/...;base64,XXXX
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(raw);
      if (!m) return res.status(400).send();
      const mime = m[1] || 'image/jpeg';
      const buf = Buffer.from(m[2], 'base64');
      res.type(mime).send(buf);
      return;
    }
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      // URL externa
      res.redirect(raw);
      return;
    }
    // Caso seja apenas base64 sem prefixo
    const buf = Buffer.from(raw, 'base64');
    res.type('image/jpeg').send(buf);
  } catch (err) {
    logStartup(`foto-gestora error: ${err.message}`);
    res.status(500).send();
  }
});

// Estado do lead: tem email? docs já enviados? (para o front saber que ecrã mostrar)
// Quando docsEnviados, não devolvemos contactos da gestora; o lead tem de confirmar email via POST /access
app.get('/api/leads/:leadId/status', async (req, res) => {
  const v = await validateLeadUploadPage(req.params.leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const lead = v.lead;
  const estadosVerMensagemEnviados = ['docs_enviados', 'inviavel', 'credito_aprovado', 'agendado_escritura', 'escritura_realizada'];
  const docsEnviados = !!(lead.docs_enviados && Number(lead.docs_enviados) === 1) || estadosVerMensagemEnviados.includes(lead.estado_docs);
  const semDocs = lead.estado_docs === 'sem_docs';
  let hasRgpd = false;
  if (lead.gestora_id != null && lead.gestora_id !== '') {
    try {
      hasRgpd = await hasGestoraRgpd(lead.gestora_id);
    } catch (err) {
      logStartup(`status hasGestoraRgpd error: ${err.message}`);
    }
  }
  const payload = {
    hasEmail: !!(lead.email && lead.email.trim()),
    nome: '', // só devolvido após confirmação de email (POST /access)
    docsEnviados,
    semDocs,
    hasRgpd,
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
  const leadId = req.params.leadId;
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ message: 'ID inválido.' });
  const v = await validateLeadAguardandoDocs(leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const code = (req.body && req.body.code && String(req.body.code).trim()) || '';
  const lead = v.lead;
  if (lead.email_verification_code !== code) {
    return res.status(400).json({ message: 'Código inválido ou expirado.' });
  }
  const ok = await confirmEmailAndSetLead(leadId);
  if (!ok) return res.status(400).json({ message: 'Código inválido ou expirado.' });
  try {
    // Depois de confirmar o email, passamos o processo para "aguardando_docs"
    await updateLeadEstadoDocs(leadId, 'aguardando_docs');
    const leadAfter = await getLeadById(leadId);
    const hasGestora = leadAfter && (leadAfter.gestora_id != null && leadAfter.gestora_id !== '');
    if (!hasGestora) {
      const email = leadAfter && leadAfter.email ? String(leadAfter.email).trim().toLowerCase() : '';
      const legacy = email ? await getGestoraFromLegacyMap(leadAfter.email) : null;
      if (legacy && legacy.id) {
        await updateLeadGestora(Number(leadId), legacy.id);
        logStartup(`confirm-email: gestora ${legacy.id} (legacy) atribuída ao lead ${leadId}`);
      } else {
        const next = await getNextGestoraForLead();
        if (next && next.id) {
          await updateLeadGestora(Number(leadId), next.id);
          logStartup(`confirm-email: gestora ${next.id} atribuída ao lead ${leadId}`);
        } else {
          logStartup(`confirm-email: nenhuma gestora ativa para atribuir ao lead ${leadId}`);
        }
      }
    }
  } catch (err) {
    logStartup(`confirm-email atribuir gestora: ${err.message}`);
  }
  res.json({ ok: true });
});

// "Não recebi o código" — marca que o lead quer falar com a Rafa (equipa contacta)
app.post('/api/leads/:leadId/no-code', async (req, res) => {
  const leadId = req.params.leadId;
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ message: 'ID inválido.' });
  const v = await validateLeadAguardandoDocs(leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const lead = v.lead;
  if (lead.email && lead.email.trim()) {
    return res.status(400).json({ message: 'Este lead já tem email confirmado.' });
  }
  try {
    await updateLeadAdmin(Number(leadId), { quer_falar_com_rafa: 1, estado_conversa: 'aguardando_escolha' });
    res.json({ ok: true });
  } catch (err) {
    logStartup(`no-code updateLeadAdmin error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao registar. Tente novamente.' });
  }
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
  const estadosVerMensagemEnviados = ['docs_enviados', 'inviavel', 'credito_aprovado', 'agendado_escritura', 'escritura_realizada'];
  const docsEnviados = !!(lead.docs_enviados && Number(lead.docs_enviados) === 1) || estadosVerMensagemEnviados.includes(lead.estado_docs);
  const semDocs = lead.estado_docs === 'sem_docs';
  const contact = await getGestoraContactForLead(lead);
  // Em vez de devolver a imagem (potencialmente grande) diretamente, devolvemos apenas um URL leve.
  let gestoraFotoPerfilUrl = '';
  if (lead.gestora_id && contact.gestoraFotoPerfil) {
    const v =
      contact.gestoraFotoVersion
        ? `?v=${encodeURIComponent(new Date(contact.gestoraFotoVersion).getTime())}`
        : '';
    gestoraFotoPerfilUrl = `/api/leads/${lead.id}/foto-gestora${v}`;
  }
  res.json({
    ok: true,
    docsEnviados,
    semDocs,
    gestoraNome: contact.gestoraNome,
    gestoraEmail: contact.gestoraEmail,
    gestoraWhatsapp: contact.gestoraWhatsapp,
    gestoraFotoPerfil: gestoraFotoPerfilUrl,
    gestoraBoasVindas: contact.gestoraBoasVindas,
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
    const legacy = lead.email ? await getGestoraFromLegacyMap(lead.email) : null;
    if (legacy && legacy.id) {
      await updateLeadGestora(leadId, legacy.id);
      const g = await getGestoraById(legacy.id);
      if (g) toEmail = (g.email_para_leads && g.email_para_leads.trim()) ? g.email_para_leads.trim() : (g.email || '');
    } else {
      const next = await getNextGestoraForLead();
      if (next) {
        await updateLeadGestora(leadId, next.id);
        toEmail = (next.email_para_leads && next.email_para_leads.trim()) ? next.email_para_leads.trim() : (next.email || '');
      }
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
      subject: `[${lead.nome || lead.email || leadId}] Documentos`,
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
  if (gestora) {
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
  res.json({ user: req.session.dashboardUser, impersonated: !!req.session.impersonateOriginalUser });
});

// Perdi a senha (gestoras): envia link por email
app.post('/api/dashboard/forgot-password', async (req, res) => {
  const email = (req.body && req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Indique o seu email.' });
  const gestora = await getGestoraByEmail(email).catch(() => null);
  // Mesmo gestoras inativas devem poder redefinir/definir senha;
  // o estado "ativo" só controla receção de novos leads.
  if (gestora) {
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
    const rows = await getLeadsForRafa();
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
    body = {
      estado_docs: req.body && req.body.estado_docs != null ? String(req.body.estado_docs).trim() : undefined,
      comentario: req.body && typeof req.body.comentario === 'string'
        ? req.body.comentario.trim()
        : (req.body && req.body.comentario === null ? null : undefined),
    };
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

// Admin: impersonar / ver dashboard como gestora
app.post('/api/dashboard/impersonate', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const gestoraId = req.body && req.body.gestoraId;
  if (!gestoraId || !/^\d+$/.test(String(gestoraId))) {
    return res.status(400).json({ message: 'ID de gestora inválido.' });
  }
  try {
    const g = await getGestoraById(Number(gestoraId));
    if (!g) return res.status(404).json({ message: 'Gestora não encontrada.' });
    // Guarda utilizador original na sessão, se ainda não estiver guardado
    if (!req.session.impersonateOriginalUser) {
      req.session.impersonateOriginalUser = req.session.dashboardUser;
    }
    req.session.dashboardUser = { role: 'gestora', id: g.id, email: g.email, nome: g.nome || '' };
    res.json({ ok: true, user: req.session.dashboardUser });
  } catch (err) {
    logStartup(`impersonate error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao trocar de utilizador.' });
  }
});

// Sair do modo de impersonação (voltar ao admin original)
app.post('/api/dashboard/impersonate/stop', requireDashboardAuth, async (req, res) => {
  if (!req.session.impersonateOriginalUser) {
    return res.status(400).json({ message: 'Não está em modo de impersonação.' });
  }
  req.session.dashboardUser = req.session.impersonateOriginalUser;
  delete req.session.impersonateOriginalUser;
  res.json({ ok: true, user: req.session.dashboardUser });
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

// ---------- FAQ Dúvidas (perguntas + respostas + dúvidas pendentes) ----------
app.get('/api/dashboard/perguntas', requireDashboardAuth, async (req, res) => {
  try {
    const rows = await listPerguntas();
    const user = req.session.dashboardUser;
    const isGestora = user && user.role === 'gestora';
    if (!isGestora) return res.json(rows);
    const withFlags = await Promise.all(
      rows.map(async (p) => {
        const minha = await getRespostaByPerguntaAndGestora(p.id, user.id);
        return { ...p, ja_respondi: !!minha };
      })
    );
    // Para gestoras, mostrar apenas perguntas que elas próprias responderam
    const onlyMine = withFlags.filter((p) => p.ja_respondi);
    res.json(onlyMine);
  } catch (err) {
    logStartup(`listPerguntas error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao listar perguntas.' });
  }
});

app.get('/api/dashboard/perguntas/:id', requireDashboardAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  try {
    const pergunta = await getPerguntaById(id);
    if (!pergunta) return res.status(404).json({ message: 'Pergunta não encontrada.' });
    const user = req.session.dashboardUser;
    const minha = user && user.role === 'gestora' ? await getRespostaByPerguntaAndGestora(id, user.id) : null;
    const respostas = await listRespostasByPerguntaId(id);
    // URL do áudio para o dashboard (derivado de pergunta_id quando áudio está na BD)
    const minhaRespostaOut = minha
      ? { ...minha, audio_url: minha.audio_in_db ? '/api/dashboard/faq-audio/' + id : undefined }
      : null;
    res.json({ pergunta, respostas, minha_resposta: minhaRespostaOut });
  } catch (err) {
    logStartup(`getPergunta error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao carregar pergunta.' });
  }
});

// Áudio da resposta da gestora (guardado na BD) — usado pelo dashboard ao reproduzir
app.get('/api/dashboard/faq-audio/:perguntaId', requireDashboardAuth, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).end();
  const perguntaId = req.params.perguntaId;
  if (!/^\d+$/.test(perguntaId)) return res.status(400).end();
  try {
    const row = await getRespostaAudioData(Number(perguntaId), user.id);
    if (!row || !row.data) return res.status(404).end();
    res.setHeader('Content-Type', row.mimetype || 'audio/webm');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.send(row.data);
  } catch (err) {
    logStartup(`faq-audio dashboard error: ${err.message}`);
    res.status(500).end();
  }
});

// Áudio da resposta salva para uma pergunta — apenas admin (ouvir resposta do FAQ)
app.get('/api/dashboard/faq-audio-admin/:perguntaId', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const perguntaId = req.params.perguntaId;
  if (!/^\d+$/.test(perguntaId)) return res.status(400).end();
  try {
    const gestoraId = await getFirstGestoraIdWithAudio(Number(perguntaId));
    if (gestoraId == null) return res.status(404).end();
    const row = await getRespostaAudioData(Number(perguntaId), gestoraId);
    if (!row || !row.data) return res.status(404).end();
    res.setHeader('Content-Type', row.mimetype || 'audio/webm');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.send(row.data);
  } catch (err) {
    logStartup(`faq-audio-admin error: ${err.message}`);
    res.status(500).end();
  }
});

// Áudio para envio ao lead via Evo (Evolution API faz GET a esta URL); token em query
app.get('/api/internal/faq-audio/:perguntaId/:gestoraId', async (req, res) => {
  const token = (req.query && req.query.token) ? String(req.query.token).trim() : '';
  const expected = (process.env.EVO_INTERNAL_SECRET || process.env.IA_APP_EVO_SECRET || '').trim();
  if (!expected || token !== expected) return res.status(403).end();
  const perguntaId = req.params.perguntaId;
  const gestoraId = req.params.gestoraId;
  if (!/^\d+$/.test(perguntaId) || !/^\d+$/.test(gestoraId)) return res.status(400).end();
  try {
    const row = await getRespostaAudioData(Number(perguntaId), Number(gestoraId));
    if (!row || !row.data) return res.status(404).end();
    res.setHeader('Content-Type', row.mimetype || 'audio/webm');
    res.send(row.data);
  } catch (err) {
    logStartup(`faq-audio internal error: ${err.message}`);
    res.status(500).end();
  }
});

app.post('/api/dashboard/perguntas', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const texto = (req.body && req.body.texto) ? String(req.body.texto).trim() : '';
  if (!texto) return res.status(400).json({ message: 'Texto da pergunta é obrigatório.' });
  try {
    const row = await createPergunta(texto);
    res.status(201).json(row);
  } catch (err) {
    logStartup(`createPergunta error: ${err.message}`);
    res.status(500).json({ message: err.message || 'Erro ao criar.' });
  }
});

// Gestora: atualizar/substituir o áudio da sua resposta a uma pergunta (FAQ) — não altera eh_pendente
const perguntaAudioUpload = uploadMemory.single('audio');
app.post('/api/dashboard/perguntas/:id/minha-resposta-audio', requireDashboardAuth, perguntaAudioUpload, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).json({ message: 'Acesso reservado à gestora.' });
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  const audioFile = req.file && req.file.buffer && req.file.buffer.length ? req.file : null;
  if (!audioFile) return res.status(400).json({ message: 'Áudio é obrigatório.' });

  try {
    const pergunta = await getPerguntaById(id);
    if (!pergunta) return res.status(404).json({ message: 'Pergunta não encontrada.' });

    const mimetype = (audioFile.mimetype || '').toLowerCase().includes('ogg') ? 'audio/ogg' : 'audio/webm';
    await upsertRespostaComAudio(Number(id), user.id, {
      texto: '',
      audioTranscricao: null,
      audioData: audioFile.buffer,
      audioMimetype: mimetype,
    });

    res.json({ ok: true, audio_url: '/api/dashboard/faq-audio/' + id });
  } catch (err) {
    logStartup(`updateMinhaRespostaAudio error: ${err.message}`);
    res.status(500).json({ message: err.message || 'Erro ao atualizar áudio.' });
  }
});

// Gestora: remover a sua própria resposta em áudio a uma pergunta (volta a ser pendente)
app.delete('/api/dashboard/perguntas/:id/minha-resposta', requireDashboardAuth, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).json({ message: 'Acesso reservado à gestora.' });
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  try {
    const pergunta = await getPerguntaById(id);
    if (!pergunta) return res.status(404).json({ message: 'Pergunta não encontrada.' });
    const minha = await getRespostaByPerguntaAndGestora(id, user.id);
    if (!minha) return res.status(404).json({ message: 'Resposta não encontrada para esta gestora.' });

    await deleteRespostaByPerguntaAndGestora(Number(id), user.id);
    await setDuvidaEhPendente(Number(id), true);

    res.json({ ok: true });
  } catch (err) {
    logStartup(`deleteMinhaResposta error: ${err.message}`);
    res.status(500).json({ message: err.message || 'Erro ao remover resposta.' });
  }
});

app.patch('/api/dashboard/perguntas/:id', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  const body = req.body || {};
  const texto = body.texto != null ? String(body.texto).trim() : null;
  try {
    if (texto !== null) {
      await updatePergunta(id, texto);
      const evoUrl = (process.env.EVO_URL || '').replace(/\/$/, '');
      const evoSecret = process.env.EVO_INTERNAL_SECRET || process.env.IA_APP_EVO_SECRET;
      if (evoUrl && evoSecret) {
        try {
          const r = await fetch(evoUrl + '/api/internal/atualizar-embedding-duvida', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': evoSecret },
            body: JSON.stringify({ duvida_id: Number(id), texto }),
          });
          if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            logStartup(`atualizar-embedding-duvida (evo) ${r.status}: ${data.message || r.statusText}`);
          }
        } catch (err) {
          logStartup(`atualizar-embedding-duvida (evo) erro: ${err.message}`);
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    logStartup(`updatePergunta error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao atualizar.' });
  }
});

app.delete('/api/dashboard/perguntas/:id', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  try {
    await deletePergunta(id);
    res.json({ ok: true });
  } catch (err) {
    logStartup(`deletePergunta error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao excluir.' });
  }
});

app.post('/api/dashboard/perguntas/:id/respostas', requireDashboardAuth, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).json({ message: 'Acesso reservado à gestora.' });
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  const texto = (req.body && req.body.texto) != null ? String(req.body.texto).trim() : '';
  if (!texto) return res.status(400).json({ message: 'Texto da resposta é obrigatório.' });
  try {
    const pergunta = await getPerguntaById(id);
    if (!pergunta) return res.status(404).json({ message: 'Pergunta não encontrada.' });
    await upsertResposta(Number(id), user.id, texto);
    res.json({ ok: true });
  } catch (err) {
    logStartup(`upsertResposta error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao guardar resposta.' });
  }
});

app.get('/api/dashboard/duvidas-pendentes', requireDashboardAuth, async (req, res) => {
  try {
    const user = req.session.dashboardUser;
    const gestoraId = user && user.role === 'gestora' ? user.id : null;
    const rows = await listDuvidasPendentes(gestoraId);
    res.json(rows);
  } catch (err) {
    logStartup(`listDuvidasPendentes error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao listar dúvidas.' });
  }
});

app.get('/api/dashboard/duvidas-pendentes/count', requireDashboardAuth, async (req, res) => {
  try {
    const user = req.session.dashboardUser;
    const gestoraId = user && user.role === 'gestora' ? user.id : null;
    const count = await getDuvidasPendentesCount(gestoraId);
    res.json({ count });
  } catch (err) {
    logStartup(`getDuvidasPendentesCount error: ${err.message}`);
    res.status(500).json({ count: 0 });
  }
});

app.post('/api/dashboard/duvidas-pendentes', requireDashboardAuth, async (req, res) => {
  const user = req.session.dashboardUser;
  if (!user || (user.role !== 'admin' && user.role !== 'gestora')) {
    return res.status(403).json({ message: 'Acesso reservado ao administrador ou gestora.' });
  }
  const texto = (req.body && req.body.texto) ? String(req.body.texto).trim() : '';
  if (!texto) return res.status(400).json({ message: 'texto é obrigatório.' });
  try {
    const row = await createDuvidaPendente({
      contactoWhatsapp: '0',
      leadId: null,
      texto,
      origem: user.role === 'gestora' ? 'gestora' : 'admin',
    });
    if (!row) return res.status(500).json({ message: 'Erro ao criar dúvida.' });
    const evoUrl = (process.env.EVO_URL || '').replace(/\/$/, '');
    const evoSecret = process.env.EVO_INTERNAL_SECRET || process.env.IA_APP_EVO_SECRET;
    if (evoUrl && evoSecret && row.id && texto) {
      try {
        const r = await fetch(evoUrl + '/api/internal/atualizar-embedding-duvida', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': evoSecret },
          body: JSON.stringify({ duvida_id: Number(row.id), texto }),
        });
        if (!r.ok) logStartup(`atualizar-embedding-duvida (criar) ${r.status}`);
      } catch (err) {
        logStartup(`atualizar-embedding-duvida (criar) erro: ${err.message}`);
      }
    }
    res.status(201).json(row);
  } catch (err) {
    logStartup(`createDuvidaPendente (admin) error: ${err.message}`);
    res.status(500).json({ message: err.message || 'Erro ao criar.' });
  }
});

app.patch('/api/dashboard/duvidas-pendentes/:id', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  const texto = req.body && req.body.texto != null ? String(req.body.texto).trim() : '';
  if (!texto) return res.status(400).json({ message: 'texto é obrigatório.' });
  try {
    await updateDuvidaPendenteTexto(id, texto);
    const evoUrl = (process.env.EVO_URL || '').replace(/\/$/, '');
    const evoSecret = process.env.EVO_INTERNAL_SECRET || process.env.IA_APP_EVO_SECRET;
    if (evoUrl && evoSecret) {
      try {
        const r = await fetch(evoUrl + '/api/internal/atualizar-embedding-duvida', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': evoSecret },
          body: JSON.stringify({ duvida_id: Number(id), texto }),
        });
        if (!r.ok) logStartup(`atualizar-embedding-duvida (editar) ${r.status}`);
      } catch (err) {
        logStartup(`atualizar-embedding-duvida (editar) erro: ${err.message}`);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    logStartup(`updateDuvidaPendenteTexto error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao atualizar.' });
  }
});

app.delete('/api/dashboard/duvidas-pendentes/:id', requireDashboardAuth, requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  try {
    await deleteDuvidaPendente(id);
    res.json({ ok: true });
  } catch (err) {
    logStartup(`deleteDuvidaPendente error: ${err.message}`);
    res.status(500).json({ message: 'Erro ao excluir.' });
  }
});

const duvidaAudioUpload = uploadMemory.single('audio');

app.post('/api/dashboard/duvidas-pendentes/:id/responder', requireDashboardAuth, duvidaAudioUpload, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).json({ message: 'Acesso reservado à gestora.' });
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  const body = req.body || {};
  const texto = body.texto != null ? String(body.texto).trim() : '';
  const audioFile = req.file && req.file.buffer && req.file.buffer.length ? req.file : null;
  if (!texto && !audioFile) return res.status(400).json({ message: 'Texto ou áudio são obrigatórios.' });
  try {
    const duvida = await getDuvidaPendenteById(id);
    if (!duvida) return res.status(404).json({ message: 'Dúvida não encontrada.' });

    const audioTranscricao = null; // opcional para embeddings no futuro
    const textoFinal = texto || audioTranscricao || '';
    if (!textoFinal && !audioFile) {
      return res.status(400).json({ message: 'Não foi possível obter conteúdo da resposta.' });
    }

    await upsertRespostaComAudio(Number(id), user.id, {
      texto: textoFinal,
      audioTranscricao,
      ...(audioFile && {
        audioData: audioFile.buffer,
        audioMimetype: (audioFile.mimetype || '').toLowerCase().includes('ogg') ? 'audio/ogg' : 'audio/webm',
      }),
    });
    // Se for a primeira resposta, marca como não pendente (passa a FAQ),
    // mas continua a permitir novas respostas de outras gestoras.
    if (duvida.eh_pendente) {
      await markDuvidaRespondida(Number(id));
    }
    const evoUrl = (process.env.EVO_URL || '').replace(/\/$/, '');
    const evoSecret = process.env.EVO_INTERNAL_SECRET || process.env.IA_APP_EVO_SECRET;
    if (evoUrl && duvida.contacto_whatsapp) {
      const num = String(duvida.contacto_whatsapp).replace(/\D/g, '');
      // Buscar todas as respostas atuais para esta dúvida (já incluindo a resposta acabada de guardar)
      let respostasTexto = '';
      let respostasComAudio = [];
      try {
        const respostas = await listRespostasByPerguntaId(Number(id));
        if (respostas && respostas.length) {
          respostasComAudio = respostas.filter((r) => r && r.audio_in_db === 1);
          respostasTexto = respostas
            .map((r) => {
              const nomeGestora = (r.gestora_nome || '').trim() || 'Gestora';
              if (r.audio_in_db === 1) {
                return `- ${nomeGestora}: (resposta em áudio)`;
              }
              return `- ${nomeGestora}: ${r.texto}`;
            })
            .join('\n\n');
        } else {
          const nomeGestora = (user && user.nome) || 'Gestora';
          respostasTexto = `- ${nomeGestora}: ${textoFinal}`;
        }
      } catch (_) {
        const nomeGestora = (user && user.nome) || 'Gestora';
        respostasTexto = `- ${nomeGestora}: ${textoFinal}`;
      }
      const perguntaLabel = (duvida.texto || '').trim();
      const temAudio = respostasComAudio.length > 0;
      const nomeGestora = (user && user.nome && String(user.nome).trim()) || 'Gestora';
      const msgIntro =
        `✨\n✨ ${nomeGestora} respondeu sua dúvida\n\n❓ "${perguntaLabel}"`;
      const headers = { 'Content-Type': 'application/json' };
      if (evoSecret) headers['X-Internal-Secret'] = evoSecret;
      try {
        await fetch(evoUrl + '/api/internal/send-text', {
          method: 'POST',
          headers,
          body: JSON.stringify({ number: num, text: msgIntro }),
        });
        // Se tiver respostas em áudio, enviar também os áudios imediatamente
        if (temAudio) {
          const baseUrlRaw = (process.env.IA_APP_BASE_URL || process.env.IA_PUBLIC_BASE_URL || '').trim();
          const baseUrl = baseUrlRaw ? baseUrlRaw.replace(/\/$/, '') : '';
          if (!baseUrl) {
            logStartup('WARN: IA_APP_BASE_URL/IA_PUBLIC_BASE_URL não configurado – não é possível enviar áudio por WhatsApp.');
          }
          for (const r of respostasComAudio) {
            if (r.audio_in_db !== 1 || !baseUrl || !evoSecret) continue;
            const fullAudioUrl =
              baseUrl + '/api/internal/faq-audio/' + r.pergunta_id + '/' + r.gestora_id + '?token=' + encodeURIComponent(evoSecret);
            try {
              await fetch(evoUrl + '/api/internal/send-audio', {
                method: 'POST',
                headers,
                body: JSON.stringify({ number: num, audio_url: fullAudioUrl }),
              });
            } catch (err) {
              logStartup(`Enviar resposta em áudio ao lead (WhatsApp) falhou: ${err.response?.data || err.message}`);
            }
          }
        }
      } catch (err) {
        logStartup(`Enviar resposta ao lead (WhatsApp) falhou: ${err.message}`);
      }
    }
    res.json({ ok: true, pergunta_id: Number(id) });
  } catch (err) {
    logStartup(`responderDuvida error: ${err.message}`);
    res.status(500).json({ message: err.message || 'Erro ao responder.' });
  }
});

// APIs para o Evo (busca por vetores, incrementar frequência, criar dúvida pendente)
app.get('/api/faq/perguntas', (req, res) => {
  listPerguntas()
    .then((rows) => res.json(rows.map((p) => ({ id: p.id, texto: p.texto }))))
    .catch((err) => {
      logStartup(`faq/perguntas error: ${err.message}`);
      res.status(500).json({ message: 'Erro.' });
    });
});

app.get('/api/faq/perguntas/:id', (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  const baseUrl = (process.env.IA_APP_BASE_URL || process.env.IA_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const evoSecret = (process.env.EVO_INTERNAL_SECRET || process.env.IA_APP_EVO_SECRET || '').trim();
  getPerguntaById(id)
    .then(async (pergunta) => {
      if (!pergunta) return res.status(404).json({ message: 'Não encontrado.' });
      const respostas = await listRespostasByPerguntaId(id);
      const out = [];
      for (const r of respostas || []) {
        const row = { ...r };
        if (row.audio_in_db === 1 && baseUrl && evoSecret) {
          const mime = (row.audio_mimetype || '').toLowerCase();
          const ext = mime.includes('ogg') ? '.ogg' : '.webm';
          const filename = `${row.pergunta_id}-${row.gestora_id}${ext}`;
          const filePath = path.join(faqAudioDir, filename);
          try {
            // Se o ficheiro ainda não existir, criar a partir da BD
            await fs.promises.access(filePath, fs.constants.R_OK);
          } catch {
            try {
              const audioRow = await getRespostaAudioData(Number(row.pergunta_id), Number(row.gestora_id));
              if (audioRow && audioRow.data) {
                await fs.promises.writeFile(filePath, audioRow.data);
              }
            } catch (e) {
              logStartup(`faq-audio write file error (${filename}): ${e.message}`);
            }
          }
          row.audio_url =
            baseUrl +
            '/api/internal/faq-audio/' +
            row.pergunta_id +
            '/' +
            row.gestora_id +
            '?token=' +
            encodeURIComponent(evoSecret);
          row.audio_direct_url = baseUrl + '/faq-audio/' + filename;
        }
        out.push(row);
      }
      return res.json({ pergunta, respostas: out });
    })
    .catch((err) => {
      logStartup(`faq/perguntas/:id error: ${err.message}`);
      logStartup(`faq/perguntas/:id stack: ${err.stack || ''}`);
      res.status(500).json({ message: 'Erro.' });
    });
});

app.post('/api/faq/perguntas/:id/incrementar-frequencia', (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'ID inválido.' });
  incrementPerguntaFrequencia(Number(id))
    .then(() => res.json({ ok: true }))
    .catch((err) => {
      logStartup(`incrementPerguntaFrequencia error: ${err.message}`);
      res.status(500).json({ message: 'Erro.' });
    });
});

app.get('/api/faq/duvidas-pendentes-textos', (req, res) => {
  listDuvidasPendentesTextos()
    .then((rows) => res.json(rows))
    .catch((err) => {
      logStartup(`faq/duvidas-pendentes-textos error: ${err.message}`);
      res.status(500).json({ message: 'Erro.' });
    });
});

app.post('/api/faq/duvidas-pendentes', async (req, res) => {
  const body = req.body || {};
  let contactoWhatsapp = (body.contacto_whatsapp || body.contactoWhatsapp || body.whatsapp_number || '').trim().replace(/\D/g, '');
  const leadId = body.lead_id != null ? body.lead_id : null;
  const texto = (body.texto || '').trim();
  if (!texto) return res.status(400).json({ message: 'texto é obrigatório.' });
  if (!contactoWhatsapp && leadId) {
    const lead = await getLeadById(leadId).catch(() => null);
    if (lead && lead.whatsapp_number) contactoWhatsapp = String(lead.whatsapp_number).replace(/\D/g, '');
  }
  if (!contactoWhatsapp) return res.status(400).json({ message: 'contacto_whatsapp ou lead_id é obrigatório.' });
  try {
    const row = await createDuvidaPendente({
      contactoWhatsapp,
      leadId: leadId || undefined,
      texto,
      origem: body.origem || 'evo',
    });
    const evoUrl = (process.env.EVO_URL || '').replace(/\/$/, '');
    const evoSecret = process.env.EVO_INTERNAL_SECRET || process.env.IA_APP_EVO_SECRET;
    if (row && row.id && texto && evoUrl && evoSecret) {
      try {
        const r = await fetch(evoUrl + '/api/internal/atualizar-embedding-duvida', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': evoSecret },
          body: JSON.stringify({ duvida_id: Number(row.id), texto }),
        });
        if (!r.ok) logStartup(`atualizar-embedding-duvida (faq criar) ${r.status}`);
      } catch (err) {
        logStartup(`atualizar-embedding-duvida (faq criar) erro: ${err.message}`);
      }
    }
    res.status(201).json(row);
  } catch (err) {
    logStartup(`createDuvidaPendente error: ${err.message}`);
    res.status(500).json({ message: 'Erro.' });
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
    res.json({
      nome: g.nome,
      email: g.email,
      email_para_leads: g.email_para_leads || g.email || '',
      whatsapp: g.whatsapp || '',
      foto_perfil: g.foto_perfil || '',
      boas_vindas: g.boas_vindas || '',
      has_rgpd,
    });
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
  { name: 'foto_perfil', maxCount: 1 },
]);

app.post('/api/dashboard/profile', requireDashboardAuth, profileUpload, async (req, res) => {
  const user = req.session.dashboardUser;
  if (user.role !== 'gestora') return res.status(403).json({ message: 'Acesso reservado à gestora.' });
  const gestoraId = user.id;
  const body = req.body || {};
  const whatsapp = (body.whatsapp !== undefined && body.whatsapp !== null ? String(body.whatsapp) : '').trim();
  const emailParaLeads = (body.email_para_leads !== undefined && body.email_para_leads !== null ? String(body.email_para_leads) : '').trim().toLowerCase();
  const boasVindas = body.boas_vindas !== undefined && body.boas_vindas !== null ? String(body.boas_vindas).trim() : undefined;
  const currentPassword = (body.currentPassword != null ? String(body.currentPassword) : '').trim();
  const newPassword = (body.newPassword != null ? String(body.newPassword) : '').trim();
  const rgpdFile = req.files && req.files.rgpd && req.files.rgpd[0] ? req.files.rgpd[0] : null;
  const fotoFile = req.files && req.files.foto_perfil && req.files.foto_perfil[0] ? req.files.foto_perfil[0] : null;

  try {
    const updates = {};
    if (body.whatsapp !== undefined && body.whatsapp !== null) updates.whatsapp = whatsapp === '' ? '' : whatsapp.replace(/\D/g, '');
    if (emailParaLeads !== undefined) updates.email_para_leads = emailParaLeads === '' ? null : emailParaLeads;
    if (boasVindas !== undefined) updates.boas_vindas = boasVindas === '' ? null : boasVindas;
    if (fotoFile && fotoFile.buffer && fotoFile.buffer.length) {
      const mime = (fotoFile.mimetype || '').toLowerCase();
      if (!mime.startsWith('image/')) {
        return res.status(400).json({ message: 'A foto de perfil deve ser uma imagem.' });
      }
      try {
        // Otimizar imagem: redimensionar e comprimir antes de guardar
        const maxSize = 600;
        let pipeline = sharp(fotoFile.buffer, { failOnError: false }).rotate();
        const meta = await pipeline.metadata();
        if ((meta.width && meta.width > maxSize) || (meta.height && meta.height > maxSize)) {
          pipeline = pipeline.resize({
            width: maxSize,
            height: maxSize,
            fit: 'inside',
            withoutEnlargement: true,
          });
        }
        const optimized = await pipeline.jpeg({ quality: 82 }).toBuffer();
        const base64 = optimized.toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64}`;
        updates.foto_perfil = dataUrl;
      } catch (e) {
        logStartup(`updateProfile foto_perfil sharp error: ${e.message}`);
        return res.status(400).json({ message: 'Não foi possível processar esta imagem. Por favor, tente com um ficheiro JPG ou PNG diferente.' });
      }
    }
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
