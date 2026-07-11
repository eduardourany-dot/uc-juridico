# UC Jurídico — Roadmap & Backlog

> Última atualização: **29/06/2026** (fim do dia — plano oficial consolidado após análise de mercado)
> Código em `main`/`sandbox`: **v6.89.0** · **produção em dia** (LOCAWEB + Apps Script deployados em 05/07) · e-mails suspensos via painel 🔔
> Hospedagem: LOCAWEB (`uc.uranydecastro.adv.br`, upload manual) + GitHub Pages (auto-build de `main`)

---

## 🚦 Status atual

**Em produção, estável:**
- App completo: processos, clientes, agenda, financeiro, publicações/prazos, petições IA, calculadora cível
- Roles `cliente` / `viewer` / `admin` com Firestore Rules estritas
- Cron DJEN diário → push FCM · MNI.5 (protocolo SOAP TJGO Projudi)
- Agenda com Google Calendar + Meet (auto-convidados + RSVP)

**Em produção desde 05/07 (épico completo no ar):**
- Épico **Prazos** (v6.85 → v6.89.0): Kanban + máquina de estados, fatal interna, auto-agendamento 🤖, Agenda como centro de controle, sync Google Calendar, e-mails consolidados, **varredura DataJud**, **digest diário** e **painel de notificações 🔔** (e-mails seguem suspensos por padrão — reativar é um clique no painel, decisão E1 do titular)

**Posição competitiva (análise de mercado 29/06):** o UC está em pé de igualdade ou à frente de Astrea/Projuris/ADVBOX/EasyJur em captura de intimações, cálculo auditável de prazos, IA e peticionamento MNI — a custo ~zero vs R$ 1.350–2.700/mês que um SaaS custaria pros 9 usuários. Os gaps reais estão listados no plano abaixo.

---

## ✅ BLOCO A — Deploys concluídos (05/07)

- [x] **A1. LOCAWEB** — v6.89.0 no ar (`index.html` + `service-worker.js`).
- [x] **A2. Apps Script** — `Lembretes.gs` recolado (consolidado + digest + painel 🔔).
- [x] **A3. Apps Script** — Google Calendar API verificada.

---

## 🗺 Plano priorizado (consolidado na conversa de 29/06)

### BLOCO B — Vitórias rápidas · custo zero, alto retorno

| # | Item | Esforço | Notas |
|---|---|---|---|
| B1 | ✅ **Varredura DataJud da carteira** (**v6.88.0**) — boot diário (silencioso) + botão em Configurações→MNI; consulta a API pública do CNJ (91 tribunais) pra cada processo ativo >7d sem sync e importa movimentos dos últimos 90d como eventos (dedupe idempotente) | feito 30/06 | Lotes de 150, ~85 req/min, relatório clicável. ✅ em produção 05/07 |
| B2 | ✅ **E-mail em formato digest** (**v6.89.0**) — resumo diário por advogado após a hora configurada (default 7h), agrupado por processo (Parte·Providência·Situação·Prazo, inclui sem-ACK); individuais só T-0/FATAL/escalonamento; anti-dup por dia | feito 30/06 | ✅ em produção 05/07. Reativação dos e-mails (E1) já nasce no formato digest |
| B3 | ✅ **Painel de notificações no app** (**v6.89.0**) — Configurações→Sincronização→🔔: kill-switch de e-mail (um clique!), modo digest/porMarco, hora, marcos, opt-out push/e-mail por advogado. Backend lê `settings/notifConfig` a cada ciclo (≤30 min, sem recolar código) | feito 30/06 | ✅ em produção 05/07 |
| B4 | ✅ **Botão WhatsApp por processo** (**v6.90.0**) — "💬 WhatsApp pro cliente" nas Ações do processo: modal com telefone do cliente vinculado + mensagem editável (último andamento), abre `wa.me`; nada é enviado sem revisão | feito 06/07 | Sem custo de API. Automação total (Meta API) fica pra depois, se valer |
| B5 | ✅ **Afinamentos do épico Prazos** (**v6.90.0**) — B5.1 contagem de dias alinhada ao dia-calendário em lista/processo/agenda/status visual; B5.3 toggle "lembretes do Google no prazo" (desligar evita alerta em dobro; requer recolar `Calendar.gs` só se for usar); B5.2 decisão: push permanece por prazo (deep-link individual) | feito 06/07 | **Bloco B 100% concluído** |

