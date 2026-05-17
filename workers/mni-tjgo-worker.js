// UC Jurídico — MNI POC Worker (TJGO)
// Versão: 0.1.0 · prova de conceito
//
// Roda no Cloudflare Workers (free tier). Recebe POST JSON com
// { cnj, cpf, senha, operacao } e proxia a chamada SOAP/MNI para o
// endpoint Projudi do TJGO. Resposta é parseada de XML para JSON
// e devolvida pro frontend.
//
// Deploy:
//   dash.cloudflare.com → Workers & Pages → Create Worker
//   Nome: uc-mni-tjgo
//   Colar este arquivo inteiro, Deploy.
//   Copiar URL gerada (ex: https://uc-mni-tjgo.SEU-USER.workers.dev).
//
// Configurar variável de ambiente (Settings → Variables):
//   ALLOWED_ORIGINS = http://localhost:8000,https://eduardourany-dot.github.io
//   (deixa só localhost pra POC — a gente abre depois)
//
// Uso (frontend):
//   POST https://uc-mni-tjgo.SEU-USER.workers.dev
//   Content-Type: application/json
//   Body: { "cnj": "0001234-56.2024.8.09.0001", "cpf": "00000000000",
//           "senha": "***", "operacao": "consultarProcesso" }

// Endpoint atual (validado em 12/05/2026 — diferente do que estava no
// protótipo Python v4.3.1 que apontava pra /projudi/webservices/...).
// GET ?WSDL retorna o WSDL · POST sem ?WSDL executa operação SOAP.
const TJGO_ENDPOINT = 'https://projudi.tjgo.jus.br/IntercomunicacaoService';
// Namespace que o Projudi/TJGO espera (descoberto via SOAP Fault).
// Note: tem prefixo "servico-" e trailing slash — diferente do protótipo Python.
const MNI_NS_INT    = 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/';

export default {
  async fetch(request, env) {
    // CORS
    const allowed = (env.ALLOWED_ORIGINS || 'http://localhost:8000').split(',').map(s => s.trim());
    const origin = request.headers.get('Origin') || '';
    const corsOk = allowed.includes(origin) || allowed.includes('*');
    const corsHeaders = corsOk ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    } : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }

    const operacao = String(body.operacao || 'consultarProcesso');
    const cnj = String(body.cnj || '').replace(/\D/g, '');
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    const senha = String(body.senha || '');
    const debug = !!body.debug;

    if (!cpf || !senha) {
      return json({ error: 'cpf_senha_obrigatorios' }, 400, corsHeaders);
    }

    try {
      if (operacao === 'consultarProcesso') {
        if (!cnj) return json({ error: 'cnj_obrigatorio' }, 400, corsHeaders);
        const result = await consultarProcesso({ cnj, cpf, senha, debug });
        return json(result, 200, corsHeaders);
      }
      return json({ error: 'operacao_nao_suportada', operacao }, 400, corsHeaders);
    } catch (e) {
      console.error('[MNI POC] erro:', e?.stack || e);
      return json({ error: 'soap_error', message: String(e?.message || e) }, 502, corsHeaders);
    }
  }
};

// ============================================================
// Operação consultarProcesso
// ============================================================

async function consultarProcesso({ cnj, cpf, senha, debug }) {
  // Parâmetros sem prefixo de namespace (elementFormDefault="unqualified",
  // padrão da maioria das implementações MNI Projudi). Se vier SOAP Fault
  // dizendo "expected {alguma uri}param", a gente prefixa eles.
  const envelope = buildEnvelope('consultarProcesso', `
    <idConsultante>${escapeXml(cpf)}</idConsultante>
    <senhaConsultante>${escapeXml(senha)}</senhaConsultante>
    <numeroProcesso>${escapeXml(cnj)}</numeroProcesso>
    <movimentos>true</movimentos>
    <incluirCabecalho>true</incluirCabecalho>
    <incluirDocumentos>false</incluirDocumentos>
  `);

  const t0 = Date.now();
  const resp = await fetch(TJGO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      // SOAPAction vazio — TJGO/Projudi dispatcheia pela operação no body.
      // Se algum tribunal exigir, trocar pro URI completo:
      // 'SOAPAction': '"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/consultarProcesso"'
      'SOAPAction': '""',
      'User-Agent': 'UC-Juridico-MNI-POC/0.2'
    },
    body: envelope
  });
  const elapsed = Date.now() - t0;

  const text = await resp.text();

  if (!resp.ok) {
    return {
      sucesso: false,
      erro: 'http_' + resp.status,
      httpStatus: resp.status,
      elapsedMs: elapsed,
      raw: text.slice(0, 4000)
    };
  }

  // Check for SOAP Fault first
  const fault = extractFault(text);
  if (fault) {
    return {
      sucesso: false,
      erro: 'soap_fault',
      mensagem: fault,
      elapsedMs: elapsed,
      raw: text.slice(0, 4000)
    };
  }

  // Parse the response
  const parsed = parseConsultarProcesso(text);
  const result = {
    sucesso: parsed.sucesso !== false,
    elapsedMs: elapsed,
    ...parsed,
    rawSize: text.length
  };
  // Em modo debug, anexa o XML cru completo pra inspeção/refinamento de parser
  if (debug) result.rawXml = text;
  return result;
}

