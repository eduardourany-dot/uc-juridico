// UC Jurídico — MNI Worker genérico (multi-tribunal)
// Versão: 0.2.0 · sprint MNI.1
//
// Generaliza o mni-tjgo-worker.js (POC v0.1) pra rotear chamadas SOAP/MNI
// pra múltiplos tribunais via um registry interno. Mantém parser MNI 2.2.2
// validado contra TJGO/Projudi.
//
// Deploy:
//   dash.cloudflare.com → Workers & Pages → Create Worker
//   Nome sugerido: uc-mni
//   Colar este arquivo inteiro, Deploy.
//
// Variáveis (Settings → Variables):
//   ALLOWED_ORIGINS = http://localhost:8000,https://eduardourany-dot.github.io
//
// Endpoints do Worker (POST JSON):
//   { tribunal: "TJGO", operacao: "consultarProcesso", cnj, cpf, senha, debug? }
//   { tribunal: "TJGO", operacao: "health" }                          ← probe rápido (HEAD/GET ?WSDL)
//   { operacao: "listarTribunais" }                                    ← devolve o registry inteiro
//
// MUDANÇA vs v0.1 (TJGO POC):
//   - aceita campo `tribunal` (default: "TJGO")
//   - lookup de endpoint/namespace/soapAction via TRIBUNAIS_REGISTRY
//   - novas operações: "health" e "listarTribunais"
//   - mesmo parser de consultarProcesso (validado pra TJGO; PJe pode precisar tuning)

// ============================================================
// REGISTRY — manter em sync com workers/mni-tribunais.json
// ============================================================
const TRIBUNAIS_REGISTRY = {
  TJGO: {
    codigo: 'TJGO',
    nome: 'Tribunal de Justiça de Goiás',
    sistema: 'projudi',
    esfera: 'estadual',
    endpoint: 'https://projudi.tjgo.jus.br/IntercomunicacaoService',
    wsdl: 'https://projudi.tjgo.jus.br/IntercomunicacaoService?WSDL',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '',
    validado: true,
    validadoEm: '2026-05-11'
  },
  TRF1: {
    codigo: 'TRF1',
    nome: 'Tribunal Regional Federal da 1ª Região',
    sistema: 'pje',
    esfera: 'federal',
    endpoint: 'https://pje1g.trf1.jus.br/pje/intercomunicacao',
    wsdl: 'https://pje1g.trf1.jus.br/pje/intercomunicacao?wsdl',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '',
    validado: true,
    validadoEm: '2026-05-11'
  },
  STJ: {
    codigo: 'STJ',
    nome: 'Superior Tribunal de Justiça',
    sistema: 'rest',
    esfera: 'superior',
    endpoint: null,
    namespace: null,
    soapAction: null,
    validado: false,
    naoSuportado: true,
    motivo: 'STJ não publica endpoint MNI/SOAP público. Integração programática via DataJud REST.'
  },
  TJDFT: {
    codigo: 'TJDFT',
    nome: 'Tribunal de Justiça do Distrito Federal e Territórios',
    sistema: 'rest',
    esfera: 'estadual',
    endpoint: null,
    namespace: null,
    soapAction: null,
    validado: false,
    naoSuportado: true,
    motivo: 'TJDFT publica apenas REST (jurisdf, RH). Página oficial de webservices não lista WSDL MNI.'
  },
  TJSP: {
    codigo: 'TJSP',
    nome: 'Tribunal de Justiça de São Paulo',
    sistema: 'esaj',
    esfera: 'estadual',
    endpoint: null,
    namespace: null,
    soapAction: null,
    validado: false,
    naoSuportado: true,
    motivo: 'TJSP usa eSAJ e historicamente não expõe MNI público.'
  },
  TRT18: {
    codigo: 'TRT18',
    nome: 'Tribunal Regional do Trabalho da 18ª Região (Goiás)',
    sistema: 'pje',
    esfera: 'trabalho',
    endpoint: null,
    namespace: null,
    soapAction: null,
    validado: false,
    naoSuportado: true,
    motivo: 'TRT18 implementou MNI em cooperação técnica com MPT Digital, mas endpoint público não localizado. Múltiplos paths testados retornaram 404.'
  }
};