### BLOCO C — Novas funcionalidades (gaps do comparativo de mercado)

| # | Item | Esforço / custo | Notas |
|---|---|---|---|
| C1 | **Tarefas genéricas com delegação** ("ligar pro cliente", "elaborar contrato") no Kanban + produtividade por advogado | ~1-2 dias | Estilo ADVBOX Taskscore; dados de etapas/logs já existem |
| C2 | **Cobrança automática** — boleto/PIX via gateway (Asaas ou similar) + NFS-e depois, ligado nas parcelas de honorários | ~3 dias + taxa gateway | Impacto direto em inadimplência |
| C3 | **Assinatura eletrônica** (era o P6) — procuração/contrato → API ZapSign/Autentique → cliente assina no celular | ~1-2 dias | Autentique tem plano grátis |
| C4 | **Descoberta de processos novos por OAB** (única coisa que EXIGE serviço pago — DataJud não busca por OAB, por LGPD) | R$ 49,90–249,90/mês | Piloto sem fidelidade: Escavador Avançado (R$ 49,90) ou Judit Plataforma Advogado (R$ 249,90). API integrada (Judit: setup R$ 5k + R$ 1k/mês) só se o piloto provar valor |
| C5 | **BI gerencial** — rentabilidade por cliente/área, produtividade por advogado, mapa de calor de prazos | ~1-2 dias/painel | Dados já existem |
| C6 | **Timesheet + faturamento por hora** | ~2 dias | **Só se** o escritório passar a cobrar por hora; senão pular |
| C7 | **Organizador de documentos do Drive** (evolui o P7) — lote de arquivos → IA classifica (taxonomia de 11 tipos de peça) e propõe nome padronizado `{CNJ}_{tipo}_{data}` + pasta do processo → revisão no app (padrão 🤖) → Apps Script aplica via Drive API + relatório | ~2-3 dias · R$ 0 | Fluxo em 4 etapas (envio→IA→revisão→aplicar) e prompts vindos do parecer "Organizador Jurídico" (ver HANDOFF). Confiança <0,7 destacada na revisão; falha de um arquivo não derruba o lote |
| C8 | ✅ **Segmentador de autos** (**v6.91.0**) — botão "✂️ Segmentar autos" nas Ações do processo: PDF consolidado → IA propõe índice de peças (`[PÁGINA N]`, taxonomia de 11 tipos) → revisão editável obrigatória → pdf-lib recorta e baixa cada peça + índice vira nota | feito 06/07 | Reusa a action gerarPeticaoIA (zero backend novo). Evolução futura: salvar peças direto no Drive (junto do C7) |

### BLOCO D — Infraestrutura (a dor operacional crônica)

| # | Item | Notas |
|---|---|---|
| D1 | 🔶 **Deploy automático** — frontend PRONTO: Firebase Hosting configurado + workflow no push (decisão de migrar pro Google, 05/07 — ver `docs/RUNBOOK_migracao_google.md`; faltam 3 passos manuais: 1º deploy, secret, DNS). Parte 2 pendente: backend Apps Script → Cloud Functions | LOCAWEB descontinuada. ⚠️ conferir zona DNS/MX antes de cancelar |
| D2 | **Testes no repositório + CI** — modularizar `index.html` (Vite, sem framework) pra commitar os testes (73 casos escritos em 29/06 viveram fora do repo) | Reduz custo de toda mudança futura |
| D3 | **Um único host de produção** — encerrar dualidade GitHub Pages legado vs LOCAWEB | Decidir junto com D1 |