// ============================================================
// Envelope SOAP MNI
// ============================================================

function buildEnvelope(operacao, bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:int="${MNI_NS_INT}">
  <soap:Header/>
  <soap:Body>
    <int:${operacao}>
${bodyXml.trim()}
    </int:${operacao}>
  </soap:Body>
</soap:Envelope>`;
}

// ============================================================
// XML parsing — sem libs, regex direto (POC)
// Em produção: usar fast-xml-parser ou similar. Pra POC, suficiente.
// ============================================================

function extractFault(xml) {
  const m = xml.match(/<(?:soap:|S:|env:)?Fault[^>]*>([\s\S]*?)<\/(?:soap:|S:|env:)?Fault>/i);
  if (!m) return null;
  const inside = m[1];
  const reason = (inside.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)
              || inside.match(/<(?:S:|env:)?Reason[^>]*>([\s\S]*?)<\/(?:S:|env:)?Reason>/i))?.[1] || inside;
  return reason.trim().slice(0, 800);
}

function tagText(xml, tag) {
  // Captura conteúdo de <ns:tag>...</ns:tag> ou <tag>...</tag>
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function tagAttr(xml, tag, attr) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function allTags(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/(?:\\w+:)?${tag}>)`, 'gi');
  return xml.match(re) || [];
}

