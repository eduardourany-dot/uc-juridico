# Briefing — Sprint Agenda Unificada (v6.25, ✅ entregue)

> Status: **✅ entregue (v6.25.0).** Compromissos do escritório (audiências, reuniões, diligências) com push/email automático reusando cron Apps Script do Sprint 3.

## Motivação

Antes (v6.24): eventos do processo eram só timeline histórica (DataJud/DJEN/manual). Não havia agenda forward-looking de compromissos. Audiência amanhã, reunião com cliente semana que vem — nada disso era avisado pelo sistema.

Após Sprint Agenda:
- Coleção `compromissos` com tipos jurídicos (audiência, reunião, diligência, etc.)
- Vinculação a processo + cliente + responsável + participantes
- Cron horário envia push T-1 (dia anterior) + push+email T-0 (dia/horário)
- UI rota `/agenda` com lista cronológica e filtros
- Aba "Compromissos" em processo e em cliente
- Bloco "próximos" no dashboard inicial

## Decisões cravadas (recomendação aplicada)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Coleção | `compromissos` |
| 2 | PK | `id` (uid gerado) |
| 3 | Tipos | audiencia · reuniao_interna · reuniao_cliente · diligencia · prazo_admin · outro |
| 4 | Recorrência | Sem (MVP) — repetições viram cópias manuais |
| 5 | Vinculação | 1 processo opcional + 1 cliente opcional + 1 responsável + lista de participantes (advogados) |
| 6 | Lembretes | T-1 (push+email) + T-0 (push+email no dia) |
| 7 | Status | agendado · confirmado · realizado · cancelado · adiado |
| 8 | Google Calendar | Adiado (Sprint Agenda v2 — exige OAuth Calendar API) |
| 9 | UI | Lista cronológica + filtros (mês, tipo, advogado, processo, cliente, status) + dashboard + abas |
| 10 | Multi-tenant | `escritorio_id: 'UC'` (mesmo padrão) |

## Schema Firestore

```
compromissos/{id}: {
  id, escritorio_id: 'UC',
  tipo: 'audiencia'|'reuniao_interna'|'reuniao_cliente'|'diligencia'|'prazo_admin'|'outro',
  titulo,                          // obrigatório
  dataHoraInicio,                  // ISO datetime
  dataHoraFim,                     // ISO datetime (opcional)
  local,                           // string livre — sala, endereço, link Zoom, etc.
  processoId,                      // FK opcional
  clienteId,                       // FK opcional
  responsavel,                     // nome do advogado principal
  participantes: [],               // array de nomes (outros advogados envolvidos)
  status: 'agendado'|'confirmado'|'realizado'|'cancelado'|'adiado',
  observacoes,
  notificado: { 'T-1': { email: { at, push, email } }, 'T-0': ... },
  createdAt, updatedAt
}
```

## Roteamento de notificações

T-1 (dia anterior) e T-0 (dia/horário do compromisso):
- Responsável (sempre)
- Participantes (todos da lista)
- Sócio padrão (apenas se status ainda 'agendado' em T-0 — escalonamento pra confirmar presença)

Se compromisso `status === 'cancelado'`: não envia.
Se `status === 'realizado'`: não envia.

## UI

### Sidebar

Novo item **"Agenda"** entre **Prazos** e **Financeiro**.

### Rota `/agenda`

- Header: stats (próximos 7 dias · próximos 30 dias · vencidos não-marcados)
- Filtros: período (esta semana · próx 30 dias · custom · todos), tipo, responsável, status
- Lista cronológica agrupada por dia, ordenada
- Botão "+ Novo compromisso"

### Aba "Compromissos" no processo

Filtra `compromissos` com `processoId === p.id`. Botão "+ Novo" pré-vincula.

### Aba "Compromissos" no dashboard do cliente

Mesma lógica, filtra `clienteId`.

### Bloco no dashboard inicial

Cards dos próximos 5 compromissos da semana, com link rápido pra cada.

## Backend (Lembretes.gs)

Nova função `cron_lembretesDeCompromissos()` integrada ao `cron_lembretesUnificado`. Mesma lógica:
- Janela `[hoje-2, hoje+8]` por `dataHoraInicio`
- `_marcoDoCompromisso(c, todayMs)`: T-1 / T-0 / T+1 (sem T-7..T-2 pra compromissos)
- Anti-spam por marco/email
- Push em todos os marcos, email em T-0 e T+1

## Sub-sprints (todos numa sessão)

| Bloco | Conteúdo |
|---|---|
| Schema + DB | rules + api.js + stubs + cache wrapper |
| UI principal | rota /agenda + render + modais |
| Integrações | aba processo + aba cliente + bloco dashboard |
| Backend | cron + integração unificada |
| Tests + bump | v6.25.0 |

## Pré-requisitos operacionais

- Eduardo precisa fazer:
  1. `firebase deploy --only firestore:rules` (em CMD) — autoriza coleção
  2. Após cron deployado: novo `Lembretes.gs` colado no Apps Script

Cron unificado já está atualizado (Sprint A.5), só vai ganhar mais uma chamada interna.