// ============================================================
// Handler HTTP
// ============================================================

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

    // GET / → mini-status pra facilitar checagem manual no browser
    if (request.method === 'GET') {
      return json({
        worker: 'uc-mni',
        versao: '0.2.0',
        tribunaisSuportados: Object.keys(TRIBUNAIS_REGISTRY),
        operacoes: ['consultarProcesso', 'health', 'listarTribunais']
      }, 200, corsHeaders);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, corsHeaders);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'invalid_json' }, 400, corsHeaders); }

    const operacao = String(body.operacao || 'consultarProcesso');

    // ---- listarTribunais (não exige credenciais) ----
    if (operacao === 'listarTribunais') {
      return json({
        sucesso: true,
        tribunais: TRIBUNAIS_REGISTRY,
        default: 'TJGO'
      }, 200, corsHeaders);
    }

    // ---- health (probe ?WSDL — não exige credenciais) ----
    if (operacao === 'health') {
      const codigo = String(body.tribunal || '').toUpperCase();
      const conf = TRIBUNAIS_REGISTRY[codigo];
      if (!conf) return json({ error: 'tribunal_desconhecido', codigo }, 400, corsHeaders);
      if (conf.naoSuportado) {
        return json({ sucesso: false, codigo, status: 'nao_suportado', motivo: conf.motivo || '' }, 200, corsHeaders);
      }
      const r = await healthCheck(conf);
      return json({ sucesso: true, codigo, ...r }, 200, corsHeaders);
    }

    // ---- operações que precisam de credenciais ----
    const codigo = String(body.tribunal || 'TJGO').toUpperCase();
    const conf = TRIBUNAIS_REGISTRY[codigo];
    if (!conf) return json({ error: 'tribunal_desconhecido', codigo }, 400, corsHeaders);
    if (conf.naoSuportado) {
      return json({ error: 'tribunal_nao_suportado', codigo, motivo: conf.motivo || '' }, 400, corsHeaders);
    }

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
        const result = await consultarProcesso(conf, { cnj, cpf, senha, debug });
        result.tribunal = codigo;
        return json(result, 200, corsHeaders);
      }
      return json({ error: 'operacao_nao_suportada', operacao }, 400, corsHeaders);
    } catch (e) {
      console.error('[MNI] erro:', e?.stack || e);
      return json({ error: 'soap_error', message: String(e?.message || e), tribunal: codigo }, 502, corsHeaders);
    }
  }
};

// ============================================================
// Health check — probe leve, sem credenciais
// ============================================================

async function healthCheck(conf) {
  const url = conf.wsdl || (conf.endpoint + '?WSDL');
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'UC-Juridico-MNI/0.2-healthcheck' },
      // Cloudflare permite custom timeout via signal
      signal: AbortSignal.timeout(8000)
    });
    const elapsed = Date.now() - t0;
    const ct = resp.headers.get('content-type') || '';
    let preview = '';
    if (resp.ok) {
      const text = await resp.text();
      preview = text.slice(0, 200);
      // WSDL real começa com <?xml ... e tem definitions ou wsdl:definitions
      const okWsdl = /<\??xml/i.test(preview) && /definitions/i.test(preview);
      return {
        status: okWsdl ? 'ok' : 'resposta_inesperada',
        httpStatus: resp.status,
        contentType: ct,
        elapsedMs: elapsed,
        preview
      };
    }
    return {
      status: 'http_erro',
      httpStatus: resp.status,
      contentType: ct,
      elapsedMs: elapsed
    };
  } catch (e) {
    return {
      status: 'falha_rede',
      elapsedMs: Date.now() - t0,
      erro: String(e?.message || e)
    };
  }
}

// ============================================================
// Operação consultarProcesso (parser validado em TJGO)
// ============================================================

