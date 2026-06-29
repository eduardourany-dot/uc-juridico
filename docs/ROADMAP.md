# UC Jurídico — Roadmap & Backlog

> Última atualização: **29/06/2026**
> Código em `main`/`sandbox`: **v6.87.1** (+ `Lembretes.gs` consolidado) · em sincronia (fast-forward)
> Hospedagem: LOCAWEB (`uc.uranydecastro.adv.br`, upload manual) + GitHub Pages (auto-build de `main`)

---

## 🚦 Status atual

**Em produção, estável:**
- App completo: processos, clientes, agenda, financeiro, publicações/prazos, petições IA, calculadora cível
- Roles `cliente` / `viewer` / `admin` com Firestore Rules estritas
- Cron DJEN diário → push FCM · MNI.5 (protocolo SOAP TJGO Projudi)
- Co-titularidade `ucjuridico@` (GitHub, Cloudflare, Firebase, Apps Script)
- Agenda com Google Calendar + Meet (auto-convidados + RSVP)

**Pronto no código, ⏳ aguardando deploy manual (ver abaixo):**
- Épico **Prazos** (v6.85 → v6.87.1): Kanban + máquina de estados, fatal interna, auto-agendamento 🤖, Agenda como centro de controle, sync Google Calendar, e-mails consolidados por processo

---

## ⏳ Pendências imediatas — DEPLOY MANUAL

Sem deploy automático no backend nem na LOCAWEB. Para colocar o épico de Prazos no ar:

- [ ] **LOCAWEB (FileZilla)** — subir `index.html` + `service-worker.js` (v6.87.1). Conferir rodapé `v6-87-1`. *(`api.js` não mudou.)*
- [ ] **Apps Script ("UC Juridico Backend")** — colar `backend/Lembretes.gs` (e-mail consolidado por processo + fatal interna/FATAL/sem-ACK).
- [ ] **Apps Script (verificar)** — Google Calendar API habilitada em Serviços (já usada pelo Meet; provável que sim) — necessária pro sync de prazos → Google Calendar.

As duas primeiras são independentes; sem (1) a Agenda/Kanban novos não aparecem, sem (2) os e-mails continuam saindo um por parte.

---

## ✅ Entregue recentemente — Épico Prazos (junho/2026)

| Versão | Entrega |
|---|---|
| **v6.85.0** | Kanban de prazos + máquina de estados (etapas auditadas), **fatal interna** (real − 2 úteis), marco **⛔FATAL**, escalonamento **sem-ACK**, ajustar fatal com motivo, fix off-by-one nos marcos |
| **v6.86.0** | **Auto-agendamento 🤖**: intimação não tratada → vínculo por CNJ + parser extrai prazo → cria prazo automaticamente (guarda de expirados; órfãs/sem-prazo ficam na caixa) |
| **v6.87.0** | **Agenda como centro de controle**: prazos do Kanban na Agenda (lista+calendário, ações inline); unificação do fluxo DJEN (helper único `montarPrazoDjen`); **sync Google Calendar** por prazo + auto-sync opcional |
| **v6.87.1** | Auto-agendados sem banner em Publicações — revisão no próprio Kanban (dar ciência) / Agenda (🤖 revisar) |
| `Lembretes.gs` | **E-mails consolidados por processo**: 1 e-mail por CNJ (não por parte), com nome das partes + número do processo + providência em poucas palavras |

**Ainda em aberto no épico (afinamento, baixa urgência):**
- [ ] Badges de dias da LISTA de publicações ainda usam contagem antiga (+1d conservador) — alinhar com `_diaFatalLocal`
- [ ] Avaliar consolidar também o **push** por processo (hoje 1 push por prazo; e-mail já consolidado)
- [ ] Opção de silenciar o lembrete do Google Calendar quando o prazo já cobra pela régua do app (evitar alerta em dobro)

---

## 🎯 Backlog priorizado

### ⭐ Prioridade ALTA (alto ROI, uso diário)

#### P1 — Calculadora · Fase 2
*(Fase 1 ✅ concluída: tab Cível completa, 6 índices BCB, juros CC 406, multa/honorários CPC, salvar em `calculos/{id}`)*
- [ ] **Tab Fiscal**: índices legais por esfera (Selic federal, IPCA, juros legais), confronto com cobrança tributária
- [ ] Vincular cálculo a processo/cliente
- [ ] Tab "Histórico" (reabrir/excluir cálculos salvos)
- [ ] Exportar memória de cálculo em PDF/Word

**Esforço:** ~4-5h.

