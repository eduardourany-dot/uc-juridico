/**
 * Peticoes.gs — UC Jurídico v6.64.0 (Gemini 2.5 Pro default + Claude fallback)
 *
 * Proxy Apps Script pra dois provedores de IA generativa:
 *   - Google AI Studio (Gemini 2.5 Pro / Flash / Flash-Lite) — DEFAULT
 *   - Anthropic Claude (Opus / Sonnet / Haiku) — fallback
 *
 * Roteamento por prefixo do `modeloApi`:
 *   - 'gemini-*'   → Gemini
 *   - 'claude-*' (ou qualquer outro) → Claude
 *
 * Frontend chama via action='gerarPeticaoIA' no doPost de Codigo.gs.
 *
 * Pré-requisitos (Script Properties):
 *   - GEMINI_API_KEY  → https://aistudio.google.com/apikey
 *   - CLAUDE_API_KEY  → https://console.anthropic.com (opcional, só se quiser fallback)
 *
 * Função pública chamada pelo router:
 *   actionGerarPeticaoIA_(ctx)
 *
 * Funções de teste manual:
 *   _testarGeminiKey()       — valida chave Gemini
 *   _testarChamadaGemini()   — chamada real pequena ao Gemini
 *   _testarClaudeKey()       — valida chave Claude
 *   _testarChamadaClaude()   — chamada real pequena ao Claude
 */

// ============================================================
// CONFIG — Gemini
// ============================================================
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODELO_DEFAULT = 'gemini-2.5-pro';

// ============================================================
// CONFIG — Claude (fallback)
// ============================================================
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_API_VERSION = '2023-06-01';
const CLAUDE_MODELO_DEFAULT = 'claude-opus-4-7';

// ============================================================
// SYSTEM PROMPTS
// ============================================================
const SYSTEM_PROMPT_FALLBACK_PETICAO =
'Você é um advogado sênior brasileiro experiente, redator de peças processuais para o escritório Urany de Castro Advocacia. ' +
'Produza petições juridicamente sólidas, em português formal, citando dispositivos legais e jurisprudência relevante quando aplicável. ' +
'Use linguagem objetiva, sem floreios desnecessários. Sempre estruture: cabeçalho · qualificação · fatos · direito · pedidos. ' +
'Cite OAB do advogado responsável conforme indicado no contexto. ' +
'O output deve ser texto Markdown puro pronto pra colar no Word — sem code blocks, sem comentários meta, sem instruções pro usuário.';

// ============================================================
// ROTEADOR PRINCIPAL — chamado pelo doPost(action='gerarPeticaoIA')
// ============================================================
/**
 * Despacha pra Gemini ou Claude baseado no prefixo do modeloApi.
 * ctx.body: { briefing, contextoSnapshot, modeloPromptSistema?, tipo?, modeloApi? }
 */
function actionGerarPeticaoIA_(ctx) {
  const body = ctx && ctx.body || {};
  const briefing = String(body.briefing || '').trim();
  const contextoSnapshot = body.contextoSnapshot || {};
  const modeloPromptSistema = String(body.modeloPromptSistema || '').trim();
  const tipo = String(body.tipo || 'outro');
  const modeloApi = String(body.modeloApi || GEMINI_MODELO_DEFAULT);

  if (!briefing) {
    return { error: 'briefing_vazio', message: 'Briefing obrigatório.' };
  }

  const systemPrompt = modeloPromptSistema || SYSTEM_PROMPT_FALLBACK_PETICAO;
  const userMessage = _montarUserMessage(briefing, contextoSnapshot, tipo);

  // Decide provedor
  const ehGemini = modeloApi.indexOf('gemini') === 0;
  const apiKeyName = ehGemini ? 'GEMINI_API_KEY' : 'CLAUDE_API_KEY';
  const apiKey = PropertiesService.getScriptProperties().getProperty(apiKeyName);
  if (!apiKey) {
    return { error: 'api_key_ausente', message: apiKeyName + ' não configurada em Script Properties.' };
  }

  let resp;
  try {
    resp = ehGemini
      ? _callGeminiApi(apiKey, modeloApi, systemPrompt, userMessage)
      : _callClaudeApi(apiKey, modeloApi, systemPrompt, userMessage);
  } catch (e) {
    return { error: 'falha_chamada', message: e.message || String(e) };
  }

  // Audit log
  try {
    audit_(ctx.email, 'gerarPeticaoIA', 'peticoes', null, {
      provedor: ehGemini ? 'gemini' : 'claude',
      modelo: modeloApi,
      tipo: tipo,
      tokensInput: resp.tokensInput,
      tokensOutput: resp.tokensOutput,
      caracteresGerados: (resp.conteudo || '').length
    });
  } catch (_) {}

  return {
    conteudo: resp.conteudo,
    modelo: modeloApi,
    provedor: ehGemini ? 'gemini' : 'claude',
    tokensInput: resp.tokensInput,
    tokensOutput: resp.tokensOutput,
    custoEstimado: resp.custoEstimado,
    geradoEm: Date.now()
  };
}

