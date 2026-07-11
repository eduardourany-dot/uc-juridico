/**
 * Drive.gs — C7: Organizador de documentos do Drive (jul/2026)
 *
 * Actions expostas (registradas no switch do Codigo.gs):
 *   driveListarPasta        POST {pasta}                    → lista arquivos da pasta (link ou ID)
 *   driveClassificarArquivo POST {fileId}                   → IA classifica 1 arquivo (Gemini multimodal)
 *   driveAplicarOrganizacao POST {pastaId, operacoes:[...]} → renomeia/move após revisão humana no app
 *
 * Fluxo completo (4 etapas, revisão humana obrigatória — parecer jul/2026):
 * o app lista a pasta, classifica arquivo a arquivo, mostra a REVISÃO
 * (nome proposto/categoria editáveis) e só então chama aplicar.
 *
 * Privacidade: o arquivo vai à API do Gemini (mesma chave/projeto das
 * petições) apenas para classificação; nada é usado para treinamento
 * (política da API paga). Arquivos > ORG_MAX_BYTES são pulados.
 *
 * Requisitos: GEMINI_API_KEY em Script Properties (já usada pelas petições).
 * A conta que roda o Web App precisa de acesso à pasta organizada.
 */

// Mantenha em sincronia com SEG_TAXONOMIA do index.html (C8).
const ORG_TAXONOMIA = ['peticao_inicial', 'contestacao', 'procuracao', 'decisao_judicial', 'recurso', 'documento_pessoal', 'comprovante', 'contrato', 'laudo_pericia', 'correspondencia', 'outros'];
const ORG_MAX_BYTES = 15 * 1024 * 1024;   // limite pro inline da API Gemini (folga sob os 20MB)
const ORG_MAX_ARQUIVOS = 300;             // teto de listagem por pasta
const ORG_MODELO_DEFAULT = 'gemini-3-flash-preview';

// MIME types que vão como ANEXO multimodal pro Gemini
const ORG_MIMES_BINARIO = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true
};

