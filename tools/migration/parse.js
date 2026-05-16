#!/usr/bin/env node
/**
 * Astrea CSV → UC Jurídico JSON
 *
 * Lê os CSVs do backup do Astrea e gera JSONs estruturados prontos
 * pra serem importados via upload.js.
 *
 * Uso:
 *   1. Coloque os CSVs em tools/migration/input/
 *   2. cd tools/migration && npm install
 *   3. node parse.js
 *   4. JSONs gerados em tools/migration/output/
 *
 * Não toca em nenhum banco — só lê CSV e escreve JSON local.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const INPUT_DIR = path.join(__dirname, 'input');
const OUTPUT_DIR = path.join(__dirname, 'output');

function log(msg) { console.log(`[parse] ${msg}`); }
function warn(msg) { console.warn(`[parse] ⚠ ${msg}`); }

// ============================================================
// CSV loader — usa csv-parse pra lidar com aspas, multi-line, etc.
// ============================================================
function loadCsv(filename) {
  const fullPath = path.join(INPUT_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    warn(`arquivo não encontrado: ${filename} — pulando`);
    return [];
  }
  const raw = fs.readFileSync(fullPath, 'utf8');
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true
  });
  log(`${filename}: ${rows.length} linhas`);
  return rows;
}

// ============================================================
// Helpers
// ============================================================
function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);
}

function parseValor(s) {
  if (!s) return null;
  // Astrea usa "109394.02" (ponto decimal) ou "109.394,02" (BR)
  const cleaned = String(s).replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  // Se tem vírgula como decimal (formato BR): 109.394,02
  if (/,\d{1,2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  // Senão, ponto decimal direto: 109394.02
  return parseFloat(cleaned);
}

function parseData(s) {
  if (!s) return null;
  // Astrea: "06/12/2021 09:00" → ISO
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return s; // devolve como está se não match (deixa pro human revisar)
  const [, d, mo, y, h = '00', mi = '00', sc = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${sc}`;
}

function normalizeCnj(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/\D/g, '');
  if (d.length !== 20) return String(raw); // devolve cru se inválido
  return `${d.slice(0,7)}-${d.slice(7,9)}.${d.slice(9,13)}.${d.slice(13,14)}.${d.slice(14,16)}.${d.slice(16,20)}`;
}

function cleanStr(s) {
  if (s == null) return '';
  return String(s).trim();
}

// ============================================================
// PARSE: Usuário.csv → mapa de advogados
// ============================================================
function parseUsuarios() {
  const rows = loadCsv('Usuário.csv');
  const map = {};
  for (const r of rows) {
    const id = cleanStr(r['Código']);
    if (!id) continue;
    map[id] = {
      id,
      apelido: cleanStr(r['Apelido']),
      login: cleanStr(r['Login']),
      contatoId: cleanStr(r['Contato']),
      status: cleanStr(r['Status']),
      perfil: cleanStr(r['Perfil']),
      adminFinanceiro: cleanStr(r['Acesso financeiro']) === 'Sim'
    };
  }
  log(`usuários mapeados: ${Object.keys(map).length}`);
  return map;
}

// ============================================================
// PARSE: Ações.csv → mapa de tipos de ação
// ============================================================
function parseAcoes() {
  const rows = loadCsv('Ações.csv');
  const map = {};
  for (const r of rows) {
    const id = cleanStr(r['Código']);
    if (!id) continue;
    map[id] = cleanStr(r['Nome']);
  }
  log(`tipos de ação mapeados: ${Object.keys(map).length}`);
  return map;
}

// ============================================================
// PARSE: Contatos.csv → CRM clientes
// ============================================================
// Schema UC clientes:
//   id, nome, tipo (PF/PJ), doc (CPF ou CNPJ), email, telefone,
//   endereco { rua, numero, complemento, bairro, cidade, estado, cep },
//   nascimento (ISO), profissao, rg, estadoCivil,
//   importadoDe (legacy id pra reconciliação), criadoEm
function parseContatos() {
  const rows = loadCsv('Contatos.csv');
  const map = {};

  for (const r of rows) {
    const legacyId = cleanStr(r['Código']);
    if (!legacyId) continue;

    const nome = cleanStr(r['Nome']);
    if (!nome) continue;

    const tipoRaw = cleanStr(r['Tipo do contato']).toLowerCase();
    // Astrea usa "Pessoa Física" e "Pessoa Jurídica" literais.
    // Acentos e variações ("juridica") cobertos pelo strip de acentos.
    const tipoNorm = tipoRaw.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tipo = tipoNorm.includes('juridica') || tipoNorm.includes('pj') ? 'PJ' : 'PF';

    // Endereço (Astrea separa em colunas distintas)
    const endereco = {
      rua: cleanStr(r['Ruas']),
      numero: cleanStr(r['Números']),
      complemento: cleanStr(r['Complementos']),
      bairro: cleanStr(r['Bairros']),
      cidade: cleanStr(r['Cidades']),
      estado: cleanStr(r['Estados']),
      cep: cleanStr(r['CEP'])
    };
    const enderecoVazio = Object.values(endereco).every(v => !v);

    // Nascimento (3 campos: Dia, Mês, Ano)
    let nascimento = null;
    const ny = cleanStr(r['Ano de nascimento']);
    const nm = cleanStr(r['Mês de nascimento']);
    const nd = cleanStr(r['Dia de nascimento']);
    if (ny && nm && nd) {
      nascimento = `${ny}-${nm.padStart(2, '0')}-${nd.padStart(2, '0')}`;
    }

    const id = uid('cli_');
    map[legacyId] = {
      id,
      nome: nome.toUpperCase(),
      tipo,
      doc: cleanStr(r['CPF']),
      email: cleanStr(r['Endereços de email']),
      telefone: cleanStr(r['Número dos telefones']),
      endereco: enderecoVazio ? null : endereco,
      profissao: cleanStr(r['Ocupação']),
      rg: cleanStr(r['RG']),
      estadoCivil: cleanStr(r['Estado civil']),
      nacionalidade: cleanStr(r['Nacionalidade']),
      naturalidade: cleanStr(r['Naturalidade']),
      nascimento,
      observacao: cleanStr(r['Comentário']),
      importadoDe: 'astrea:' + legacyId,
      escritorio_id: 'UC',
      deletedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      updatedBy: 'migration:astrea'
    };
  }
  log(`contatos parseados: ${Object.keys(map).length}`);
  return map;
}

// ============================================================
// PARSE: Processos.csv → processos UC
// ============================================================
// Schema UC processos:
//   id, name, cnj, court, valorCausa, dataDistribuicao, status, area,
//   clienteId (principal), clienteIds[], advogadoResponsavel (nome),
//   advogadoSuplente, partes[], polo, fase, type, description,
//   importadoDe, escritorio_id, deletedAt, createdAt, updatedAt
function parseProcessos(usuariosMap, acoesMap, contatosMap) {
  const rows = loadCsv('Processos.csv');
  const out = [];
  const stats = { total: 0, sCnj: 0, cCnj: 0, sCliente: 0 };

  for (const r of rows) {
    stats.total++;
    const legacyId = cleanStr(r['Código']);
    if (!legacyId) continue;

    const cnjRaw = cleanStr(r['Número do processo']);
    const cnj = cnjRaw ? normalizeCnj(cnjRaw) : '';
    if (cnj) stats.cCnj++; else stats.sCnj++;

    const tituloRaw = cleanStr(r['Titulo']);
    const valor = parseValor(r['Valor']);
    const dataDistribuicao = parseData(r['Data de distribuição']);
    const dataCriacao = parseData(r['Data de criação']);
    const ultimaMov = parseData(r['Última movimentação']);
    const statusRaw = cleanStr(r['Status']).toLowerCase();
    const status = statusRaw === 'ativo' ? 'active'
                 : statusRaw === 'arquivado' ? 'archived'
                 : 'active';

    // Astrea separa múltiplos IDs por `;` (espaço opcional)
    const splitIds = s => cleanStr(s).split(/\s*;\s*/).filter(Boolean);

    // Resolve clientes (pode ter múltiplos — split por `;`)
    const clientesIdsLegacy = splitIds(r['Clientes']);
    const clientesResolvidos = clientesIdsLegacy
      .map(lid => ({ lid, c: contatosMap[lid] }))
      .filter(({ lid, c }) => {
        if (!c) {
          warn(`processo ${legacyId} (CNJ ${cnj || '?'}) referencia cliente ${lid} não encontrado em Contatos`);
          return false;
        }
        return true;
      })
      .map(({ c }) => c);
    const cliente = clientesResolvidos[0] || null;  // principal = primeiro
    if (!cliente) stats.sCliente++;

    // Partes adversas (pode ter múltiplas — split por `;`)
    const partesIdsLegacy = splitIds(r['Contatos das partes']);
    const partesAdvResolvidas = partesIdsLegacy
      .map(lid => contatosMap[lid])
      .filter(Boolean);

    // Advogado responsável (FK pra Usuário)
    const respLegacy = cleanStr(r['Responsável']);
    const respUser = respLegacy ? usuariosMap[respLegacy] : null;
    const advogadoResponsavel = respUser ? respUser.apelido : '';

    // Tipo de ação
    const tipoAcaoLegacy = cleanStr(r['Tipo de ação']);
    const tipoAcao = tipoAcaoLegacy ? acoesMap[tipoAcaoLegacy] : '';

    // partes[] — formato UC: array de { nome, cpfCnpj, polo, advogados[] }
    // Todos os clientes vão como polo ativo, todas as partes adversas como passivo.
    const partes = [];
    for (const c of clientesResolvidos) {
      partes.push({
        nome: c.nome,
        cpfCnpj: c.doc,
        polo: 'AT',
        advogados: respUser ? [{ nome: respUser.apelido, oab: '' }] : []
      });
    }
    for (const pa of partesAdvResolvidas) {
      partes.push({
        nome: pa.nome.toUpperCase(),
        cpfCnpj: pa.doc,
        polo: 'PA',
        advogados: []
      });
    }

    out.push({
      id: uid('proc_'),
      name: tituloRaw,
      cnj,
      court: cleanStr(r['Nome da Vara']),
      court_numero: cleanStr(r['Número da Vara']),
      valorCausa: valor,
      dataDistribuicao,
      ultimaMovimentacao: ultimaMov,
      status,
      type: tipoAcao,
      advogadoResponsavel,
      clienteId: cliente?.id || null,
      clienteIds: clientesResolvidos.map(c => c.id),
      partes,
      polo: 'AT',  // assume cliente é ativo
      description: cleanStr(r['Descrição']),
      observacao: cleanStr(r['Observação']),
      pasta: cleanStr(r['Pasta']),
      etiquetas: cleanStr(r['Etiquetas']),
      eventCount: 0,
      noteCount: 0,
      importadoDe: 'astrea:' + legacyId,
      escritorio_id: 'UC',
      deletedAt: null,
      createdAt: dataCriacao ? new Date(dataCriacao).getTime() : Date.now(),
      updatedAt: Date.now(),
      updatedBy: 'migration:astrea'
    });
  }

  log(`processos parseados: ${out.length} (com CNJ: ${stats.cCnj}, sem CNJ: ${stats.sCnj}, sem cliente: ${stats.sCliente})`);
  return out;
}