// ============================================================
// GEMINI — chamada HTTP
// ============================================================
/**
 * Chamada à Google AI Studio (Gemini).
 * Retorna { conteudo, tokensInput, tokensOutput, custoEstimado }.
 */
function _callGeminiApi(apiKey, modelo, systemPrompt, userMessage) {
  const endpoint = GEMINI_API_BASE + '/' + modelo + ':generateContent?key=' + apiKey;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 32000,
      responseMimeType: 'text/plain'
    },
    safetySettings: [
      // Permite discutir temas sensíveis (criminal, conflitos) — bloqueia só extremo
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };

  const resp = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Gemini API ' + code + ': ' + text.slice(0, 500));
  }

  const data = JSON.parse(text);

  // Bloqueio por safety filter
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new Error('Gemini bloqueou: ' + data.promptFeedback.blockReason);
  }

  // Concatena todos os parts.text do primeiro candidato
  let conteudo = '';
  if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
    conteudo = data.candidates[0].content.parts
      .map(function(p) { return p.text || ''; })
      .join('')
      .trim();
  }

  // Detecta finishReason problemático
  const finishReason = data.candidates && data.candidates[0] && data.candidates[0].finishReason;
  if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
    throw new Error('Gemini interrompeu: ' + finishReason + (conteudo ? ' (' + conteudo.length + ' chars gerados)' : ''));
  }

  const usage = data.usageMetadata || {};
  const tokensInput = usage.promptTokenCount || 0;
  const tokensOutput = usage.candidatesTokenCount || 0;
  const custoEstimado = _estimarCustoUSD(modelo, tokensInput, tokensOutput);

  return {
    conteudo: conteudo,
    tokensInput: tokensInput,
    tokensOutput: tokensOutput,
    custoEstimado: custoEstimado
  };
}

// ============================================================
// CLAUDE — chamada HTTP (fallback)
// ============================================================
function _callClaudeApi(apiKey, modelo, systemPrompt, userMessage) {
  const payload = {
    model: modelo,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  };

  const resp = UrlFetchApp.fetch(CLAUDE_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Claude API ' + code + ': ' + text.slice(0, 500));
  }

  const data = JSON.parse(text);
  const blocks = Array.isArray(data.content) ? data.content : [];
  const conteudo = blocks
    .filter(function(b) { return b.type === 'text'; })
    .map(function(b) { return b.text; })
    .join('\n')
    .trim();

  const tokensInput = (data.usage && data.usage.input_tokens) || 0;
  const tokensOutput = (data.usage && data.usage.output_tokens) || 0;
  const custoEstimado = _estimarCustoUSD(modelo, tokensInput, tokensOutput);

  return { conteudo: conteudo, tokensInput: tokensInput, tokensOutput: tokensOutput, custoEstimado: custoEstimado };
}

