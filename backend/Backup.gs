/**
 * Backup.gs — UC Jurídico v6.28+ (Sprint Backup)
 *
 * Backup semanal automático de todas as coleções Firestore para o Drive
 * do escritório. Reusa helpers _firestoreList / _getGoogleAccessToken do
 * Lembretes.gs (mesmo projeto Apps Script = escopo global compartilhado).
 *
 * Pré-requisitos (Script Properties):
 *   - FCM_SERVICE_ACCOUNT_JSON  → já configurado pra Lembretes
 *   - BACKUP_DRIVE_FOLDER_ID    → ID da pasta Drive onde salvar (criar
 *                                  pasta privada do escritório)
 *
 * Trigger time-driven recomendado:
 *   - Função: cron_backupSemanal
 *   - Frequência: semanal (todo domingo, 03:00)
 *
 * Funções de teste:
 *   _testarBackupConfig()  — valida pasta Drive + access token
 *   executarBackupAgora()  — roda sem trigger (use no console)
 */

// Lista cravada das coleções a fazer backup. Adicionar aqui quando
// criar nova coleção em firestore.rules.
const COLECOES_BACKUP = [
  'users',
  'audit',
  'clientes',
  'processos',
  'prazos',
  'eventos',
  'notas',
  'jurisprudencia',
  'djen',
  'settings',
  'bancos',
  'cartoes',
  'categorias_fin',
  'transacoes',
  'recorrencias',
  'honorarios',
  'comunicacoes',
  'compromissos',
  'peticao_modelos'
];

// Quantos backups manter na pasta. Os mais antigos são apagados.
const BACKUP_KEEP = 12;  // ~3 meses semanais

/**
 * Cron principal — varre todas as coleções, faz bundle JSON, salva no
 * Drive, rotaciona, registra metadata em settings/lastBackup.
 */
function cron_backupSemanal() {
  Logger.log('=== cron_backupSemanal iniciando ===');
  const startMs = Date.now();
  const folderId = PropertiesService.getScriptProperties().getProperty('BACKUP_DRIVE_FOLDER_ID');
  if (!folderId) {
    Logger.log('❌ BACKUP_DRIVE_FOLDER_ID não está em Script Properties — abortando.');
    return { ok: false, error: 'BACKUP_DRIVE_FOLDER_ID ausente' };
  }

  // 1) Bundle de todas as coleções
  let bundle, totals;
  try {
    const r = _bundleAllCollections();
    bundle = r.bundle;
    totals = r.totals;
  } catch (e) {
    Logger.log('❌ Falha ao montar bundle: ' + e.message);
    return { ok: false, error: 'bundle: ' + e.message };
  }

  const totalDocs = Object.values(totals).reduce((s, n) => s + n, 0);
  Logger.log('Bundle pronto: ' + totalDocs + ' docs em ' + Object.keys(totals).length + ' coleções');

  // 2) Salva no Drive
  const now = new Date();
  const stamp = Utilities.formatDate(now, 'America/Sao_Paulo', 'yyyy-MM-dd_HHmm');
  const filename = 'uc-juridico-backup_' + stamp + '.json';
  const json = JSON.stringify(bundle, null, 0);  // sem indent pra reduzir tamanho

  let file;
  try {
    file = _salvarBackupNoDrive(json, filename, folderId);
  } catch (e) {
    Logger.log('❌ Falha ao salvar Drive: ' + e.message);
    return { ok: false, error: 'drive: ' + e.message };
  }

  // 3) Rotacionar backups antigos
  let removidos = 0;
  try { removidos = _rotacionarBackups(folderId, BACKUP_KEEP); }
  catch (e) { Logger.log('rotação falhou (não-fatal): ' + e.message); }

  // 4) Atualiza settings/lastBackup pra UI mostrar
  const elapsed = Date.now() - startMs;
  const meta = {
    timestamp: now.getTime(),
    iso: now.toISOString(),
    fileName: filename,
    fileId: file.getId(),
    fileUrl: file.getUrl(),
    sizeBytes: json.length,
    totals,
    totalDocs,
    duration_ms: elapsed,
    removidosNaRotacao: removidos
  };
  try {
    _firestoreUpdate('settings/lastBackup', { value: meta, updatedAt: Date.now() });
  } catch (e) {
    Logger.log('settings/lastBackup update falhou (não-fatal): ' + e.message);
  }

  Logger.log('✓ Backup concluído em ' + elapsed + 'ms · ' + (json.length/1024).toFixed(1) + ' KB · ' + totalDocs + ' docs · file ' + file.getId());
  return { ok: true, ...meta };
}

/**
 * Trigger manual — use no editor pra testar ou rodar sob demanda.
 */
function executarBackupAgora() {
  return cron_backupSemanal();
}

/**
 * Lê todas as coleções via Firestore REST e monta um objeto:
 * {
 *   metadata: { timestamp, iso, version, totalDocs, ... },
 *   collections: { 'processos': { docId: {...}, ... }, ... }
 * }
 */