#### P2 — Relatórios automáticos pro cliente
*(sugestão #1 do escritório)*
- [ ] Template configurável por cliente (visual + campos)
- [ ] Conteúdo: pólo ativo/passivo, distribuição, vara/comarca, valor da causa, resumo, prob. êxito, último andamento, **providência pendente**
- [ ] Periodicidade automática (semanal/quinzenal/mensal) + fila de revisão do advogado
- [ ] Envio por e-mail/WhatsApp/Drive · reusa `mniData` + eventos do processo

**Esforço:** ~2 dias.

#### P3 / #34 — Cards de petição + fila de revisão do advogado
*(sugestão #2 — parcialmente feito: análise IA + `gerarPeticaoIA` + modelos genéricos já existem)*
- [ ] Cards por tipo de peça com prompt pré-otimizado (Inicial, Contestação, Embargos exec./decl., Agravo, Apelação, Recursos constitucionais)
- [ ] Workflow: PDF do auto → análise IA → detecção de "providência em N dias" → "Gerar peça"
- [ ] **Fila de revisão** pelo advogado responsável antes de virar versão final (#34)

**Esforço:** ~1-2 dias.

---

### 🔧 Prioridade MÉDIA

#### P4 — Protocolo multi-sistema (extensão MNI.5)
- [ ] PJe (TRFs, TJMT/ES/CE/MA, TST, TRTs) · eSAJ (TJSP/MS/AC) · eProc (TRF2/4)
- [ ] Tipos de transmissão: recurso, embargos, petição inicial
- [ ] Compressão automática de PDF > limite do tribunal
- [ ] Workflow de aprovação por OUTRO advogado antes de liberar "Protocolar"
- [ ] Assinatura ICP-Brasil (quando exigido)

**Esforço:** 3-5 dias.

#### P5 — Custas e despesas processuais
- [ ] Collection `custas_despesas` vinculada a processo + cliente (iniciais, GRU, perícia, AR, diligência…)
- [ ] Status pago / a reembolsar / reembolsado · saldo por processo e por cliente

**Esforço:** 1-2 dias.

#### P6 — Documentos não-judiciais
- [ ] Templates: procuração (ad judicia / + especiais), contrato de honorários, hipossuficiência, substabelecimento
- [ ] OCR de documento pessoal → preenchimento automático · ditado por voz (Web Speech API)
- [ ] Integração assinatura (DocuSign/ClickSign/Drive)

**Esforço:** ~3 dias.

#### P7 — Organização de arquivos no Drive
- [ ] Nomenclatura padrão `{CNJ}_{tipo}_{AAAA-MM-DD}_{descrição}.pdf` · dedupe SHA-256 · batch
- [ ] Estrutura `/Processos/{CNJ}/` + `/Clientes/{Nome}/` · movimentação retroativa

**Esforço:** 1-2 dias.

#### P8 — Relatórios filtrados + export Excel
- [ ] Tela `/relatorios` com filtros gerenciais (status, advogado, comarca, tribunal, período, cliente, área)
- [ ] Listagem paginada · export XLSX · salvar pesquisa · ações em bloco

**Esforço:** 1-2 dias.

---

### 🐢 Prioridade BAIXA

- **P9 — Migração INTEGRA (PROMAD)**: exportar XLSX (Mód. 50/149/117), adaptar parser, dedupe (2.155 clientes vs 806 do Astrea). *1-2 dias.*
- **P10 — Cálculos previdenciários** (Mód. 86): só se atender a área. *3+ dias.*
- **P11 — Contas a pagar/receber estruturado** (Mód. 32/33): refator do financeiro. *2-3 dias.*
- **P12 — Cargas/protocolo físico** (Mód. 53/114): avaliar necessidade. *1 dia.*

---

### 📋 Outros (não-features)

- [ ] Push pro **cliente** quando publicação nova chegar no processo dele
- [ ] Performance: cache LRU de processos no app cliente
- [ ] Onboarding: guia de uso pra novos advogados
- [ ] Testes E2E (Playwright) pros fluxos críticos (login, cadastro, protocolo, agendar prazo)

---

## 📊 Resumo

| Prioridade | Itens | Esforço |
|---|---|---|
| ⏳ Deploy manual | 3 | minutos |
| ⭐ ALTA | P1-P3 | ~5 dias |
| 🔧 MÉDIA | P4-P8 | ~10 dias |
| 🐢 BAIXA | P9-P12 | ~7 dias |
| 📋 Outros | 4 | ~4 dias |

**Sequência recomendada:** deploy do épico Prazos → P1 (Calculadora Fiscal) → P2 (Relatórios cliente) → P3/#34 (Cards + fila de revisão) → P4+ conforme demanda real do escritório.
