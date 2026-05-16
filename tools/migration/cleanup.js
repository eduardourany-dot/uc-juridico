#!/usr/bin/env node
/**
 * Cleanup dos docs importados via migration:astrea.
 *
 * Deleta SÓ docs com updatedBy === 'migration:astrea' em /clientes e
 * /processos. Não toca em docs que outros users criaram ou editaram
 * (mesmo que tenham sido importados originalmente).
 *
 * Uso:
 *   node cleanup.js --project staging --dry-run  (conta sem deletar)
 *   node cleanup.js --project staging --confirm  (deleta de verdade)
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECTS = {
  staging: { projectId: 'uc-juridico-staging' },
  prod:    { projectId: 'uc-juridico' }
};

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  return args[i + 1] || fallback;
}
function flag(name) { return args.includes(name); }

const project = arg('--project', '');
const dryRun = flag('--dry-run');
const confirm = flag('--confirm');

if (!project || !PROJECTS[project]) {
  console.error('Uso: node cleanup.js --project staging|prod [--dry-run | --confirm]');
  process.exit(1);
}
if (!dryRun && !confirm) {
  console.error('⚠ Pra deletar de verdade, adicione --confirm');
  console.error('  Pra só contar sem deletar: --dry-run');
  process.exit(1);
}

const saPath = path.join(__dirname, 'service-account.json');
if (!fs.existsSync(saPath)) {
  console.error(`service-account.json não encontrado em ${saPath}`);
  process.exit(1);
}
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
if (sa.project_id !== PROJECTS[project].projectId) {
  console.error(`⚠ Service account é "${sa.project_id}", mas --project pede "${PROJECTS[project].projectId}"`);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

console.log(`[cleanup] projeto: ${sa.project_id}`);
console.log(`[cleanup] modo: ${dryRun ? 'DRY-RUN' : 'DELETE'}`);
console.log('');

async function cleanupCollection(name) {
  const snap = await db.collection(name)
    .where('updatedBy', '==', 'migration:astrea')
    .get();

  if (snap.empty) {
    console.log(`[cleanup] ${name}: 0 docs com updatedBy=migration:astrea`);
    return 0;
  }
  console.log(`[cleanup] ${name}: ${snap.size} docs encontrados`);

  if (dryRun) {
    // Mostra exemplo
    const first = snap.docs[0].data();
    console.log(`  Exemplo: id=${snap.docs[0].id} importadoDe=${first.importadoDe || '?'} nome/name=${first.nome || first.name || '?'}`);
    return snap.size;
  }

  // Delete em batches de 400 (Firestore limit: 500)
  const BATCH = 400;
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const batch = db.batch();
    for (const d of chunk) batch.delete(d.ref);
    await batch.commit();
    deleted += chunk.length;
    process.stdout.write(`\r  ${deleted}/${docs.length} deletados...`);
  }
  console.log(`\r  ✓ ${deleted}/${docs.length} deletados                    `);
  return deleted;
}

async function main() {
  const t0 = Date.now();
  try {
    const c1 = await cleanupCollection('clientes');
    const c2 = await cleanupCollection('processos');
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('');
    console.log(`✓ Done em ${elapsed}s`);
    console.log(`  Total: ${c1} clientes + ${c2} processos ${dryRun ? '(seriam deletados)' : 'deletados'}`);
    if (dryRun) console.log(`  Pra deletar de verdade: rode com --confirm`);
  } catch (e) {
    console.error('Erro:', e.message || e);
    process.exit(2);
  }
}

main();
