# UC Jurídico — Roadmap & Backlog

> Última atualização: 16/05/2026 (final do dia de trabalho intensivo)
> Branch ativa: `sandbox` · Próximo merge: `sandbox → main`

---

## 🚦 Status atual

**Em produção (`main`):**
- App UC Jurídico estável (versão anterior à reformulação do cliente)

**Validado em staging (`sandbox` + Cloudflare Pages + Firebase `uc-juridico-staging`):**
- Role `cliente` completo (cliente externo acessa só processos vinculados)
- Role `viewer` (read-only escritório)
- Firestore Security Rules estritas por role
- Cron DJEN diário 08h via Cloud Functions sa-east1 → push FCM
- MNI.5 MVP — protocolar petição via SOAP no TJGO Projudi
- Migração 1879 processos + 806 clientes do Astrea → staging
- Limpeza completa do DataJud (-767 linhas órfãs)
- Restrições API key Firebase (HTTP referrers + 6 APIs específicas)

---

## ⏳ Pendências imediatas (segunda-feira 19/05)

Validar tudo que está em staging antes de deploy prod:

- [ ] **Navegar pelos 1879 processos importados** no sandbox — verificar formato, partes, advogado responsável (Eduardo Urany OAB 16539)
- [ ] **Testar MNI.5 com peça real** num processo do TJGO Projudi (manifestação intercorrente simples)
- [ ] **Confirmar primeira execução automática do cron DJEN** (segunda 08h Brasília — push deve chegar no celular se houver publicações novas)
- [ ] **Merge `sandbox` → `main`** depois de validar acima
- [ ] **Deploy Security Rules em prod**: `firebase deploy --only firestore:rules`
- [ ] **Resolver alerta GitHub Secret Scanner** — marcar Firebase API key como "False positive — public by design, protected via referrer restrictions"

---

## 🎯 Backlog priorizado

### ⭐ Prioridade ALTA (alto ROI, uso diário)

