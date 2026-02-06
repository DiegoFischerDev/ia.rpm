const path = require('path');
const fs = require('fs').promises;

const STORAGE_DIR = path.join(__dirname, 'storage');
const RETENTION_DAYS = 30;

// Nomes padronizados para a gestora (todos os leads com o mesmo padrão)
const STANDARD_NAMES = {
  cartao_residencia_ou_passaporte: '01-cartao-residencia-ou-passaporte',
  recibo_vencimento_1: '02-recibo-vencimento-1',
  recibo_vencimento_2: '03-recibo-vencimento-2',
  recibo_vencimento_3: '04-recibo-vencimento-3',
  contrato_ou_declaracao_efetividade: '05-contrato-ou-declaracao-efetividade',
  irs_declaracao: '06-irs-declaracao',
  irs_nota_liquidacao: '07-irs-nota-liquidacao',
  comprovativo_morada: '08-comprovativo-morada',
  mapa_responsabilidades: '09-mapa-responsabilidades',
  rgpd_assinado: '10-rgpd-assinado',
  declaracao_nao_divida: '11-declaracao-nao-divida',
  declaracao_predial: '12-declaracao-predial',
};

function getLeadDir(leadId) {
  return path.join(STORAGE_DIR, String(leadId));
}

function getExt(originalName) {
  if (!originalName || typeof originalName !== 'string') return '.pdf';
  const i = originalName.lastIndexOf('.');
  if (i === -1) return '.pdf';
  const ext = originalName.slice(i).toLowerCase();
  return ['.pdf', '.jpg', '.jpeg', '.png'].includes(ext) ? ext : '.pdf';
}

async function ensureLeadDir(leadId) {
  const dir = getLeadDir(leadId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function saveDocument(leadId, fieldName, buffer, originalName) {
  const base = STANDARD_NAMES[fieldName];
  if (!base) return null;
  const ext = getExt(originalName);
  const filename = base + ext;
  const dir = await ensureLeadDir(leadId);
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filename;
}

async function listDocuments(leadId) {
  const dir = getLeadDir(leadId);
  try {
    const files = await fs.readdir(dir);
    const result = {};
    for (const [fieldName, standardBase] of Object.entries(STANDARD_NAMES)) {
      const found = files.find((f) => f.startsWith(standardBase));
      result[fieldName] = found ? { uploaded: true, filename: found } : { uploaded: false };
    }
    return result;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return Object.fromEntries(
        Object.keys(STANDARD_NAMES).map((k) => [k, { uploaded: false }])
      );
    }
    throw err;
  }
}

async function readDocument(leadId, fieldName) {
  const list = await listDocuments(leadId);
  const item = list[fieldName];
  if (!item || !item.uploaded) return null;
  const filePath = path.join(getLeadDir(leadId), item.filename);
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function getAttachmentsForLead(leadId, fieldNames) {
  const attachments = [];
  for (const fieldName of fieldNames) {
    const buffer = await readDocument(leadId, fieldName);
    if (!buffer) continue;
    const list = await listDocuments(leadId);
    const filename = list[fieldName]?.filename || fieldName + '.pdf';
    attachments.push({ filename, content: buffer });
  }
  return attachments;
}

async function deleteLeadStorage(leadId) {
  const dir = getLeadDir(leadId);
  try {
    await fs.rm(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function cleanupOldStorage() {
  try {
    const entries = await fs.readdir(STORAGE_DIR, { withFileTypes: true });
    const now = Date.now();
    const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dirPath = path.join(STORAGE_DIR, ent.name);
      let newest = 0;
      try {
        const files = await fs.readdir(dirPath);
        for (const f of files) {
          const st = await fs.stat(path.join(dirPath, f));
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        }
      } catch (_) {}
      if (newest === 0 || now - newest > maxAge) {
        await fs.rm(dirPath, { recursive: true }).catch(() => {});
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

module.exports = {
  STORAGE_DIR,
  RETENTION_DAYS,
  STANDARD_NAMES,
  getLeadDir,
  saveDocument,
  listDocuments,
  readDocument,
  getAttachmentsForLead,
  deleteLeadStorage,
  cleanupOldStorage,
};