const ORG_PROMPT_SISTEMA =
'Você é um assistente especializado em organização de documentos jurídicos brasileiros. ' +
'Analise o documento fornecido e classifique-o.\n' +
'Regras obrigatórias:\n' +
'- Responda SEMPRE e SOMENTE com um objeto JSON válido, sem texto ao redor e sem blocos de código.\n' +
'- Baseie-se apenas no conteúdo. Nunca invente número de processo, nomes ou datas.\n' +
'- "cnj": o número CNJ do processo se aparecer no documento (formato NNNNNNN-DD.AAAA.J.TR.OOOO); senão string vazia.\n' +
'- "data": a data DO DOCUMENTO (protocolo/assinatura/emissão) em AAAA-MM-DD se identificável; senão vazia.\n' +
'- "titulo": curto e descritivo (ex.: "Contestação da Construtora Alfa", "Procuração João da Silva").\n' +
'- "confianca" honesta (0.0 a 1.0); categoria incerta = "outros".\n' +
'- Não emita opinião jurídica.\n' +
'Categorias válidas: ' + ORG_TAXONOMIA.join(', ') + '.\n' +
'FORMATO EXATO: {"categoria":"<da lista>","titulo":"<curto>","cnj":"<ou vazio>","data":"<AAAA-MM-DD ou vazio>","confianca":<0..1>,"observacao":""}';

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function _driveExtrairFolderId_(s) {
  s = String(s || '').trim();
  const m = s.match(/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

function _driveMimeSuportado_(mime) {
  return !!ORG_MIMES_BINARIO[mime] || mime === 'text/plain' || mime === 'application/vnd.google-apps.document';
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

function actionDriveListarPasta_(ctx) {
  const folderId = _driveExtrairFolderId_(ctx.body.pasta);
  if (!folderId) return { error: 'pasta_invalida', message: 'Cole o link (ou o ID) de uma pasta do Google Drive.' };

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { error: 'sem_acesso', message: 'Pasta não encontrada ou sem acesso pela conta do sistema — compartilhe a pasta com a conta que roda o Web App.' };
  }

  const arquivos = [];
  const it = folder.getFiles();
  let n = 0;
  while (it.hasNext() && n < ORG_MAX_ARQUIVOS) {
    const f = it.next(); n++;
    const mime = f.getMimeType();
    const tamanho = f.getSize();
    arquivos.push({
      id: f.getId(),
      nome: f.getName(),
      mimeType: mime,
      tamanho: tamanho,
      suportado: _driveMimeSuportado_(mime) && (tamanho <= ORG_MAX_BYTES || mime === 'application/vnd.google-apps.document')
    });
  }
  audit_(ctx.email, 'driveListarPasta', 'drive', folderId, { arquivos: arquivos.length });
  return { pastaId: folderId, pastaNome: folder.getName(), arquivos: arquivos, truncado: it.hasNext() };
}

function actionDriveClassificarArquivo_(ctx) {
  const fileId = String(ctx.body.fileId || '').trim();
  if (!fileId) return { error: 'fileId_obrigatorio' };

  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return { error: 'api_key_ausente', message: 'GEMINI_API_KEY não configurada em Script Properties.' };

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return { error: 'sem_acesso', fileId: fileId };
  }
  const mime = file.getMimeType();
  const nome = file.getName();

  // Monta as parts: binário (PDF/imagem) vai inline; texto/Google Doc vai como texto.
  const parts = [];
  if (ORG_MIMES_BINARIO[mime]) {
    if (file.getSize() > ORG_MAX_BYTES) return { error: 'muito_grande', fileId: fileId, nome: nome };
    parts.push({ inlineData: { mimeType: mime, data: Utilities.base64Encode(file.getBlob().getBytes()) } });
    parts.push({ text: 'Classifique o documento anexo. Nome atual do arquivo: "' + nome + '".' });
  } else if (mime === 'application/vnd.google-apps.document') {
    const texto = DocumentApp.openById(fileId).getBody().getText();
    parts.push({ text: 'Classifique o documento abaixo. Nome atual do arquivo: "' + nome + '".\n\n"""\n' + texto.slice(0, 60000) + '\n"""' });
  } else if (mime === 'text/plain') {
    const texto = file.getBlob().getDataAsString('UTF-8');
    parts.push({ text: 'Classifique o documento abaixo. Nome atual do arquivo: "' + nome + '".\n\n"""\n' + texto.slice(0, 60000) + '\n"""' });
  } else {
    return { error: 'mime_nao_suportado', fileId: fileId, nome: nome, mimeType: mime };
  }

  const payload = {
    systemInstruction: { parts: [{ text: ORG_PROMPT_SISTEMA }] },
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: 'application/json' }
  };
  // GEMINI_API_BASE vem do Peticoes.gs (escopo global compartilhado entre .gs)
  const url = GEMINI_API_BASE + '/' + ORG_MODELO_DEFAULT + ':generateContent?key=' + encodeURIComponent(apiKey);
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    return { error: 'gemini_' + resp.getResponseCode(), fileId: fileId, nome: nome, detalhe: resp.getContentText().slice(0, 400) };
  }

  let obj = null;
  try {
    const data = JSON.parse(resp.getContentText());
    const texto = (((data.candidates || [])[0] || {}).content || {}).parts?.[0]?.text || '';
    const ini = texto.indexOf('{'); const fim = texto.lastIndexOf('}');
    if (ini >= 0 && fim > ini) obj = JSON.parse(texto.slice(ini, fim + 1));
  } catch (e) { /* obj fica null */ }
  if (!obj || !obj.categoria) return { error: 'resposta_invalida', fileId: fileId, nome: nome };

  // Sanitização server-side (o client revalida)
  if (ORG_TAXONOMIA.indexOf(obj.categoria) < 0) obj.categoria = 'outros';
  obj.confianca = Math.max(0, Math.min(1, Number(obj.confianca) || 0));
  obj.titulo = String(obj.titulo || '').slice(0, 120);
  obj.cnj = String(obj.cnj || '').slice(0, 30);
  obj.data = /^\d{4}-\d{2}-\d{2}$/.test(String(obj.data || '')) ? obj.data : '';

  audit_(ctx.email, 'driveClassificarArquivo', 'drive', fileId, { categoria: obj.categoria, confianca: obj.confianca });
  return { fileId: fileId, nome: nome, mimeType: mime, classificacao: obj };
}

function actionDriveAplicarOrganizacao_(ctx) {
  const ops = Array.isArray(ctx.body.operacoes) ? ctx.body.operacoes : [];
  const pastaId = String(ctx.body.pastaId || '').trim();
  if (!ops.length) return { error: 'sem_operacoes' };

  const resultados = [];
  const subCache = {};
  let pastaRaiz = null;

  for (let i = 0; i < ops.length && i < 150; i++) {
    const op = ops[i] || {};
    try {
      const file = DriveApp.getFileById(String(op.fileId || ''));
      const de = file.getName();
      const novoNome = String(op.novoNome || '').trim();
      if (novoNome && novoNome !== de) file.setName(novoNome);

      let subpasta = null;
      if (op.subpasta && pastaId) {
        if (!pastaRaiz) pastaRaiz = DriveApp.getFolderById(pastaId);
        const chave = String(op.subpasta).slice(0, 80);
        if (!subCache[chave]) {
          const itF = pastaRaiz.getFoldersByName(chave);
          subCache[chave] = itF.hasNext() ? itF.next() : pastaRaiz.createFolder(chave);
        }
        file.moveTo(subCache[chave]);
        subpasta = chave;
      }
      resultados.push({ fileId: op.fileId, ok: true, de: de, para: novoNome || de, subpasta: subpasta });
    } catch (e) {
      resultados.push({ fileId: op.fileId, ok: false, erro: String(e && e.message || e) });
    }
  }

  audit_(ctx.email, 'driveAplicarOrganizacao', 'drive', pastaId || null, {
    total: ops.length,
    ok: resultados.filter(function (r) { return r.ok; }).length
  });
  return { resultados: resultados };
}