// Converte timestamp MNI "YYYYMMDDHHMMSS" pra ISO "YYYY-MM-DDTHH:MM:SS"
function _parseDataHoraMni(s) {
  if (!s) return '';
  s = String(s).replace(/\D/g, '');
  if (s.length < 8) return s;
  const y = s.slice(0,4), m = s.slice(4,6), d = s.slice(6,8);
  const hh = s.slice(8,10) || '00', mm = s.slice(10,12) || '00', ss = s.slice(12,14) || '00';
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

// Decodifica entidades XML básicas (&amp; &lt; &gt; &quot; &apos;)
function _decodeXmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseConsultarProcesso(xml) {
  // Sucesso/mensagem
  const sucessoTag = tagText(xml, 'sucesso');
  const mensagem   = tagText(xml, 'mensagem');
  if (sucessoTag.toLowerCase() === 'false') {
    return { sucesso: false, mensagem: mensagem || '(sem mensagem)' };
  }

  // Bloco <ns2:processo> dentro de <ns5:consultarProcessoResposta>
  const procBlock = (xml.match(/<(?:\w+:)?processo\b[\s\S]*?<\/(?:\w+:)?processo>/i) || [''])[0];

  // dadosBasicos: atributos cnj + classe + filhos
  const dadosBasicosOpen = (procBlock.match(/<(?:\w+:)?dadosBasicos\b[^>]*>/i) || [''])[0];
  const dadosBasicosBlock = (procBlock.match(/<(?:\w+:)?dadosBasicos\b[\s\S]*?<\/(?:\w+:)?dadosBasicos>/i) || [''])[0];

  const numeroProcesso = (dadosBasicosOpen.match(/\bnumero="([^"]*)"/) || [])[1] || '';
  const classeCodigo = (dadosBasicosOpen.match(/\bclasseProcessual="([^"]*)"/) || [])[1] || '';
  const nivelSigilo = (dadosBasicosOpen.match(/\bnivelSigilo="([^"]*)"/) || [])[1] || '';
  const codigoLocalidade = (dadosBasicosOpen.match(/\bcodigoLocalidade="([^"]*)"/) || [])[1] || '';

  // Valor da causa é elemento, não atributo
  const valorCausa = tagText(dadosBasicosBlock, 'valorCausa') || '';

  // Magistrado atuante (text)
  const magistradoAtuante = tagText(dadosBasicosBlock, 'magistradoAtuante') || '';

  // Órgão julgador via atributos
  const orgaoJulgador = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'nomeOrgao') || '';
  const codigoOrgao = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'codigoOrgao') || '';
  const codigoMunicipioIBGE = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'codigoMunicipioIBGE') || '';

  // Assunto principal — atributo descricao de <assuntoLocal>
  const assuntoBlock = (dadosBasicosBlock.match(/<(?:\w+:)?assunto\b[\s\S]*?<\/(?:\w+:)?assunto>/i) || [''])[0];
  const assuntoCodigoNacional = tagText(assuntoBlock, 'codigoNacional') || '';
  const assuntoDescricao = _decodeXmlEntities(tagAttr(assuntoBlock, 'assuntoLocal', 'descricao') || '');
  const assuntoCodigoAssunto = tagAttr(assuntoBlock, 'assuntoLocal', 'codigoAssunto') || '';

  // outroParametro — array de { nome, valor }
  const outrosParams = {};
  const opMatches = dadosBasicosBlock.matchAll(/<(?:\w+:)?outroParametro\b[^>]*\bnome="([^"]*)"[^>]*\bvalor="([^"]*)"[^>]*\/?>/g);
  for (const m of opMatches) {
    outrosParams[m[1]] = _decodeXmlEntities(m[2]);
  }
  // Atalhos pros mais úteis
  const area = outrosParams.Area || '';
  const processoFase = outrosParams.ProcessoFase || '';
  const processoStatus = outrosParams.ProcessoStatus || '';
  const processoTipo = outrosParams.ProcessoTipo || '';
  const serventia = outrosParams.Serventia || '';
  const dataDistribuicaoRaw = outrosParams.DataDistribuicao || '';
  const dataAjuizamento = dataDistribuicaoRaw
    ? `${dataDistribuicaoRaw.slice(0,4)}-${dataDistribuicaoRaw.slice(4,6)}-${dataDistribuicaoRaw.slice(6,8)}`
    : '';

  // Polos + Partes + Advogados
  const partes = [];
  const polos = dadosBasicosBlock.match(/<(?:\w+:)?polo\b[\s\S]*?<\/(?:\w+:)?polo>/gi) || [];
  for (const poloXml of polos) {
    const tipoPolo = (poloXml.match(/<(?:\w+:)?polo\b[^>]*\bpolo="([^"]*)"/) || [])[1] || '';
    const partesXml = poloXml.match(/<(?:\w+:)?parte\b[\s\S]*?<\/(?:\w+:)?parte>/gi) || [];
    for (const pXml of partesXml) {
      // Atributos do <pessoa>
      const nome = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bnome="([^"]*)"/) || [])[1] || '';
      const cpfCnpj = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bnumeroDocumentoPrincipal="([^"]*)"/) || [])[1] || '';
      const tipoPessoa = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\btipoPessoa="([^"]*)"/) || [])[1] || '';
      const sexo = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bsexo="([^"]*)"/) || [])[1] || '';
      // Advogados (podem ser múltiplos)
      const advogados = [];
      const advMatches = pXml.matchAll(/<(?:\w+:)?advogado\b[^>]*?>/g);
      for (const a of advMatches) {
        const advNome = (a[0].match(/\bnome="([^"]*)"/) || [])[1] || '';
        const advInscricao = (a[0].match(/\binscricao="([^"]*)"/) || [])[1] || '';
        const advCpf = (a[0].match(/\bnumeroDocumentoPrincipal="([^"]*)"/) || [])[1] || '';
        advogados.push({ nome: advNome, oab: advInscricao, cpf: advCpf });
      }
      partes.push({ nome, polo: tipoPolo, cpfCnpj, tipoPessoa, sexo, advogados });
    }
  }

  // Movimentos
  const movimentos = [];
  const movsXml = procBlock.match(/<(?:\w+:)?movimento\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/(?:\w+:)?movimento>)/gi) || [];
  for (const m of movsXml) {
    const dataHora = (m.match(/<(?:\w+:)?movimento\b[^>]*\bdataHora="([^"]*)"/) || [])[1] || '';
    const identificador = (m.match(/<(?:\w+:)?movimento\b[^>]*\bidentificadorMovimento="([^"]*)"/) || [])[1] || '';
    const codigoNacional = (m.match(/<(?:\w+:)?movimentoNacional\b[^>]*\bcodigoNacional="([^"]*)"/) || [])[1] || '';
    const codigoLocal = (m.match(/<(?:\w+:)?movimentoLocal\b[^>]*\bcodigoMovimento="([^"]*)"/) || [])[1] || '';
    const descricao = _decodeXmlEntities((m.match(/<(?:\w+:)?movimentoLocal\b[^>]*\bdescricao="([^"]*)"/) || [])[1] || '');
    const complemento = _decodeXmlEntities(tagText(m, 'complemento') || '');
    movimentos.push({
      dataHora: dataHora,                 // formato cru "20260410170039"
      dataIso: _parseDataHoraMni(dataHora), // ISO "2026-04-10T17:00:39"
      codigoNacional,
      codigoLocal,
      descricao,
      complemento,
      identificador
    });
  }
  movimentos.sort((a, b) => (b.dataHora || '').localeCompare(a.dataHora || ''));

  return {
    sucesso: true,
    cnj: numeroProcesso,
    classe: { codigo: classeCodigo },
    assunto: {
      codigoNacional: assuntoCodigoNacional,
      codigoLocal: assuntoCodigoAssunto,
      descricao: assuntoDescricao
    },
    orgaoJulgador,
    codigoOrgao,
    codigoMunicipioIBGE,
    codigoLocalidade,
    nivelSigilo,
    valorCausa,
    dataAjuizamento,
    magistradoAtuante,
    area,
    processoFase,
    processoStatus,
    processoTipo,
    serventia,
    outrosParametros: outrosParams,
    partes,
    movimentos: movimentos.slice(0, 100),
    movimentosTotal: movimentos.length
  };
}

// ============================================================
// Helpers
// ============================================================

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));
}

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(extraHeaders || {})
    }
  });
}
