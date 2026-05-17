# Integração com Gemini API (Google AI Studio)

> Migração Claude → Gemini · stack Google Workspace
> Data: 16/05/2026

## Visão geral

O UC Jurídico agora envia `modeloApi: 'gemini-2.5-pro'` por default ao chamar `DB.gerarPeticaoIA`. O Apps Script remoto precisa rotear pra Google AI quando o `modeloApi` começa com `gemini-`.

## Mudanças necessárias no Apps Script (Code.gs)

### 1. Adicionar GEMINI_API_KEY nas Script Properties

```
Apps Script Editor → ⚙ Configurações do projeto → Propriedades do script → Adicionar
Chave: GEMINI_API_KEY
Valor: [sua chave em https://aistudio.google.com/apikey]
```

### 2. Atualizar a função `gerarPeticaoIA` no Code.gs

Adicionar roteador que detecta o `modeloApi` e despacha pra Gemini OU Claude:

```javascript
function gerarPeticaoIA(payload) {
  const briefing = payload.briefing || '';
  const ctx = payload.contextoSnapshot || {};
  const promptSistema = payload.modeloPromptSistema || '';
  const tipo = payload.tipo || 'outro';
  const modeloApi = payload.modeloApi || 'gemini-2.5-pro';

  // Roteador: Gemini ou Claude
  if (modeloApi.indexOf('gemini') === 0) {
    return _gerarComGemini({ briefing, ctx, promptSistema, tipo, modeloApi });
  } else {
    return _gerarComClaude({ briefing, ctx, promptSistema, tipo, modeloApi });
  }
}

function _gerarComGemini({ briefing, ctx, promptSistema, tipo, modeloApi }) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('api_key_ausente: GEMINI_API_KEY não configurada nas Script Properties');

  // Monta o conteúdo do prompt — Gemini aceita formato 'systemInstruction' separado
  const userPrompt = _montarUserPromptParaGemini(briefing, ctx);

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [{ text: userPrompt }]
    }],
    systemInstruction: {
      parts: [{ text: promptSistema || 'Você é advogado sênior brasileiro com 30 anos de prática contenciosa. Redige peças processuais com técnica e precisão jurídica.' }]
    },
    generationConfig: {
      temperature: 0.4,         // baixa pra reprodutibilidade
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 32000,    // suficiente pra peças longas
      responseMimeType: 'text/plain'
    },
    safetySettings: [
      // Modelos jurídicos podem precisar discutir temas sensíveis (criminal, etc)
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modeloApi}:generateContent?key=${apiKey}`;

  const resp = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code !== 200) {
    const body = resp.getContentText();
    throw new Error(`Gemini HTTP ${code}: ${body.slice(0, 500)}`);
  }

  const data = JSON.parse(resp.getContentText());
  const conteudo = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  const usage = data.usageMetadata || {};

  // Custo Gemini 2.5 Pro (USD/1M tokens, jan/2026):
  //   Input  $1.25/M (até 200k) ou $2.50/M (acima)
  //   Output $10/M  (até 200k) ou $15/M  (acima)
  const tokIn = usage.promptTokenCount || 0;
  const tokOut = usage.candidatesTokenCount || 0;
  const custo = (tokIn * 1.25 + tokOut * 10) / 1000000;

  return {
    conteudo,
    modelo: modeloApi,
    tokensInput: tokIn,
    tokensOutput: tokOut,
    custoEstimado: custo
  };
}

function _montarUserPromptParaGemini(briefing, ctx) {
  let s = '';
  if (ctx.processo) {
    s += '## CONTEXTO DO PROCESSO\n';
    s += JSON.stringify(ctx.processo, null, 2) + '\n\n';
  }
  if (ctx.cliente) {
    s += '## CLIENTE\n';
    s += JSON.stringify(ctx.cliente, null, 2) + '\n\n';
  }
  if (Array.isArray(ctx.eventos) && ctx.eventos.length) {
    s += '## EVENTOS\n';
    s += ctx.eventos.slice(0, 30).map(e => `- ${e.date || ''}: ${e.type || ''} ${e.description ? '· ' + e.description.slice(0, 300) : ''}`).join('\n') + '\n\n';
  }
  if (Array.isArray(ctx.prazos) && ctx.prazos.length) {
    s += '## PRAZOS\n';
    s += ctx.prazos.map(p => `- ${p.deadlineDate || ''}: ${p.description || p.type || ''}`).join('\n') + '\n\n';
  }
  if (Array.isArray(ctx.jurisprudencia) && ctx.jurisprudencia.length) {
    s += '## JURISPRUDÊNCIA APLICÁVEL VERIFICADA\n';
    s += ctx.jurisprudencia.slice(0, 20).map(j => `- ${j.tipo || ''} ${j.numero || ''} · ${(j.ementa || j.tese || '').slice(0, 400)}`).join('\n') + '\n\n';
  }
  s += '## BRIEFING / INSTRUÇÕES DO ADVOGADO\n';
  s += briefing;
  return s;
}

function _gerarComClaude({ briefing, ctx, promptSistema, tipo, modeloApi }) {
  // [código existente que já está no Apps Script — manter como fallback]
  // ... (não mudar)
}
```

### 3. Obter chave da API Gemini

1. Acesse: https://aistudio.google.com/apikey
2. Login com a conta Google Workspace do escritório
3. Clique em "Create API key"
4. Selecione o projeto Google Cloud do UC Jurídico (ou crie um novo no escritório)
5. Copie a chave gerada
6. Cole no Apps Script → Script Properties → `GEMINI_API_KEY`

### 4. (Opcional) Modelos Gemini disponíveis

- `gemini-2.5-pro` — recomendado pra peças (default do UC Jurídico)
- `gemini-2.5-flash` — rápido e barato pra resumos/análises
- `gemini-2.5-flash-lite` — triagem, tarefas simples

Documentação: https://ai.google.dev/gemini-api/docs/models

## Próxima fase: migração pra Vertex AI

Quando o volume crescer, migrar de Google AI Studio → Vertex AI:
- Vantagens: integração com IAM Workspace, controle de custo via projeto, audit logs no Cloud
- Mudança: trocar endpoint `generativelanguage.googleapis.com` por `aiplatform.googleapis.com`
- Autenticação: service account em vez de API key (mais seguro)

## Limitações conhecidas

- **NotebookLM não tem API pública.** Pra usar NotebookLM com dados do app, exportar manualmente (Drive + upload no notebooklm.google.com).
- **Custo Gemini 2.5 Pro mais alto que Flash.** Pra triagem em massa, usar Flash.
- **Safety filters do Gemini** mais restritivos que Claude. Configurados como BLOCK_ONLY_HIGH no exemplo, suficiente pra texto jurídico normal.