// ============================================================
// Custo estimado em USD — tabela unificada Gemini + Claude
// ============================================================
/**
 * Tabela cravada — referência Q1 2026. Atualizar quando provedores
 * mudarem preços (jan/2026):
 *
 * Gemini (Google AI Studio):
 *   3.1 Pro Preview $2.00/M in (< 200K), $4.00/M in (>= 200K)
 *                   $12/M out (< 200K), $18/M out (>= 200K)
 *   3 Flash Preview $0.50/M in, $3.00/M out (free tier reduzido)
 *   2.5 Pro         $1.25/M in (< 200K), $2.50/M in (>= 200K)
 *                   $10/M out (< 200K), $15/M out (>= 200K)
 *   2.5 Flash       $0.30/M in, $2.50/M out
 *   2.5 Flash-Lite  $0.10/M in, $0.40/M out
 *
 * Claude (Anthropic):
 *   Opus 4.7      $15/M in, $75/M out
 *   Sonnet 4.6    $3/M in, $15/M out
 *   Haiku 4.5     $0.80/M in, $4/M out
 */
function _estimarCustoUSD(modelo, tokensInput, tokensOutput) {
  const m = String(modelo || '').toLowerCase();
  // Tier alto pra Gemini Pro quando contexto > 200K tokens
  const tierLargo = tokensInput >= 200000;

  let preco;
  // Gemini 3 (preview, lançado fev/2026)
  if (m.indexOf('gemini-3') === 0 && m.indexOf('flash') >= 0) {
    preco = { input: 0.50, output: 3.00 };
  } else if (m.indexOf('gemini-3') === 0 && (m.indexOf('pro') >= 0 || !m.match(/flash/))) {
    preco = tierLargo ? { input: 4.00, output: 18.0 } : { input: 2.00, output: 12.0 };
  // Gemini 2.5
  } else if (m.indexOf('gemini-2.5-pro') === 0) {
    preco = tierLargo ? { input: 2.50, output: 15.0 } : { input: 1.25, output: 10.0 };
  } else if (m.indexOf('gemini-2.5-flash-lite') === 0) {
    preco = { input: 0.10, output: 0.40 };
  } else if (m.indexOf('gemini-2.5-flash') === 0) {
    preco = { input: 0.30, output: 2.50 };
  } else if (m.indexOf('gemini') === 0) {
    // Default Gemini: assume Pro tier baixo
    preco = { input: 1.25, output: 10.0 };
  } else if (m.indexOf('claude-opus') === 0) {
    preco = { input: 15.0, output: 75.0 };
  } else if (m.indexOf('claude-sonnet') === 0) {
    preco = { input: 3.0, output: 15.0 };
  } else if (m.indexOf('claude-haiku') === 0) {
    preco = { input: 0.80, output: 4.0 };
  } else {
    // Fallback: Opus pricing (mais alto, evita subestimar)
    preco = { input: 15.0, output: 75.0 };
  }

  return ((tokensInput / 1e6) * preco.input + (tokensOutput / 1e6) * preco.output);
}

// ============================================================
// USER MESSAGE — montagem Markdown a partir do contexto
// ============================================================
/**
 * Monta o "prompt do usuário" estruturado em Markdown.
 * Mesmo formato funciona pros 2 provedores.
 */
