/**
 * Peticoes.gs — UC Jurídico v6.35+ (Sprint Pet.3)
 *
 * Proxy Apps Script pra Anthropic Claude API. Frontend chama via
 * action='gerarPeticaoIA' no doPost de Codigo.gs (mesmo Web App,
 * mesmo OAuth do PDF).
 *
 * Pré-requisitos (Script Properties):
 *   - CLAUDE_API_KEY  → chave da Anthropic (https://console.anthropic.com)
 *
 * Função pública chamada pelo router:
 *   actionGerarPeticaoIA_(ctx)
 *
 * Funções de teste manual:
 *   _testarClaudeKey()       — valida chave + lista modelos disponíveis
 *   _testarChamadaClaude()   — faz uma chamada real pequena pra validar
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_API_VERSION = '2023-06-01';
// Modelo default. Trocar aqui se quiser usar haiku (mais barato) ou outra família.
const CLAUDE_MODELO_DEFAULT = 'claude-opus-4-7';

// System prompt fallback — usado quando o modelo de petição não tem
// promptSistema próprio cadastrado.
const SYSTEM_PROMPT_FALLBACK_PETICAO =
'Você é um advogado sênior brasileiro experiente, redator de peças processuais para o escritório Urany de Castro Advocacia. ' +
'Produza petições juridicamente sólidas, em português formal, citando dispositivos legais e jurisprudência relevante quando aplicável. ' +
'Use linguagem objetiva, sem floreios desnecessários. Sempre estruture: cabeçalho · qualificação · fatos · direito · pedidos. ' +
'Cite OAB do advogado responsável conforme indicado no contexto. ' +
'O output deve ser texto Markdown puro pronto pra colar no Word — sem código, sem comentários meta, sem instruções pro usuário.';

/**
 * Endpoint principal — chamado pelo doPost(action='gerarPeticaoIA').
 * ctx.body deve ter: { briefing, contextoSnapshot, modeloPromptSistema?, tipo?, modelo? }
 */
function actionGerarPeticaoIA_(ctx) {
  const body = ctx && ctx.body || {};
  const briefing = String(body.briefing || '').trim();
  const contextoSnapshot = body.contextoSnapshot || {};
  const modeloPromptSistema = String(body.modeloPromptSistema || '').trim();
  const tipo = String(body.tipo || 'outro');
  const modeloApi = String(body.modeloApi || CLAUDE_MODELO_DEFAULT);

  if (!briefing) {
    return { error: 'briefing_vazio', message: 'Briefing obrigatório.' };
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    return { error: 'api_key_ausente', message: 'CLAUDE_API_KEY não configurada em Script Properties.' };
  }

  const systemPrompt = modeloPromptSistema || SYSTEM_PROMPT_FALLBACK_PETICAO;
  const userMessage = _montarUserMessage(briefing, contextoSnapshot, tipo);

  let resp;
  try {
    resp = _callClaudeApi(apiKey, modeloApi, systemPrompt, userMessage);
  } catch (e) {
    return { error: 'falha_chamada', message: e.message || String(e) };
  }

  // Audit log
  try {
    audit_(ctx.email, 'gerarPeticaoIA', 'peticoes', null, {
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
    tokensInput: resp.tokensInput,
    tokensOutput: resp.tokensOutput,
    custoEstimado: resp.custoEstimado,
    geradoEm: Date.now()
  };
}

/**
 * Chamada HTTP pra Anthropic. Retorna { conteudo, tokensInput, tokensOutput, custoEstimado }.
 */
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
  // Concatena content blocks tipo 'text' (ignora tool_use, thinking, etc)
  const blocks = Array.isArray(data.content) ? data.content : [];
  const conteudo = blocks
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const tokensInput = data.usage?.input_tokens || 0;
  const tokensOutput = data.usage?.output_tokens || 0;
  const custoEstimado = _estimarCustoUSD(modelo, tokensInput, tokensOutput);

  return { conteudo, tokensInput, tokensOutput, custoEstimado };
}

/**
 * Estima custo em USD baseado em preços públicos (atualizado conforme modelo).
 * Tabela cravada — atualize quando Anthropic publicar novos preços.
 */
function _estimarCustoUSD(modelo, tokensInput, tokensOutput) {
  // Preços por 1M tokens (input, output) — referência Q1 2026
  const tabela = {
    'claude-opus-4-7':  { input: 15.0, output: 75.0 },
    'claude-sonnet-4-6': { input: 3.0,  output: 15.0 },
    'claude-haiku-4-5':  { input: 0.8,  output: 4.0 }
  };
  // fallback: assume opus pricing
  const m = (modelo || '').toLowerCase();
  let preco = tabela['claude-opus-4-7'];
  for (const key of Object.keys(tabela)) {
    if (m.indexOf(key) === 0 || m.indexOf(key.replace(/-/g, '')) === 0) {
      preco = tabela[key]; break;
    }
  }
  return ((tokensInput / 1e6) * preco.input + (tokensOutput / 1e6) * preco.output);
}

/**
 * Monta o userMessage estruturado em Markdown a partir do briefing
 * + contextoSnapshot. Esse é o "prompt do usuário" no protocolo Claude.
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
    if (linhas.length) partes.push('## Processo\n\n' + linhas.join('\n') + '\n\n');
  }

  if (ctx.cliente) {
    const c = ctx.cliente;
    const linhas = [];
    if (c.nome) linhas.push('- **Nome**: ' + c.nome);
    if (c.cpfCnpj) linhas.push('- **CPF/CNPJ**: ' + c.cpfCnpj);
    if (c.tipoPessoa) linhas.push('- **Tipo**: ' + c.tipoPessoa);
    if (c.email) linhas.push('- **Email**: ' + c.email);
    if (c.telefone) linhas.push('- **Telefone**: ' + c.telefone);
    if (c.endereco) linhas.push('- **Endereço**: ' + c.endereco);
    if (linhas.length) partes.push('## Cliente\n\n' + linhas.join('\n') + '\n\n');
  }

  if (Array.isArray(ctx.eventos) && ctx.eventos.length) {
    partes.push('## Eventos recentes (últimos)\n\n');
    ctx.eventos.slice(0, 10).forEach(e => {
      partes.push('- ' + (e.date || e.data || '') + (e.type ? ' (' + e.type + ')' : '') + ' — ' + (e.descricao || e.description || '').slice(0, 200) + '\n');
    });
    partes.push('\n');
  }

  if (Array.isArray(ctx.prazos) && ctx.prazos.length) {
    partes.push('## Prazos ativos\n\n');
    ctx.prazos.forEach(d => {
      partes.push('- ' + (d.deadlineDate || '').slice(0, 10) + ' — ' + (d.description || d.type || '') + '\n');
    });
    partes.push('\n');
  }

  if (Array.isArray(ctx.jurisprudencia) && ctx.jurisprudencia.length) {
    partes.push('## Jurisprudência catalogada\n\n');
    ctx.jurisprudencia.forEach(j => {
      partes.push('- ' + (j.type || '') + ': ' + (j.citation || '') + '\n');
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
// Funções de teste manual
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
  Logger.log('  Modelo default: ' + CLAUDE_MODELO_DEFAULT);
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
