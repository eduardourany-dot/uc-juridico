# Briefing — Módulo Petições (v7.0, planejado)

> Status: **planejado** · não implementado.
> Dependência: Claude API key (Anthropic) em Script Properties do Apps Script + plano com saldo.
> Referência: este briefing fica como contrato pro implementador (humano ou agente) que for executar os Sprints Pet.1–Pet.5.

## Objetivo

Permitir que advogados gerem peças processuais dentro do UC Jurídico, aproveitando dados já cadastrados (CNJ, cliente, parte adversa, tribunal, advogados, eventos, jurisprudência, PDFs) e templates do escritório. Geração via IA (Claude API) com revisão sênior opcional. Output: Markdown + .docx com timbre Urany de Castro.

## Decisões arquiteturais (cravadas)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Onde edita | **B** — gera no app, edita no Word. Histórico fica como ZIP de versões anexadas ao processo. |
| 2 | Onde roda Claude API | **B** — Apps Script proxy (`backend/Peticoes.gs`). API key em Script Properties (`CLAUDE_API_KEY`). |
| 3 | Tipos no MVP | Contestação · Manifestação · Apelação · Embargos à execução fiscal · Exceção de pré-executividade |
| 4 | Skills do Dr. Cláudio | **B** — UC Jurídico monta o prompt + manda direto pra Claude API, copiando o conteúdo das skills. Plano de evolução para A (independente). |
| 5 | Output | Markdown + .docx (PDF deferido — Word converte melhor) |
| 6 | Versionamento | **A** — coleção `peticoes`, cada versão um doc. Schema preserva `peticaoOriginalId` + `numeroVersao`. |
| 7 | Revisão sênior | **Deferida** — entrega valor mas dobra custo de chamadas Claude. Entra como Pet.6 opcional. |

## Schemas Firestore

```
peticoes/{id}: {
  id, processoId, escritorio_id: 'UC',
  tipo: 'contestacao' | 'manifestacao' | 'apelacao' | 'emb_exec_fiscal' | 'epe',
  numeroVersao: 1, peticaoOriginalId: null | string,
  titulo, briefing,                              // input do advogado
  contextoSnapshot: { processo, eventos, juris }, // congelado no momento da geração
  conteudoMd, conteudoDocxUrl,                   // outputs
  status: 'rascunho' | 'revisada' | 'final' | 'arquivada',
  geradoPor: 'claude-opus-4-7' | 'manual',
  custoEstimado, tokensInput, tokensOutput,
  criadoEm, criadoPor, atualizadoEm
}

peticao_templates/{tipo}: {
  tipo, nome, descricao,
  estruturaTimbre,        // template do .docx (binary base64)
  promptSistema,          // instrução IA
  promptUsuario,          // template com placeholders {processo}, {briefing}, etc
  ativo
}
```

## Sub-sprints

| Sprint | Conteúdo | Conversas |
|---|---|---|
| **Pet.1** | Schema + UI listagem por processo + editor read-only de versões | 1–2 |
| **Pet.2** | Templates dos 5 tipos + autopopulação placeholders + .docx export | 2 |
| **Pet.3** | Apps Script proxy Claude API (`backend/Peticoes.gs`) + chamada de geração | 2 |
| **Pet.4** | UI de geração (input briefing, escolha tipo, output) + revisão sênior | 1–2 |
| **Pet.5** | Versionamento + diff visual | 1 |

**Total:** 7–10 sessões.

## Pré-requisitos operacionais (Eduardo precisa fazer antes de Pet.3)

- Conta Anthropic com API key (https://console.anthropic.com)
- Saldo / cartão configurado
- API key colada em Script Properties: `CLAUDE_API_KEY`
- Validação: rodar `_testarClaudeKey` (a ser criado em Pet.3)

## Skills do Dr. Cláudio reaproveitadas

Skills atualmente disponíveis no Claude Desktop do Eduardo (referência):
- `construir-peticao`
- `revisor-senior`
- `excecao-pre-executividade`
- `contrarrazoes-recursos`
- `template-urany-de-castro`
- `analise-execucao-fiscal`
- `analisar-documentos`
- `analisar-jurisprudencia`

Estratégia em Pet.2: ler conteúdo das skills (`.md` em `~/.claude/skills/`), extrair o prompt sistêmico, copiar para `peticao_templates`. Mantém em 2 lugares por enquanto; consolidação fica pra evolução futura.

## Por que **adiado** (não é prioritário agora)

- **ROI imediato menor** que outros módulos (Financeiro, CRM, Agenda)
- **Custo recorrente** de Claude API (US$/mês conforme uso)
- **Complexidade** alta (proxy Apps Script + integração docx + UI editor)
- **Eduardo já tem fluxo** funcional via Claude Desktop com skills locais — não tem urgência

Quando voltar pra cá: confirmar conta Anthropic + retomar este briefing como guia.