function _bundleAllCollections() {
  const totals = {};
  const collections = {};

  for (const col of COLECOES_BACKUP) {
    try {
      const docs = _firestoreList(col);
      const map = {};
      for (const d of docs) {
        const docId = d._docId || d.id;
        if (!docId) continue;
        // Cópia rasa sem _docId (é interno)
        const copy = Object.assign({}, d);
        delete copy._docId;
        map[docId] = copy;
      }
      collections[col] = map;
      totals[col] = docs.length;
    } catch (e) {
      Logger.log('Coleção ' + col + ' falhou: ' + e.message + ' (seguindo sem ela)');
      totals[col] = 0;
      collections[col] = {};
    }
  }

  const now = new Date();
  const bundle = {
    metadata: {
      timestamp: now.getTime(),
      iso: now.toISOString(),
      escritorio: 'UC',
      schemaVersion: 1,
      sourceProject: FCM_PROJECT_ID,
      totalDocs: Object.values(totals).reduce((s, n) => s + n, 0),
      collections: Object.keys(totals)
    },
    collections
  };

  return { bundle, totals };
}

/**
 * Salva o JSON na pasta Drive especificada.
 */
function _salvarBackupNoDrive(jsonString, filename, folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const blob = Utilities.newBlob(jsonString, 'application/json', filename);
  return folder.createFile(blob);
}

/**
 * Mantém apenas os N backups mais recentes na pasta. Filtra por prefixo
 * `uc-juridico-backup_` pra não apagar arquivos manuais ou de outras
 * fontes que estejam na mesma pasta.
 *
 * Retorna o número de arquivos apagados.
 */
function _rotacionarBackups(folderId, keep) {
  const folder = DriveApp.getFolderById(folderId);
  const it = folder.getFiles();
  const candidatos = [];
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('uc-juridico-backup_') === 0) {
      candidatos.push({ id: f.getId(), name: f.getName(), createdAt: f.getDateCreated().getTime(), file: f });
    }
  }
  candidatos.sort((a, b) => b.createdAt - a.createdAt);  // mais recentes primeiro
  const aRemover = candidatos.slice(keep);
  let removidos = 0;
  for (const c of aRemover) {
    try {
      c.file.setTrashed(true);
      removidos++;
      Logger.log('Backup removido (rotação): ' + c.name);
    } catch (e) {
      Logger.log('Falha ao apagar ' + c.name + ': ' + e.message);
    }
  }
  return removidos;
}

/**
 * Validação de configuração — roda no editor pra confirmar que está tudo
 * pronto antes do primeiro cron.
 */
function _testarBackupConfig() {
  const folderId = PropertiesService.getScriptProperties().getProperty('BACKUP_DRIVE_FOLDER_ID');
  if (!folderId) {
    Logger.log('❌ BACKUP_DRIVE_FOLDER_ID não definido em Script Properties');
    return;
  }
  Logger.log('BACKUP_DRIVE_FOLDER_ID: ' + folderId);

  try {
    const folder = DriveApp.getFolderById(folderId);
    Logger.log('✓ Pasta Drive acessível: "' + folder.getName() + '"');
    Logger.log('  URL: ' + folder.getUrl());
  } catch (e) {
    Logger.log('❌ Pasta Drive não acessível: ' + e.message);
    return;
  }

  try {
    const t = _getGoogleAccessToken();
    Logger.log('✓ Access token Firestore OK · length ' + t.length);
  } catch (e) {
    Logger.log('❌ Access token Firestore: ' + e.message);
    return;
  }

  // Lista 1 doc de cada coleção pra validar leitura
  let totalSamples = 0;
  for (const col of COLECOES_BACKUP) {
    try {
      const docs = _firestoreList(col);
      Logger.log('  ' + col + ': ' + docs.length + ' doc(s)');
      totalSamples += docs.length;
    } catch (e) {
      Logger.log('  ' + col + ': ❌ ' + e.message);
    }
  }
  Logger.log('Total estimado em backup: ' + totalSamples + ' docs');
  Logger.log('---');
  Logger.log('Tudo OK. Pode criar trigger time-driven semanal em cron_backupSemanal.');
}

/**
 * Inspeção rápida: lista os arquivos de backup atualmente na pasta.
 */
function _listarBackupsExistentes() {
  const folderId = PropertiesService.getScriptProperties().getProperty('BACKUP_DRIVE_FOLDER_ID');
  if (!folderId) { Logger.log('BACKUP_DRIVE_FOLDER_ID não definido'); return; }
  const folder = DriveApp.getFolderById(folderId);
  const it = folder.getFiles();
  const arr = [];
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('uc-juridico-backup_') === 0) {
      arr.push({
        nome: f.getName(),
        id: f.getId(),
        criado: f.getDateCreated().toISOString(),
        sizeKB: (f.getSize() / 1024).toFixed(1)
      });
    }
  }
  arr.sort((a, b) => b.criado.localeCompare(a.criado));
  Logger.log(JSON.stringify(arr, null, 2));
  Logger.log('Total: ' + arr.length + ' arquivos · keep=' + BACKUP_KEEP);
}
