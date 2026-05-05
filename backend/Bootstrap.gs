/**
 * Bootstrap.gs — roda UMA VEZ no editor do Apps Script.
 *
 * O que faz:
 *   1) Cria a Spreadsheet "UC Jurídico — DB" (ou usa uma que você já tem)
 *   2) Cria todas as abas com cabeçalhos
 *   3) Cria a pasta "UC Jurídico — PDFs" no Drive
 *   4) Salva os IDs em PropertiesService (assim Codigo.gs lê de lá)
 *   5) Adiciona o seu email como primeiro usuário admin ativo
 *
 * Como usar:
 *   - Cole este arquivo + Codigo.gs no editor (script.google.com)
 *   - Edite a constante OAUTH_CLIENT_ID abaixo (você obtém depois no Google Cloud Console)
 *   - Selecione a função "bootstrap" e clique em ▶ Executar
 *   - Conceda as permissões pedidas
 *   - Copie o output do Logs (ID da planilha, ID da pasta)
 */

// ============================================================
// CONFIGURE AQUI ANTES DE RODAR
// ============================================================
//
// Se já tiver criado a Spreadsheet manualmente, cole o ID aqui.
// Se deixar vazio, o bootstrap cria uma nova.
const EXISTING_SPREADSHEET_ID = '';

// Se já tiver criado a pasta de PDFs, cole o ID aqui.
// Se deixar vazio, o bootstrap cria uma nova.
const EXISTING_DRIVE_FOLDER_ID = '';

// Cole aqui depois que criar o OAuth Client ID no Google Cloud Console.
// Pode deixar vazio agora e setar via setOAuthClientId() depois.
const OAUTH_CLIENT_ID = '';

// ============================================================

const SHEET_SPECS = {
  Processos: ['id', 'status', 'updatedAt', 'deletedAt', 'createdAt', 'updatedBy', 'data'],
  Prazos:    ['id', 'processId', 'status', 'deadlineDate', 'updatedAt', 'deletedAt', 'createdAt', 'updatedBy', 'data'],
  Eventos:   ['id', 'processId', 'updatedAt', 'deletedAt', 'createdAt', 'updatedBy', 'data'],
  Notas:     ['id', 'processId', 'updatedAt', 'deletedAt', 'createdAt', 'updatedBy', 'data'],
  Jurisprudencia: ['id', 'processId', 'updatedAt', 'deletedAt', 'createdAt', 'updatedBy', 'data'],
  DJEN:      ['hash', 'cnj', 'processId', 'status', 'dataDisponibilizacao', 'importedAt', 'updatedAt', 'deletedAt', 'createdAt', 'updatedBy', 'data'],
  Settings:  ['chave', 'updatedAt', 'updatedBy', 'data'],
  Usuarios:  ['email', 'nome', 'role', 'ativo', 'criadoEm'],
  Auditoria: ['id', 'timestamp', 'userEmail', 'action', 'entity', 'entityId', 'payload']
};

function bootstrap() {
  const props = PropertiesService.getScriptProperties();
  const ownerEmail = Session.getEffectiveUser().getEmail();

  // 1) Spreadsheet
  let ss;
  if (EXISTING_SPREADSHEET_ID) {
    ss = SpreadsheetApp.openById(EXISTING_SPREADSHEET_ID);
    Logger.log('Usando Spreadsheet existente: ' + ss.getUrl());
  } else {
    ss = SpreadsheetApp.create('UC Jurídico — DB');
    Logger.log('Criou Spreadsheet: ' + ss.getUrl());
  }
  props.setProperty('SPREADSHEET_ID', ss.getId());

  // 2) Abas + cabeçalhos
  for (const [name, headers] of Object.entries(SHEET_SPECS)) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
    }
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // Sanity: cabeçalho atual confere?
    const current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    const mismatch = headers.some((h, i) => current[i] !== h);
    if (mismatch) {
      Logger.log('AVISO: cabeçalho da aba ' + name + ' diverge do esperado. Atual=' + JSON.stringify(current));
    }
  }

  // Remove a aba "Sheet1" / "Página1" padrão se existir e estiver vazia
  const defaults = ['Sheet1', 'Página1', 'Página 1'];
  defaults.forEach(function(n){
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() <= 1 && !SHEET_SPECS[n]) {
      ss.deleteSheet(sh);
    }
  });

  // 3) Drive folder para PDFs
  let folder;
  if (EXISTING_DRIVE_FOLDER_ID) {
    folder = DriveApp.getFolderById(EXISTING_DRIVE_FOLDER_ID);
    Logger.log('Usando pasta existente: ' + folder.getUrl());
  } else {
    folder = DriveApp.createFolder('UC Jurídico — PDFs');
    Logger.log('Criou pasta: ' + folder.getUrl());
  }
  props.setProperty('DRIVE_FOLDER_ID', folder.getId());

  // 4) OAuth Client ID
  if (OAUTH_CLIENT_ID) {
    props.setProperty('OAUTH_CLIENT_ID', OAUTH_CLIENT_ID);
    Logger.log('OAUTH_CLIENT_ID gravado.');
  } else {
    Logger.log('OAUTH_CLIENT_ID NÃO definido — chame setOAuthClientId("xxx.apps.googleusercontent.com") depois.');
  }

  // 5) Adiciona o owner como primeiro admin
  const usuarios = ss.getSheetByName('Usuarios');
  const existing = usuarios.getRange(2, 1, Math.max(1, usuarios.getLastRow() - 1), 1).getValues().flat();
  if (!existing.includes(ownerEmail)) {
    usuarios.appendRow([ownerEmail, 'Owner', 'admin', true, new Date().toISOString()]);
    Logger.log('Adicionou ' + ownerEmail + ' como admin.');
  }

  Logger.log('───────────────────────────────────────');
  Logger.log('SPREADSHEET_ID  = ' + ss.getId());
  Logger.log('DRIVE_FOLDER_ID = ' + folder.getId());
  Logger.log('OWNER_EMAIL     = ' + ownerEmail);
  Logger.log('Spreadsheet URL = ' + ss.getUrl());
  Logger.log('Folder URL      = ' + folder.getUrl());
  Logger.log('───────────────────────────────────────');
  Logger.log('Próximo passo: Deploy → New deployment → Web app');
}

function setOAuthClientId(clientId) {
  PropertiesService.getScriptProperties().setProperty('OAUTH_CLIENT_ID', clientId);
  Logger.log('OAUTH_CLIENT_ID gravado: ' + clientId);
}

function setSpreadsheetId(id) {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  Logger.log('SPREADSHEET_ID gravado: ' + id);
}

function setDriveFolderId(id) {
  PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ID', id);
  Logger.log('DRIVE_FOLDER_ID gravado: ' + id);
}

function showProperties() {
  const p = PropertiesService.getScriptProperties().getProperties();
  Logger.log(JSON.stringify(p, null, 2));
}

function addUsuario(email, nome, role) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  const sh = ss.getSheetByName('Usuarios');
  const existing = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues().flat();
  if (existing.includes(email)) {
    Logger.log('Usuario já existe: ' + email);
    return;
  }
  sh.appendRow([email, nome || '', role || 'user', true, new Date().toISOString()]);
  Logger.log('Adicionado: ' + email);
}
