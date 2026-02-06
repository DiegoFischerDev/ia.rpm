// .env: na Hostinger fica na pasta pai de public_html; em local pode estar na pasta do projeto
const path = require('path');
const envPaths = [
  path.join(__dirname, '..', '.env'),   // pasta pai (Hostinger: pasta pai de public_html)
  path.join(__dirname, '.env'),         // pasta atual (desenvolvimento local)
];
for (const p of envPaths) {
  require('dotenv').config({ path: p });
}

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { Resend } = require('resend');
const { getLeadById, updateLeadDocsEnviados, updateLeadDados, setEmailVerification, confirmEmailAndSetLead } = require('./db');
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  irs_declaracao: 'Declaração de IRS',
  irs_nota_liquidacao: 'Nota de liquidação IRS',
  comprovativo_morada: 'Comprovativo de morada',
  mapa_responsabilidades: 'Mapa de responsabilidades de crédito',
  rgpd_assinado: 'Documento RGPD assinado',
  declaracao_nao_divida: 'Declaração de não dívida (Finanças e Segurança Social)',
  declaracao_predial: 'Declaração Predial negativa',
};

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

// Upload: só mostrar se o lead existir e estiver em aguardando_docs
app.get('/upload/:leadId', async (req, res) => {
  const leadId = req.params.leadId;
  if (!/^\d+$/.test(leadId)) {
    return res.status(400).sendFile(path.join(__dirname, 'public', 'upload.html'));
  }
  try {
    const lead = await getLeadById(leadId);
    if (!lead) {
      res.status(404).send('<p>Link não encontrado.</p>');
      return;
    }
    if (lead.estado !== 'aguardando_docs') {
      res.status(403).send('<p>Este link já não está disponível para envio de documentos.</p>');
      return;
    }
    res.sendFile(path.join(__dirname, 'public', 'upload.html'));
  } catch (err) {
    logStartup(`GET /upload/${leadId} error: ${err.message}`);
    res.status(500).send('<p>Erro ao verificar dados.</p>');
  }
});

// Confirmação
app.get('/confirmacao/:leadId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'confirmacao.html'));
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
  if (lead.estado !== 'aguardando_docs') {
    return { error: 403, message: 'Este link já não aceita envio de documentos.' };
  }
  return { lead };
}

function normalizeEmail(e) {
  return (e && typeof e === 'string' ? e.trim().toLowerCase() : '') || '';
}

async function requireEmailAccess(leadId, emailProvided) {
  const v = await validateLeadAguardandoDocs(leadId);
  if (v.error) return v;
  const lead = v.lead;
  const hasEmail = !!(lead.email && lead.email.trim());
  if (!hasEmail) return { error: 403, message: 'Confirme primeiro o seu email.' };
  const provided = normalizeEmail(emailProvided);
  const stored = normalizeEmail(lead.email);
  if (provided !== stored) return { error: 403, message: 'Email incorreto.' };
  return { lead };
}

// Estado do lead: tem email confirmado? (para o front saber que ecrã mostrar)
app.get('/api/leads/:leadId/status', async (req, res) => {
  const v = await validateLeadAguardandoDocs(req.params.leadId);
  if (v.error) return res.status(v.error).json({ message: v.message });
  const lead = v.lead;
  res.json({
    hasEmail: !!(lead.email && lead.email.trim()),
    nome: lead.nome || '',
  });
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

// Confirmar código e atribuir nome + email ao lead
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
  res.json({ ok: true });
});

// Acesso quando o lead já tem email: verificar que o email introduzido é o do lead
app.post('/api/leads/:leadId/access', async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ message: 'Indique o seu email.' });
  const v = await requireEmailAccess(req.params.leadId, email);
  if (v.error) return res.status(v.error).json({ message: v.message });
  res.json({ ok: true });
});

// Listar documentos — requer email confirmado (e, se já tiver, que coincida com o enviado)
app.get('/api/leads/:leadId/documents', async (req, res) => {
  const leadId = req.params.leadId;
  const emailQuery = req.query && req.query.email;
  const v = await validateLeadAguardandoDocs(leadId);
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
    estado_civil: lead.estado_civil || '',
    num_dependentes: lead.num_dependentes != null ? String(lead.num_dependentes) : '',
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
    await updateLeadDados(leadId, {
      nome: body.nome,
      estado_civil: body.estado_civil,
      num_dependentes: body.num_dependentes,
    });
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
  if (!fieldName || !DOC_FIELDS.includes(fieldName)) {
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
    await updateLeadDados(leadId, {
      nome: body.nome,
      estado_civil: body.estado_civil,
      num_dependentes: body.num_dependentes,
    });
  } catch (_) {}

  const requiredBase = DOC_FIELDS.filter(
    (f) => f !== 'declaracao_nao_divida' && f !== 'declaracao_predial'
  );
  const financiamento100 = body.financiamento_100 === '1' || body.financiamento_100 === 'true';
  const required =
    financiamento100
      ? [...requiredBase, 'declaracao_nao_divida', 'declaracao_predial']
      : requiredBase;

  const byField = {};
  for (const f of files) {
    if (f.fieldname && DOC_FIELDS.includes(f.fieldname) && f.buffer && f.buffer.length) {
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

  const gestoraEmail = process.env.GESTORA_EMAIL;
  if (!gestoraEmail) {
    logStartup('GESTORA_EMAIL não configurado');
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
  const mensagem = (body.mensagem_gestora || '').trim();

  const textBody = [
    `Documentos enviados pelo lead: ${lead.nome || 'N/A'} (ID: ${leadId})`,
    `Email do lead: ${emailLead}`,
    `Estado civil e regime de casamento (se aplicável): ${estadoCivil || '—'}`,
    `N.º de dependentes: ${numDependentes || '—'}`,
    financiamento100 ? 'Pedido no âmbito do financiamento a 100%.' : '',
    mensagem ? `Mensagem: ${mensagem}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const textWithNote = textBody + '\n\n---\nResponda diretamente ao email do lead (em CC) para manter a troca apenas entre si e o cliente.';

  try {
    const { error } = await resend.emails.send({
      from: mailFrom.includes('<') ? mailFrom : `Crédito Habitação <${mailFrom}>`,
      to: [gestoraEmail],
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
