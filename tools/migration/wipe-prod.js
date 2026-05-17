#!/usr/bin/env node
/**
 * Wipe TOTAL do Firestore de produção (uc-juridico).
 *
 * Deleta TUDO exceto:
 *   - /usuarios     → allowlist de quem pode logar no app
 *   - /settings     → configurações globais do escritório
 *
 * IMPORTANTE: usa recursiveDelete do Admin SDK, que apaga subcollections também.
 *
 * Uso:
 *   node wipe-prod.js --project prod --dry-run
 *   node wipe-prod.js --project prod --confirm-prod-wipe
 *
 * O script EXIGE digitar 'DELETE EVERYTHING' quando passa --confirm-prod-wipe,
 * pra evitar acidente. Sem isso só lista o que seria deletado.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const admin = require('firebase-admin');

const PROJECTS = {
  staging: { projectId: 'uc-juridico-staging' },
  prod:    { projectId: 'uc-juridico' }
};

// Coleções a PRESERVAR — não deletar essas
const PRESERVE = new Set([
  'usuarios',   // allowlist de auth (sem isso ninguém loga)
  'settings'    // configurações globais
]);

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  return args[i + 1] || fallback;
}
function flag(name) { return args.includes(name); }

const project = arg('--project', '');
const dryRun = flag('--dry-run');
const confirm = flag('--confirm-prod-wipe');

if (!project || !PROJECTS[project]) {
  console.error('Uso: node wipe-prod.js --project staging|prod [--dry-run | --confirm-prod-wipe]');
  process.exit(1);
}
if (!dryRun && !confirm) {
  console.error('⚠ Adicione --dry-run pra ver o que seria deletado.');
  console.error('   Adicione --confirm-prod-wipe pra deletar de verdade.');
  process.exit(1);
}

const saPath = path.join(__dirname, 'service-account.json');
if (!fs.existsSync(saPath)) {
  console.error(`service-account.json não encontrado em ${saPath}`);
  console.error(`Baixe a service account do projeto ${PROJECTS[project].projectId} no Firebase Console.`);
  process.exit(1);
}
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
if (sa.project_id !== PROJECTS[project].projectId) {
  console.error(`⚠ Service account é do projeto "${sa.project_id}", mas --project pede "${PROJECTS[project].projectId}"`);
  console.error(`Baixe a service account correta antes.`);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

console.log(`[wipe] projeto:  ${sa.project_id}`);
console.log(`[wipe] modo:     ${dryRun ? 'DRY-RUN (não deleta)' : 'DELETE'}`);
console.log(`[wipe] preserva: ${[...PRESERVE].join(', ')}`);
console.log('');

async function listCollections() {
  const cols = await db.listCollections();
  return cols.map(c => c.id);
}

async function countDocs(collectionName) {
  const snap = await db.collection(collectionName).count().get();
  return snap.data().count;
}

async function deleteCollection(collectionName) {
  // Admin SDK: recursiveDelete apaga doc + subcollections.
  // Não tem método "delete collection" nativo; recursiveDelete na ref da coleção funciona.
  const ref = db.collection(collectionName);
  await db.recursiveDelete(ref);
}

async function confirmPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      '\n⚠⚠⚠ ATENÇÃO ⚠⚠⚠\n' +
      'Isso vai DELETAR todas as coleções acima do projeto ' + sa.project_id + '.\n' +
      'Sem volta sem backup.\n\n' +
      'Pra confirmar, digite exatamente: DELETE EVERYTHING\n> ',
      (answer) => { rl.close(); resolve(answer.trim()); }
    );
  });
}

async function main() {
  const t0 = Date.now();
  try {
    const all = await listCollections();
    if (all.length === 0) {
      console.log('Banco vazio. Nada a fazer.');
      return;
    }

    const toDelete = all.filter(c => !PRESERVE.has(c));
    const preserved = all.filter(c => PRESERVE.has(c));

    console.log('Coleções encontradas:');
    for (const c of all) {
      const n = await countDocs(c);
      const tag = PRESERVE.has(c) ? '🔒 PRESERVAR' : '🗑  DELETAR ';
      console.log(`  ${tag}  /${c.padEnd(28)} ${n.toString().padStart(6)} docs`);
    }
    console.log('');

    if (toDelete.length === 0) {
      console.log('Nenhuma coleção pra deletar (todas estão na lista de preservação).');
      return;
    }

    if (dryRun) {
      console.log(`✓ DRY-RUN concluído. ${toDelete.length} coleção(ões) seriam deletadas.`);
      console.log(`  Pra deletar de verdade: node wipe-prod.js --project ${project} --confirm-prod-wipe`);
      return;
    }

    // Confirma com prompt
    const answer = await confirmPrompt();
    if (answer !== 'DELETE EVERYTHING') {
      console.log('❌ Confirmação não correspondeu. Abortado.');
      process.exit(1);
    }

    console.log('\n🗑  Iniciando exclusão...\n');
    for (const c of toDelete) {
      process.stdout.write(`  Deletando /${c}... `);
      const t1 = Date.now();
      await deleteCollection(c);
      console.log(`✓ (${((Date.now() - t1)/1000).toFixed(1)}s)`);
    }

    console.log('');
    console.log(`✓ Wipe completo em ${((Date.now() - t0)/1000).toFixed(1)}s`);
    console.log(`  Preservadas: ${preserved.join(', ') || '(nenhuma)'}`);
    console.log(`  Deletadas:   ${toDelete.join(', ')}`);
  } catch (e) {
    console.error('Erro:', e.message || e);
    if (e.stack) console.error(e.stack);
    process.exit(2);
  }
}

main();