// ============================================================
// Main
// ============================================================
function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Pasta input não existe: ${INPUT_DIR}`);
    console.error(`Copie os CSVs do backup do Astrea pra essa pasta antes.`);
    process.exit(1);
  }
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  log('=== iniciando parse ===');
  const usuarios = parseUsuarios();
  const acoes = parseAcoes();
  const contatos = parseContatos();
  const processos = parseProcessos(usuarios, acoes, contatos);

  // Filtra clientes pra incluir só os referenciados em processos (evita
  // poluir o banco com 2600 contatos quando só ~600 são clientes reais)
  const idsRef = new Set();
  for (const p of processos) {
    if (p.clienteId) idsRef.add(p.clienteId);
    for (const cid of (p.clienteIds || [])) idsRef.add(cid);
  }
  const clientesReferenciados = Object.values(contatos).filter(c => idsRef.has(c.id));
  log(`clientes filtrados (referenciados em processos): ${clientesReferenciados.length} / ${Object.keys(contatos).length}`);

  // Outputs
  const out = {
    timestamp: new Date().toISOString(),
    source: 'astrea-csv-backup',
    counts: {
      usuarios: Object.keys(usuarios).length,
      contatosTotal: Object.keys(contatos).length,
      clientesReferenciados: clientesReferenciados.length,
      processos: processos.length
    },
    clientes: clientesReferenciados,
    processos
  };

  const outPath = path.join(OUTPUT_DIR, 'migration.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`✓ JSON gerado: ${outPath}`);
  log(`  Tamanho: ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);

  // Resumo
  console.log('');
  console.log('Resumo:');
  console.log(`  Clientes a importar:  ${clientesReferenciados.length}`);
  console.log(`  Processos a importar: ${processos.length}`);
  console.log('');
  console.log('Próximo: revisa o JSON em output/migration.json. Se OK, roda:');
  console.log('  npm run upload:staging');
}

main();
