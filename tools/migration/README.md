# UC Jurídico — Migração de dados

Scripts pra importar processos + clientes do **Astrea** (backup CSV) pro Firestore do UC Jurídico.

## Fluxo

1. **Parse** CSVs locais → JSON estruturado (`output/migration.json`)
2. **Review** do JSON pra revisar mapping antes de subir
3. **Upload** pro Firestore via firebase-admin (batches de 400)

Ambos os passos são separados de propósito — você revisa o JSON antes de tocar no banco.

## Pré-requisitos

- Node.js 20+
- Service account JSON do Firebase Console (staging E/OU prod)

## Setup (uma vez)

```bash
cd tools/migration
npm install
```

## Step 1 — Parse

1. Copia os CSVs do backup pra `tools/migration/input/`. Apenas estes são lidos:
   - `Processos.csv`
   - `Contatos.csv`
   - `Usuário.csv`
   - `Ações.csv`
2. Roda o parse:

```bash
node parse.js
```

Output:
- `output/migration.json` — estrutura pronta pra upload
- Logs no stdout com contagens e warnings (ex.: processos sem cliente vinculado)

Revisa o JSON. Exemplos do que olhar:
- `counts.clientesReferenciados` — quantos clientes únicos referenciados em processos
- `counts.processos` — total de processos parseados
- Spot-check em alguns processos: `name`, `cnj`, `clienteId`, `partes[]`

## Step 2 — Service Account

1. Firebase Console → Project Settings → **Service accounts** → "Generate new private key"
2. Salva o JSON como `tools/migration/service-account.json` (gitignored)
3. **CONFIRME** que o `project_id` no JSON é o que você quer migrar:
   - `uc-juridico-staging` para teste
   - `uc-juridico` para produção

## Step 3 — Upload

### Dry-run (não escreve nada, só conta):

```bash
node upload.js --project staging --dry-run
```

### Pequeno teste (10 docs de cada):

```bash
node upload.js --project staging --limit 10
```

Vai no Firestore Console depois e verifica os docs criados em `clientes/` e `processos/`. Se tá tudo OK:

### Importação completa:

```bash
node upload.js --project staging
```

Pra produção (DEPOIS de validar em staging):

```bash
node upload.js --project prod
```

### Só uma entidade

```bash
node upload.js --project staging --only clientes
node upload.js --project staging --only processos
```

## Schema mapping

### Processos.csv (Astrea) → `processos/{id}`

| Astrea | UC |
|---|---|
| `Número do processo` | `cnj` (normalizado com máscara) |
| `Titulo` | `name` |
| `Valor` | `valorCausa` (number) |
| `Nome da Vara` | `court` |
| `Número da Vara` | `court_numero` |
| `Data de distribuição` | `dataDistribuicao` (ISO) |
| `Última movimentação` | `ultimaMovimentacao` (ISO) |
| `Status` ("Ativo"/"Arquivado") | `status` ("active"/"archived") |
| `Tipo de ação` (FK→Ações) | `type` (texto resolvido) |
| `Responsável` (FK→Usuário) | `advogadoResponsavel` (apelido) |
| `Clientes` (FK→Contatos) | `clienteId` + `clienteIds[]` (com ID UC novo) |
| `Contatos das partes` (FK→Contatos) | `partes[]` (polo PA) |
| `Descrição`, `Observação`, `Pasta`, `Etiquetas` | mesmo nome |

Campos UC adicionados: `id` (uid), `polo: 'AT'`, `eventCount: 0`, `noteCount: 0`,
`importadoDe: 'astrea:<legacyId>'`, `escritorio_id: 'UC'`,
`createdAt`, `updatedAt`, `updatedBy: 'migration:astrea'`, `deletedAt: null`.

### Contatos.csv (Astrea) → `clientes/{id}`

Apenas contatos referenciados em algum processo são importados (filtra ~2600 → ~600-1000).

| Astrea | UC |
|---|---|
| `Nome` | `nome` (uppercase) |
| `Tipo do contato` | `tipo` ("PF" ou "PJ") |
| `CPF` | `doc` |
| `Endereços de email` | `email` |
| `Número dos telefones` | `telefone` |
| `Ruas/Números/Complementos/Bairros/Cidades/Estados/CEP` | `endereco{}` |
| `Ocupação` | `profissao` |
| `RG`, `Estado civil`, `Nacionalidade`, `Naturalidade` | mesmo nome |
| `Dia/Mês/Ano de nascimento` | `nascimento` (ISO yyyy-MM-dd) |
| `Comentário` | `observacao` |

## Rollback

Se a migração der ruim em staging, pra limpar:

```bash
# Via Firebase Console: Firestore → Data → seleciona doc → Delete
# Ou via gcloud:
gcloud firestore documents delete --collection-id=processos --recursive
gcloud firestore documents delete --collection-id=clientes --recursive
```

Pra prod, NÃO faça isso sem backup. O `importadoDe: 'astrea:<id>'` permite identificar e deletar
seletivamente só os importados.

## Limitações conhecidas

- **Históricos.csv (113MB) e Publicações.csv (78MB) não migram** — DJEN já captura o que importa pra frente
- **Honorários** vazios no backup (`Honorários.csv` tem 1 linha = cabeçalho)
- **Audiências** parseável mas não migrado nesta versão (escopo: só processos + clientes)
- **OAB do advogado responsável** não vem do CSV — fica vazia, pra preencher manualmente depois
- Datas de nascimento podem vir incompletas; só são preenchidas se Dia + Mês + Ano estiverem todos presentes
