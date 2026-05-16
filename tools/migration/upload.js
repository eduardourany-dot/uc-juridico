#!/usr/bin/env node
/**
 * Upload do JSON parseado pro Firestore via firebase-admin.
 *
 * Uso:
 *   1. Baixe a service account JSON do Firebase Console:
 *      uc-juridico-staging → Project settings → Service accounts →
 *      Generate new private key
 *   2. Salve como tools/migration/service-account.json (gitignored)
 *   3. cd tools/migration && npm install
 *   4. node parse.js (gera output/migration.json)
 *   5. node upload.js --project staging
 *
 * Flags:
 *   --project staging | prod   (obrigatório)
 *   --dry-run                  (não escreve, só conta)
 *   --only clientes | processos (pula a outra entidade)
 *   --limit N                  (importa só N de cada coleção — útil pra teste)
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECTS = {
  staging: { projectId: 'uc-juridico-staging' },
  prod:    { projectId: 'uc-juridico' }
};

// Parse CLI args
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  return args[i + 1] || fallback;
}
function flag(name) { return args.includes(name); }

const project = arg('--project', '');
const dryRun = flag('--dry-run');
const only = arg('--only', '');
const limit = parseInt(arg('--limit', '0'), 10) || 0;

if (!project || !PROJECTS[project]) {
  console.error('Uso: node upload.js --project staging|prod [--dry-run] [--only clientes|processos] [--limit N]');
  process.exit(1);
}

const saPath = path.join(__dirname, 'service-account.json');
if (!fs.existsSync(saPath)) {
  console.error(`Service account não encontrado: ${saPath}`);
  console.error(`Baixe em Firebase Console → Project settings → Service accounts → Generate new private key`);
  console.error(`Salve como tools/migration/service-account.json (já está no .gitignore)`);
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
if (sa.project_id !== PROJECTS[project].projectId) {
  console.error(`⚠ Service account é do projeto "${sa.project_id}" mas você pediu "${PROJECTS[project].projectId}"`);
  console.error(`Baixe a service account correta ou rode com --project ${sa.project_id === 'uc-juridico' ? 'prod' : 'staging'}`);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

console.log(`[upload] projeto: ${sa.project_id}`);
console.log(`[upload] dry-run: ${dryRun}`);
if (only) console.log(`[upload] only: ${only}`);
if (limit) console.log(`[upload] limit: ${limit}`);

// Carrega JSON do parse
const jsonPath = path.join(__dirname, 'output', 'migration.json');
if (!fs.existsSync(jsonPath)) {
  console.error(`JSON não encontrado: ${jsonPath}. Roda 'node parse.js' antes.`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
console.log(`[upload] carregado: ${data.counts.clientesReferenciados} clientes + ${data.counts.processos} processos`);
console.log('');

async function uploadCollection(collectionName, docs, idField = 'id') {
  if (!docs.length) {
    console.log(`[upload] ${collectionName}: vazio, pulando`);
    return;
  }
  const slice = limit > 0 ? docs.slice(0, limit) : docs;
  console.log(`[upload] ${collectionName}: ${slice.length} docs ${dryRun ? '(DRY)' : ''}`);

  if (dryRun) {
    // Mostra exemplo do primeiro doc
    console.log(`  Exemplo:`, JSON.stringify(slice[0], null, 2).slice(0, 500), '...');
    return;
  }

  // Firestore batch limit: 500 ops por batch
  const BATCH = 400;
  let written = 0;
  for (let i = 0; i < slice.length; i += BATCH) {
    const chunk = slice.slice(i, i + BATCH);
    const batch = db.batch();
    for (const d of chunk) {
      const id = d[idField];
      if (!id) {
        console.warn(`  skip doc sem ${idField}:`, JSON.stringify(d).slice(0, 100));
        continue;
      }
      batch.set(db.collection(collectionName).doc(String(id)), d);
    }
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`\r  ${written}/${slice.length} escritos...`);
  }
  console.log(`\r  ✓ ${written}/${slice.length} escritos                    `);
}

async function main() {
  const t0 = Date.now();
  try {
    if (!only || only === 'clientes') {
      await uploadCollection('clientes', data.clientes || []);
    }
    if (!only || only === 'processos') {
      await uploadCollection('processos', data.processos || []);
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('');
    console.log(`✓ Done em ${elapsed}s`);
  } catch (e) {
    console.error('Erro durante upload:', e);
    process.exit(2);
  }
}

main();
