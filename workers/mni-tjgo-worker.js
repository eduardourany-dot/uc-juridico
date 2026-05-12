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

    if (!cpf || !senha) {
      return json({ error: 'cpf_senha_obrigatorios' }, 400, corsHeaders);
    }

    try {
      if (operacao === 'consultarProcesso') {
        if (!cnj) return json({ error: 'cnj_obrigatorio' }, 400, corsHeaders);
        const result = await consultarProcesso({ cnj, cpf, senha });
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

async function consultarProcesso({ cnj, cpf, senha }) {
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
      'SOAPAction': '"consultarProcesso"',
      'User-Agent': 'UC-Juridico-MNI-POC/0.1'
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
  return {
    sucesso: parsed.sucesso !== false,
    elapsedMs: elapsed,
    ...parsed,
    rawSize: text.length
  };
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

function parseConsultarProcesso(xml) {
  // Extrai sucesso/mensagem do envelope MNI padrão
  const sucessoTag = tagText(xml, 'sucesso');
  const mensagem   = tagText(xml, 'mensagem');

  if (sucessoTag.toLowerCase() === 'false') {
    return { sucesso: false, mensagem: mensagem || '(sem mensagem)' };
  }

  // Encontra o bloco <processo> dentro de <consultarProcessoResposta>
  const procBlock = (xml.match(/<(?:\w+:)?processo\b[\s\S]*?<\/(?:\w+:)?processo>/i) || [''])[0];

  // Cabeçalho
  const cabecalho = (procBlock.match(/<(?:\w+:)?dadosBasicos\b[\s\S]*?<\/(?:\w+:)?dadosBasicos>/i) || [''])[0]
                || (procBlock.match(/<(?:\w+:)?cabecalhoProcesso\b[\s\S]*?<\/(?:\w+:)?cabecalhoProcesso>/i) || [''])[0];

  const numeroProcesso = tagAttr(cabecalho, 'dadosBasicos', 'numero') || tagText(cabecalho, 'numero') || '';
  const classeNome = tagText(cabecalho, 'classeProcessual') || (cabecalho.match(/classeProcessual="(\d+)"/) || [])[1] || '';
  const assunto = tagText(cabecalho, 'assunto');
  const orgaoJulgador = tagAttr(cabecalho, 'orgaoJulgador', 'nomeOrgao') || tagText(cabecalho, 'orgaoJulgador');
  const dataAjuizamento = tagAttr(cabecalho, 'dadosBasicos', 'dataAjuizamento') || '';
  const valorCausa = tagAttr(cabecalho, 'dadosBasicos', 'valorCausa') || '';

  // Partes
  const partes = [];
  const polos = procBlock.match(/<(?:\w+:)?polo\b[\s\S]*?<\/(?:\w+:)?polo>/gi) || [];
  for (const poloXml of polos) {
    const tipoPolo = tagAttr(poloXml, 'polo', 'polo') || '';
    const partesXml = allTags(poloXml, 'parte');
    for (const pXml of partesXml) {
      const nome = tagText(pXml, 'nome') || '';
      const cpfCnpj = tagText(pXml, 'numeroDocumentoPrincipal') || tagText(pXml, 'cpf') || tagText(pXml, 'cnpj') || '';
      partes.push({ nome, polo: tipoPolo, cpfCnpj });
    }
  }

  // Movimentos
  const movimentos = [];
  const movsXml = allTags(procBlock, 'movimento');
  for (const m of movsXml) {
    const dataMov = tagAttr(m, 'movimento', 'dataHora') || '';
    const codMov = tagAttr(m, 'movimentoNacional', 'codigoNacional') || '';
    const descMov = tagText(m, 'descricao') || tagText(m, 'movimentoLocal') || '';
    movimentos.push({ dataHora: dataMov, codigo: codMov, descricao: descMov });
  }
  // mais recente primeiro
  movimentos.sort((a, b) => (b.dataHora || '').localeCompare(a.dataHora || ''));

  return {
    sucesso: true,
    cnj: numeroProcesso,
    classe: classeNome,
    assunto,
    orgaoJulgador,
    dataAjuizamento,
    valorCausa,
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