#### P1 — Calculadora de atualização monetária + análise de cobranças
*(bate com Módulo 85 INTEGRA + sugestão #3 do escritório)*

- [ ] **Card Civil**: liquidação de sentença + confronto com índices BACEN/contratuais
- [ ] **Card Fiscal**: dívidas fiscais com índices legais (Selic federal, IPCA, juros legais por esfera)
- [ ] Tela em `/financeiro/calculadora` (ou novo menu)
- [ ] API BCB pra puxar séries históricas (INPC, IGP-M, IPCA, SELIC, TR)
- [ ] Vincular cálculo a processo/cliente (opcional)
- [ ] Exportar memória do cálculo em PDF/Word

**Esforço estimado:** 2-3 dias. **Quem usa:** todos os advogados, diário.

---

#### P2 — Relatórios automáticos pra cliente
*(sugestão #1 do escritório)*

- [ ] Template configurável por cliente (visual + campos)
- [ ] Conteúdo mínimo: pólo ativo/passivo, data distribuição, vara/comarca, valor causa, resumo, prob. êxito, último andamento, providência pendente
- [ ] Periodicidade automática (semanal/quinzenal/mensal)
- [ ] Fila de revisão (advogado revisa antes de enviar)
- [ ] Envio via email/WhatsApp/Drive link
- [ ] Pode reusar dados do `mniData` + eventos do processo

**Esforço:** 2 dias. **Quem usa:** clientes (externamente) + advogados (revisão).

---

#### P3 — Cards especializados de análise + geração de petição
*(sugestão #2 do escritório — 50% já feito)*

- [ ] Cards distintos por tipo de peça (cada um com prompt pré-otimizado):
  - [ ] Petição Inicial (com upload de fatos + linha de trabalho + documentos)
  - [ ] Contestação
  - [ ] Embargos à Execução
  - [ ] Embargos Declaratórios
  - [ ] Agravo de Instrumento
  - [ ] Apelação
  - [ ] Recursos Constitucionais (RE, REsp, RR)
- [ ] Workflow: PDF do auto → análise IA → identificação automática de "providência pendente em N dias" → botão "Gerar peça"
- [ ] Fila de revisão pelo advogado responsável antes de virar versão final

**Já temos:** Análise IA básica + gerarPeticaoIA via Claude API + Petições > Modelos genéricos.

**Esforço:** 1-2 dias.

---

### 🔧 Prioridade MÉDIA

#### P4 — Protocolo multi-sistema (extensão MNI.5)
*(sugestão #6 do escritório + MNI.5 v2)*

- [ ] **PJe** — TRF1, TRF3, TRF5, TJMT, TJES, TJCE, TJMA, TST, TRTs (testar com peticionamento real)
- [ ] **eSAJ** — TJSP, TJMS, TJAC
- [ ] **eProc** — TRF2, TRF4 (quando passarem do WAF)
- [ ] Outros tipos de transmissão:
  - [ ] Recurso (idTipoTransmissao=2) — requer classeProcessual + dadosBasicos do julgamento recorrido
  - [ ] Embargos de Declaração (5)
  - [ ] Petição Inicial (1) — requer cadastro completo de partes/valor causa
- [ ] **Adequação automática de tamanho** (compressão de PDFs > limite do tribunal)
- [ ] **Workflow de aprovação**: peça aguarda revisão de OUTRO advogado antes do botão "Protocolar" liberar
- [ ] Assinatura digital ICP-Brasil (quando algum tribunal exigir)

**Esforço:** 3-5 dias (depende dos quirks de cada tribunal).

---

#### P5 — Custas e despesas processuais
*(Módulo 35 INTEGRA)*

- [ ] Nova collection `custas_despesas` — registros vinculados a processo + cliente
- [ ] Tipos: custas iniciais, GRU, perícia, AR, diligência, certidão, etc.
- [ ] Status: pago / a reembolsar / reembolsado
- [ ] Saldo por processo + por cliente
- [ ] Diferente de `honorarios` (que é receita do escritório) e `transacoes` (caixa interno)

**Esforço:** 1-2 dias.

---

#### P6 — Geração de documentos não-judiciais
*(sugestão #5 do escritório — 20% feito)*

- [ ] Templates pré-prontos:
  - [ ] Procuração ad judicia
  - [ ] Procuração ad judicia + poderes especiais (recebimento, transação)
  - [ ] Contrato de honorários (com placeholders ditáveis)
  - [ ] Declaração de hipossuficiência
  - [ ] Substabelecimento (com/sem reserva)
- [ ] Upload de foto/cópia documento pessoal → OCR → preenchimento automático de campos do cliente
- [ ] **Ditado por voz** pra escopo do contrato de honorários (Web Speech API browser)
- [ ] Integração com **DocuSign / ClickSign / link Drive** pra envio à assinatura

**Esforço:** 3 dias (OCR + ditado + integração assinatura).

---

#### P7 — Organização e renomeação automática de arquivos no Drive
*(sugestão #4 do escritório — 30% feito)*

- [ ] Padrão único de nomenclatura: `{CNJ}_{tipo}_{YYYY-MM-DD}_{descrição}.pdf`
- [ ] Tipos: petição, sentença, decisão, despacho, doc cliente, anexo, etc.
- [ ] Dedupe automático via hash SHA-256
- [ ] Renomeação em batch
- [ ] Estrutura de pastas no Drive: `/Processos/{CNJ}/` + `/Clientes/{Nome}/`
- [ ] Movimentação retroativa de docs já existentes

**Esforço:** 1-2 dias.

---

#### P8 — Relatórios filtrados + export Excel
*(Módulo 50 INTEGRA)*

- [ ] Tela `/relatorios` com filtros gerenciais:
  - Status, advogado, valor causa, comarca, tribunal, período (distribuição/movimentação)
  - Cliente, parte adversa, tipo de ação, área
- [ ] Listagem paginada
- [ ] Export XLSX (já temos lib `xlsx` instalada em tools/migration)
- [ ] "Salvar pesquisa" pra reusar filtros frequentes
- [ ] Ações em bloco: alterar status, atribuir advogado, etc.

**Esforço:** 1-2 dias.

---

### 🐢 Prioridade BAIXA

#### P9 — Migração INTEGRA (PROMAD)
- [ ] Recuperar acesso ao PROMAD (Eduardo voltará depois)
- [ ] Quando voltar: exportar XLSX via Módulo 50/149/117
- [ ] Adaptar parser pra schema do INTEGRA (`tools/migration/parse-integra.js`)
- [ ] Cuidado: 2.155 clientes ativos (vs 806 do Astrea) — pode haver duplicação que precisa dedupe

**Esforço:** 1-2 dias (depende do que vier no XLSX).

---

#### P10 — Cálculos previdenciários
*(Módulo 86 INTEGRA — só se atender essa área)*

- [ ] Aposentadoria por tempo de contribuição
- [ ] Conversão tempo especial (regras TNU + EC 103/2019)
- [ ] Cálculo carência DN/DER

**Esforço:** 3+ dias (regras complexas). **Não fazer se não atende essa área.**

---

#### P11 — Contas a pagar/receber estruturado
*(Módulos 32/33 INTEGRA)*

- [ ] Refator do módulo financeiro existente
- [ ] Status: a vencer / vencido / pago / autorizado / não autorizado
- [ ] Centros de despesa/receita
- [ ] NP/NC (números fiscais)

**Esforço:** 2-3 dias (refator). Hoje funciona com transações + recorrências.

---

#### P12 — Cargas e protocolo físico
*(Módulos 53/114 INTEGRA)*

- [ ] Pouco aplicável em era digital
- [ ] Avaliar se vale a pena, depende do volume de autos físicos do escritório

**Esforço:** 1 dia. **Verificar necessidade antes.**

---

### 📋 Outros itens não-features

- [ ] **Push notification pro cliente** quando publicação nova chegar pra processo dele (extensão do cron DJEN)
- [ ] **MNI.4 fase 3** (se ainda quiser): processar pubs do cron automaticamente em vez de só pre-fetch
- [ ] **Performance**: cache de processos no app cliente (LRU) pra não refetch ao trocar de tela
- [ ] **Documentação interna**: guia de uso pra novos advogados (onboarding)
- [ ] **Testes E2E**: Playwright/Cypress pra fluxos críticos (login, cadastro, protocolo)

---

## 📊 Resumo numérico

| Prioridade | Itens | Esforço total |
|---|---|---|
| ⏳ Imediato (segunda) | 6 | 1 dia validação |
| ⭐ ALTA | 3 (P1-P3) | ~6 dias |
| 🔧 MÉDIA | 5 (P4-P8) | ~11 dias |
| 🐢 BAIXA | 4 (P9-P12) | ~7 dias |
| 📋 Outros | 5 | ~4 dias |

**Total se fizermos TUDO:** ~30 dias de desenvolvimento.

**Sequência minha recomendação:** Validar staging → P1 (Calculadora) → P2 (Relatórios cliente) → P3 (Cards petição) → P4 (Protocolo multi-sistema) → resto conforme demanda real do escritório.