### BLOCO E — Decisões do titular (pendentes de "segunda ordem")

- [ ] **E1. Quando reativar os e-mails** — e se reativa no modelo consolidado atual ou já como digest (B2, recomendado).
- [ ] **E2. Se contrata o piloto de descoberta por OAB** (C4) — único custo recorrente novo em discussão.

### 📌 Sequência recomendada

**A (deploys) → B1 (DataJud) → B2+B3 (digest + painel, reativando e-mails no formato bom) → C1 (tarefas) → C2 (cobrança) → D1 (deploy automático em paralelo, quando houver folga).**

---

## 📋 Backlog complementar (anterior, continua válido)

- **Calculadora Fase 2** (~4-5h): tab Fiscal, vincular a processo/cliente, histórico, export PDF/Word. *(Fase 1 ✅.)*
- **Relatórios automáticos pro cliente** (~2 dias): template configurável, periodicidade, fila de revisão, envio e-mail/WhatsApp/Drive.
- **Cards de petição por tipo + fila de revisão do advogado (#34)** (~1-2 dias): prompts pré-otimizados (contestação, agravo, apelação…), workflow PDF→análise→peça.
- **Protocolo multi-sistema** (3-5 dias): PJe/eSAJ/eProc, recurso/inicial, compressão de PDF, aprovação por segundo advogado.
- **Custas e despesas** (1-2 dias) · **Docs não-judiciais + OCR** (~3 dias) · **Drive organizado** (1-2 dias) · **Relatórios Excel gerenciais** (1-2 dias).
- Baixa prioridade: migração INTEGRA · previdenciário · contas a pagar/receber estruturado · cargas físicas.
- Outros: push pro cliente em publicação nova · cache LRU no app cliente · onboarding · testes E2E.

---

## ✅ Entregue recentemente — Épico Prazos (junho/2026)

| Versão | Entrega |
|---|---|
| **v6.85.0** | Kanban + máquina de estados, **fatal interna**, marco ⛔FATAL, escalonamento sem-ACK, ajustar fatal auditado, fix off-by-one |
| **v6.86.0** | **Auto-agendamento 🤖** (vínculo por CNJ + parser + guardas de expirados/órfãs) |
| **v6.87.0** | **Agenda centro de controle** + unificação fluxo DJEN + **sync Google Calendar** |
| **v6.87.1** | Auto-agendados sem banner — revisão no Kanban (ciência) / Agenda (🤖 revisar) |
| `Lembretes.gs` | **E-mails consolidados por processo** (1 por CNJ: partes + providência) + **kill-switch de suspensão** |

---

## 💰 Referências de custo levantadas (jul/2026 — confirmar com comercial antes de fechar)

- **DataJud (CNJ)**: grátis; consulta por CNJ em 91 tribunais; SEM busca por OAB/CPF (LGPD); defasagem horas–dias; ~120 req/min.
- **Judit Plataforma**: R$ 9,90 → R$ 249,90/mês (Advogado: 59 monitoramentos + 31 novas ações). **Judit API**: setup R$ 5k + mínimo R$ 1k/mês anual (monitoramento diário R$ 1,50/proc, consulta R$ 0,25, novas ações R$ 15/filtro + R$ 0,25/captura).
- **Escavador Plataforma**: R$ 9,90 (3 proc) / R$ 29,90 (10) / R$ 49,90 (20 + alerta de processos novos). **API**: créditos, tabela só no dashboard (cadastro grátis dá créditos de teste); volume via comercial.
- **Codilo**: sob consulta (terceira cotação pra negociar).
- Comparativo SaaS: Astrea/EasyJur ≈ R$ 150–300/usuário/mês (≈ R$ 1.350–2.700/mês pros 9).