function _montarUserMessage(briefing, ctx, tipo) {
  const partes = [];
  partes.push('# Briefing do advogado\n');
  partes.push(briefing);
  partes.push('\n\n---\n\n');
  partes.push('# Contexto do processo\n');

  if (ctx.processo) {
    const p = ctx.processo;
    const linhas = [];
    if (p.cnj) linhas.push('- **CNJ**: ' + p.cnj);
    if (p.name) linhas.push('- **Nome**: ' + p.name);
    if (p.area) linhas.push('- **Área**: ' + p.area);
    if (p.type || p.tipo) linhas.push('- **Tipo**: ' + (p.type || p.tipo));
    if (p.court) linhas.push('- **Tribunal/Vara**: ' + p.court);
    if (p.comarca) linhas.push('- **Comarca**: ' + p.comarca);
    if (p.parteAdversa) linhas.push('- **Parte adversa**: ' + p.parteAdversa);
    if (p.advogadoResponsavel) linhas.push('- **Advogado responsável**: ' + p.advogadoResponsavel);
    if (p.advogadoSuplente) linhas.push('- **Suplente**: ' + p.advogadoSuplente);
    if (p.valorCausa) linhas.push('- **Valor da causa**: R$ ' + p.valorCausa);
    if (p.dataDistribuicao) linhas.push('- **Data de distribuição**: ' + p.dataDistribuicao);
    if (p.polo) linhas.push('- **Polo do cliente**: ' + (p.polo === 'AT' ? 'Ativo (autor)' : p.polo === 'PA' ? 'Passivo (réu)' : p.polo));
    if (p.risco) linhas.push('- **Classificação de risco/êxito**: ' + p.risco);
    if (p.fase) linhas.push('- **Fase**: ' + p.fase);
    if (linhas.length) partes.push('## Processo\n\n' + linhas.join('\n') + '\n\n');
  }

  if (ctx.cliente) {
    const c = ctx.cliente;
    const linhas = [];
    if (c.nome) linhas.push('- **Nome**: ' + c.nome);
    if (c.cpfCnpj || c.doc) linhas.push('- **CPF/CNPJ**: ' + (c.cpfCnpj || c.doc));
    if (c.tipoPessoa || c.tipo) linhas.push('- **Tipo**: ' + (c.tipoPessoa || c.tipo));
    if (c.email) linhas.push('- **Email**: ' + c.email);
    if (c.telefone) linhas.push('- **Telefone**: ' + c.telefone);
    if (c.endereco) {
      if (typeof c.endereco === 'string') {
        linhas.push('- **Endereço**: ' + c.endereco);
      } else if (typeof c.endereco === 'object') {
        const e = c.endereco;
        const ed = [e.rua, e.numero, e.bairro, e.cidade, e.estado, e.cep].filter(Boolean).join(', ');
        if (ed) linhas.push('- **Endereço**: ' + ed);
      }
    }
    if (linhas.length) partes.push('## Cliente\n\n' + linhas.join('\n') + '\n\n');
  }

  if (Array.isArray(ctx.eventos) && ctx.eventos.length) {
    partes.push('## Eventos recentes (até 30 mais recentes)\n\n');
    ctx.eventos.slice(0, 30).forEach(function(e) {
      partes.push('- ' + (e.date || e.data || '') + (e.type ? ' (' + e.type + ')' : '') + ' — ' + (e.descricao || e.description || e.title || '').slice(0, 300) + '\n');
    });
    partes.push('\n');
  }

  if (Array.isArray(ctx.prazos) && ctx.prazos.length) {
    partes.push('## Prazos ativos\n\n');
    ctx.prazos.forEach(function(d) {
      partes.push('- ' + (d.deadlineDate || d.date || '').slice(0, 10) + ' — ' + (d.description || d.type || '') + '\n');
    });
    partes.push('\n');
  }

  if (Array.isArray(ctx.jurisprudencia) && ctx.jurisprudencia.length) {
    partes.push('## Jurisprudência catalogada (já verificada)\n\n');
    ctx.jurisprudencia.slice(0, 20).forEach(function(j) {
      const id = (j.type || j.tipo || '') + ' ' + (j.numero || '') + (j.relator ? ' · Rel. ' + j.relator : '');
      const ementa = (j.ementa || j.tese || j.citation || '').slice(0, 400);
      partes.push('- ' + id.trim() + (ementa ? ': ' + ementa : '') + '\n');
    });
    partes.push('\n');
  }

  partes.push('\n---\n\n');
  partes.push('# Tarefa\n\n');
  partes.push('Redija a peça processual conforme o briefing acima, ');
  partes.push('considerando o contexto do processo. Tipo de peça: **' + tipo + '**. ');
  partes.push('Output em Markdown puro (sem code blocks, sem comentários meta), pronto pra colar no Word.');

  return partes.join('');
}