async function consultarProcesso(conf, { cnj, cpf, senha, debug }) {
  const envelope = buildEnvelope(conf.namespace, 'consultarProcesso', `
    <idConsultante>${escapeXml(cpf)}</idConsultante>
    <senhaConsultante>${escapeXml(senha)}</senhaConsultante>
    <numeroProcesso>${escapeXml(cnj)}</numeroProcesso>
    <movimentos>true</movimentos>
    <incluirCabecalho>true</incluirCabecalho>
    <incluirDocumentos>false</incluirDocumentos>
  `);

  const t0 = Date.now();
  const resp = await fetch(conf.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      // soapAction: '' (Projudi) ou URI completo (alguns PJe). Vem do registry.
      'SOAPAction': conf.soapAction === '' || conf.soapAction == null
        ? '""'
        : `"${conf.soapAction}"`,
      'User-Agent': 'UC-Juridico-MNI/0.2'
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

  const parsed = parseConsultarProcesso(text);
  const result = {
    sucesso: parsed.sucesso !== false,
    elapsedMs: elapsed,
    ...parsed,
    rawSize: text.length
  };
  if (debug) result.rawXml = text;
  return result;
}

// ============================================================
// Envelope SOAP MNI
// ============================================================

function buildEnvelope(namespace, operacao, bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:int="${namespace}">
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
// Validado pra TJGO/Projudi. PJe pode precisar ajustes.
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
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function tagAttr(xml, tag, attr) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function _parseDataHoraMni(s) {
  if (!s) return '';
  s = String(s).replace(/\D/g, '');
  if (s.length < 8) return s;
  const y = s.slice(0,4), m = s.slice(4,6), d = s.slice(6,8);
  const hh = s.slice(8,10) || '00', mm = s.slice(10,12) || '00', ss = s.slice(12,14) || '00';
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

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
  const sucessoTag = tagText(xml, 'sucesso');
  const mensagem   = tagText(xml, 'mensagem');
  if (sucessoTag.toLowerCase() === 'false') {
    return { sucesso: false, mensagem: mensagem || '(sem mensagem)' };
  }

  const procBlock = (xml.match(/<(?:\w+:)?processo\b[\s\S]*?<\/(?:\w+:)?processo>/i) || [''])[0];

  const dadosBasicosOpen = (procBlock.match(/<(?:\w+:)?dadosBasicos\b[^>]*>/i) || [''])[0];
  const dadosBasicosBlock = (procBlock.match(/<(?:\w+:)?dadosBasicos\b[\s\S]*?<\/(?:\w+:)?dadosBasicos>/i) || [''])[0];

  const numeroProcesso = (dadosBasicosOpen.match(/\bnumero="([^"]*)"/) || [])[1] || '';
  const classeCodigo = (dadosBasicosOpen.match(/\bclasseProcessual="([^"]*)"/) || [])[1] || '';
  const nivelSigilo = (dadosBasicosOpen.match(/\bnivelSigilo="([^"]*)"/) || [])[1] || '';
  const codigoLocalidade = (dadosBasicosOpen.match(/\bcodigoLocalidade="([^"]*)"/) || [])[1] || '';

  const valorCausa = tagText(dadosBasicosBlock, 'valorCausa') || '';
  const magistradoAtuante = tagText(dadosBasicosBlock, 'magistradoAtuante') || '';

  const orgaoJulgador = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'nomeOrgao') || '';
  const codigoOrgao = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'codigoOrgao') || '';
  const codigoMunicipioIBGE = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'codigoMunicipioIBGE') || '';

  const assuntoBlock = (dadosBasicosBlock.match(/<(?:\w+:)?assunto\b[\s\S]*?<\/(?:\w+:)?assunto>/i) || [''])[0];
  const assuntoCodigoNacional = tagText(assuntoBlock, 'codigoNacional') || '';
  const assuntoDescricao = _decodeXmlEntities(tagAttr(assuntoBlock, 'assuntoLocal', 'descricao') || '');
  const assuntoCodigoAssunto = tagAttr(assuntoBlock, 'assuntoLocal', 'codigoAssunto') || '';

  const outrosParams = {};
  const opMatches = dadosBasicosBlock.matchAll(/<(?:\w+:)?outroParametro\b[^>]*\bnome="([^"]*)"[^>]*\bvalor="([^"]*)"[^>]*\/?>/g);
  for (const m of opMatches) {
    outrosParams[m[1]] = _decodeXmlEntities(m[2]);
  }
  const area = outrosParams.Area || '';
  const processoFase = outrosParams.ProcessoFase || '';
  const processoStatus = outrosParams.ProcessoStatus || '';
  const processoTipo = outrosParams.ProcessoTipo || '';
  const serventia = outrosParams.Serventia || '';
  const dataDistribuicaoRaw = outrosParams.DataDistribuicao || '';
  const dataAjuizamento = dataDistribuicaoRaw
    ? `${dataDistribuicaoRaw.slice(0,4)}-${dataDistribuicaoRaw.slice(4,6)}-${dataDistribuicaoRaw.slice(6,8)}`
    : '';

  const partes = [];
  const polos = dadosBasicosBlock.match(/<(?:\w+:)?polo\b[\s\S]*?<\/(?:\w+:)?polo>/gi) || [];
  for (const poloXml of polos) {
    const tipoPolo = (poloXml.match(/<(?:\w+:)?polo\b[^>]*\bpolo="([^"]*)"/) || [])[1] || '';
    const partesXml = poloXml.match(/<(?:\w+:)?parte\b[\s\S]*?<\/(?:\w+:)?parte>/gi) || [];
    for (const pXml of partesXml) {
      const nome = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bnome="([^"]*)"/) || [])[1] || '';
      const cpfCnpj = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bnumeroDocumentoPrincipal="([^"]*)"/) || [])[1] || '';
      const tipoPessoa = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\btipoPessoa="([^"]*)"/) || [])[1] || '';
      const sexo = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bsexo="([^"]*)"/) || [])[1] || '';
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
      dataHora,
      dataIso: _parseDataHoraMni(dataHora),
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