// =====================================================================
// Funções de teste manual — Gemini
// =====================================================================

function _testarGeminiKey() {
  const k = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!k) {
    Logger.log('❌ GEMINI_API_KEY não configurada em Script Properties.');
    Logger.log('  Acesse https://aistudio.google.com/apikey → Create API key.');
    Logger.log('  Cole em: ⚙ Configurações do projeto → Propriedades do script.');
    return;
  }
  Logger.log('✓ GEMINI_API_KEY configurada (length ' + k.length + ', prefix ' + k.slice(0, 10) + '...)');
  Logger.log('  Modelo default: ' + GEMINI_MODELO_DEFAULT);
  Logger.log('  Endpoint: ' + GEMINI_API_BASE);
  Logger.log('  Use _testarChamadaGemini() pra fazer uma chamada real.');
}

function _testarChamadaGemini() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) { Logger.log('❌ GEMINI_API_KEY ausente.'); return; }
  try {
    const r = _callGeminiApi(apiKey, GEMINI_MODELO_DEFAULT,
      'Você é um assistente. Responda em UMA frase curta.',
      'Diga "ping" e pare.');
    Logger.log('✓ Resposta: ' + r.conteudo);
    Logger.log('  Input tokens: ' + r.tokensInput + ' · Output: ' + r.tokensOutput);
    Logger.log('  Custo estimado: $' + r.custoEstimado.toFixed(6));
  } catch (e) {
    Logger.log('❌ Falhou: ' + e.message);
  }
}

/**
 * Teste alternativo com Gemini 2.5 Flash — funciona no FREE TIER (sem billing).
 * Use só pra validar a integração; o default do app permanece 2.5 Pro.
 */
function _testarChamadaGeminiFlash() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) { Logger.log('❌ GEMINI_API_KEY ausente.'); return; }
  try {
    const r = _callGeminiApi(apiKey, 'gemini-2.5-flash',
      'Você é um assistente. Responda em UMA frase curta.',
      'Diga "ping" e pare.');
    Logger.log('✓ Resposta: ' + r.conteudo);
    Logger.log('  Modelo: gemini-2.5-flash');
    Logger.log('  Input tokens: ' + r.tokensInput + ' · Output: ' + r.tokensOutput);
    Logger.log('  Custo estimado: $' + r.custoEstimado.toFixed(6));
  } catch (e) {
    Logger.log('❌ Falhou: ' + e.message);
  }
}

// =====================================================================
// Funções de teste manual — Claude (fallback)
// =====================================================================

function _testarClaudeKey() {
  const k = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!k) {
    Logger.log('❌ CLAUDE_API_KEY não configurada em Script Properties.');
    Logger.log('  Acesse https://console.anthropic.com → API Keys → Create.');
    Logger.log('  Cole em: ⚙ Configurações do projeto → Propriedades do script.');
    return;
  }
  Logger.log('✓ CLAUDE_API_KEY configurada (length ' + k.length + ', prefix ' + k.slice(0, 10) + '...)');
  Logger.log('  Modelo default Claude: ' + CLAUDE_MODELO_DEFAULT);
  Logger.log('  Endpoint: ' + CLAUDE_API_URL);
  Logger.log('  Use _testarChamadaClaude() pra fazer uma chamada real.');
}

function _testarChamadaClaude() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) { Logger.log('❌ CLAUDE_API_KEY ausente.'); return; }
  try {
    const r = _callClaudeApi(apiKey, CLAUDE_MODELO_DEFAULT,
      'Você é um assistente. Responda em UMA frase curta.',
      'Diga "ping" e pare.');
    Logger.log('✓ Resposta: ' + r.conteudo);
    Logger.log('  Input tokens: ' + r.tokensInput + ' · Output: ' + r.tokensOutput);
    Logger.log('  Custo estimado: $' + r.custoEstimado.toFixed(6));
  } catch (e) {
    Logger.log('❌ Falhou: ' + e.message);
  }
}
