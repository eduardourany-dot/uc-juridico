// UC Jurídico — MNI Worker genérico (multi-tribunal)
// Versão: 0.3.0 · sprint MNI.1 (registry expandido)
//
// Roteia chamadas SOAP/MNI 2.2.2 pra múltiplos tribunais via registry interno.
// Parser validado contra TJGO/Projudi.
//
// Deploy:
//   dash.cloudflare.com → Workers & Pages → Create Worker
//   Nome: uc-mni
//   Colar este arquivo, Save and deploy.
// Variáveis (Settings → Variables):
//   ALLOWED_ORIGINS = http://localhost:8000,https://eduardourany-dot.github.io
//
// Endpoints (POST JSON):
//   { tribunal: "TJGO", operacao: "consultarProcesso", cnj, cpf, senha, debug?, grau? (1|2) }
//   { tribunal: "TRF1", operacao: "health" }
//   { operacao: "listarTribunais" }
//   { operacao: "detectarPorCnj", cnj: "0000000-00.0000.0.00.0000" }
//
// MUDANÇAS v0.3.0 vs v0.2.0:
//   - Registry expandido de 6 → 41 tribunais (migrado de tribunal_registry.py
//     do protótipo Python v4.3.0 + validações próprias)
//   - Suporta `endpoint2g` opcional via { grau: 2 }
//   - Novos campos: cnjCode, auth, mniVersion (informativos)
//   - Nova operação `detectarPorCnj` (lookup pelo segmento+TT do CNJ)

// ============================================================
// REGISTRY — manter em sync com workers/mni-tribunais.json
// ============================================================
const TRIBUNAIS_REGISTRY = {
  // ── SUPERIORES ──────────────────────────────────────────────
  STF: {
    codigo: 'STF', nome: 'Supremo Tribunal Federal',
    sistema: 'eSTF', esfera: 'superior', cnjCode: '1.00', auth: 'icp_brasil', mniVersion: '2.2.2',
    endpoint: 'https://ws.stf.jus.br/servico-intercomunicacao-2.2.2/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Acesso restrito (art.246 §2º CPC). Advogados privados precisam habilitação via CINT/SPR.'
  },
  STJ: {
    codigo: 'STJ', nome: 'Superior Tribunal de Justiça',
    sistema: 'eSTJ', esfera: 'superior', cnjCode: '3.00', auth: 'ambos', mniVersion: '2.2.2',
    endpoint: 'https://ws.stj.jus.br/servico-intercomunicacao-2.2.2/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Endpoint público confirmado por Eduardo. Testar com credencial real.'
  },
  TST: {
    codigo: 'TST', nome: 'Tribunal Superior do Trabalho',
    sistema: 'pje', esfera: 'superior', cnjCode: '5.00', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tst.jus.br/juris/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  // ── TRFS ────────────────────────────────────────────────────
  TRF1: {
    codigo: 'TRF1', nome: 'Tribunal Regional Federal da 1ª Região',
    sistema: 'pje', esfera: 'federal', cnjCode: '4.01', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje1g.trf1.jus.br/pje/intercomunicacao',
    endpoint2g: 'https://pje2g.trf1.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: true, validadoEm: '2026-05-11',
    obs: 'Health check OK. TRF1 também tem eProc paralelo (TRF1_eProc).'
  },
  TRF1_eProc: {
    codigo: 'TRF1_eProc', nome: 'TRF1 — eProc (sistema paralelo)',
    sistema: 'eproc', esfera: 'federal', cnjCode: '4.01', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://eproc1g.trf1.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    endpoint2g: 'https://eproc2g.trf1.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Seções têm hosts próprios (eproc.jfgo.jus.br, eproc.jfdf.jus.br).'
  },
  TRF2: {
    codigo: 'TRF2', nome: 'Tribunal Regional Federal da 2ª Região',
    sistema: 'eproc', esfera: 'federal', cnjCode: '4.02', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://eproc1g.trf2.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    endpoint2g: 'https://eproc2g.trf2.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Padrão eProc — código-fonte público (github trf2-jus-br).'
  },
  TRF3: {
    codigo: 'TRF3', nome: 'Tribunal Regional Federal da 3ª Região',
    sistema: 'pje', esfera: 'federal', cnjCode: '4.03', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.trf3.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'TRF3 tem restrições/bloqueio por IP.'
  },
  TRF4: {
    codigo: 'TRF4', nome: 'Tribunal Regional Federal da 4ª Região',
    sistema: 'eproc', esfera: 'federal', cnjCode: '4.04', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://eproc1g.trf4.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    endpoint2g: 'https://eproc2g.trf4.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Criou o eProc — referência.'
  },
  TRF5: {
    codigo: 'TRF5', nome: 'Tribunal Regional Federal da 5ª Região',
    sistema: 'pje', esfera: 'federal', cnjCode: '4.05', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.trf5.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TRF6: {
    codigo: 'TRF6', nome: 'Tribunal Regional Federal da 6ª Região',
    sistema: 'pje', esfera: 'federal', cnjCode: '4.06', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.trf6.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Tribunal novo (2021, MG).'
  },
  // ── TJs ─────────────────────────────────────────────────────
  TJGO: {
    codigo: 'TJGO', nome: 'Tribunal de Justiça de Goiás',
    sistema: 'projudi', esfera: 'estadual', cnjCode: '8.09', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://projudi.tjgo.jus.br/IntercomunicacaoService',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: true, validadoEm: '2026-05-11',
    obs: 'POC validada. Endpoint mudou do v4.3.0 (era /projudi/webservices/intercomunicacao).'
  },
  TJDF: {
    codigo: 'TJDF', nome: 'Tribunal de Justiça do Distrito Federal e Territórios',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.07', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjdft.jus.br/pje/intercomunicacao',
    endpoint2g: 'https://pje.tjdft.jus.br/pje2g/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Prioritário (OAB/DF). Health check via Cloudflare deu 403 (provável WAF).'
  },
  TJSP: {
    codigo: 'TJSP', nome: 'Tribunal de Justiça de São Paulo',
    sistema: 'esaj', esfera: 'estadual', cnjCode: '8.26', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'http://esaj.tjsp.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false, atencao: 'endpoint_http',
    obs: 'TJSP via eSAJ. ATENÇÃO: HTTP (não HTTPS) — confirmar se aceita HTTPS. Parser pode precisar ajuste.'
  },
  TJRJ: {
    codigo: 'TJRJ', nome: 'Tribunal de Justiça do Rio de Janeiro',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.19', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjrj.jus.br/pje/intercomunicacao',
    endpoint2g: 'https://pje.tjrj.jus.br/pje2g/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJMG: {
    codigo: 'TJMG', nome: 'Tribunal de Justiça de Minas Gerais',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.13', auth: 'icp_brasil', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjmg.jus.br/pje/intercomunicacao',
    endpoint2g: 'https://pje.tjmg.jus.br/pje2g/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Exige ICP-Brasil (Provimento 355/2018).'
  },
  TJES: {
    codigo: 'TJES', nome: 'Tribunal de Justiça do Espírito Santo',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.08', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjes.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'TJES tem documentação técnica pública do MNI.'
  },
  TJMT: {
    codigo: 'TJMT', nome: 'Tribunal de Justiça de Mato Grosso',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.11', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjmt.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJMS: {
    codigo: 'TJMS', nome: 'Tribunal de Justiça de Mato Grosso do Sul',
    sistema: 'esaj', esfera: 'estadual', cnjCode: '8.12', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://esaj.tjms.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Usa eSAJ (mesmo padrão TJSP).'
  },
  TJPR: {
    codigo: 'TJPR', nome: 'Tribunal de Justiça do Paraná (Projudi)',
    sistema: 'projudi', esfera: 'estadual', cnjCode: '8.16', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://projudi.tjpr.jus.br/projudi/webservices/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'TJPR usa Projudi + PJe (TJPR_PJe).'
  },
  TJPR_PJe: {
    codigo: 'TJPR_PJe', nome: 'Tribunal de Justiça do Paraná (PJe)',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.16', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjpr.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJSC: {
    codigo: 'TJSC', nome: 'Tribunal de Justiça de Santa Catarina',
    sistema: 'esaj', esfera: 'estadual', cnjCode: '8.24', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://esaj.tjsc.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJRS: {
    codigo: 'TJRS', nome: 'Tribunal de Justiça do Rio Grande do Sul',
    sistema: 'eproc', esfera: 'estadual', cnjCode: '8.21', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://eproc1g.tjrs.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    endpoint2g: 'https://eproc2g.tjrs.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Migrou eThemis → eProc.'
  },
  TJPI: {
    codigo: 'TJPI', nome: 'Tribunal de Justiça do Piauí',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.18', auth: 'cpf_senha', mniVersion: '2.2.3',
    endpoint: 'https://pje.tjpi.jus.br/pje/intercomunicacao',
    endpoint2g: 'https://pje.tjpi.jus.br/pje2g/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'MNI 2.2.3 documentado publicamente. Credencial mediante solicitação.'
  },
  TJMA: {
    codigo: 'TJMA', nome: 'Tribunal de Justiça do Maranhão',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.10', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjma.jus.br/pje/ConsultaPJe',
    endpoint2g: 'https://pje2.tjma.jus.br/pje2g/ConsultaPJe',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false, atencao: 'rota_especial',
    obs: 'ATENÇÃO: rota /ConsultaPJe (não /intercomunicacao). Parser pode precisar ajuste.'
  },
  TJBA: {
    codigo: 'TJBA', nome: 'Tribunal de Justiça da Bahia',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.05', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjba.jus.br/pje/intercomunicacao',
    endpoint2g: 'https://pje.tjba.jus.br/pje2g/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'BA usa PJe + eSAJ + Projudi por comarca.'
  },
  TJPE: {
    codigo: 'TJPE', nome: 'Tribunal de Justiça de Pernambuco',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.17', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2',
    endpoint2g: 'https://pjemni.app.tjpe.jus.br/2g/servico-intercomunicacao-2.2.2',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Subdomínio próprio pjemni.app.tjpe.jus.br.'
  },
  TJCE: {
    codigo: 'TJCE', nome: 'Tribunal de Justiça do Ceará',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.06', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjce.jus.br/pje1grau/intercomunicacao',
    endpoint2g: 'https://pje.tjce.jus.br/pje2grau/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Path /pje1grau, /pje2grau (variação PJe).'
  },
  TJRN: {
    codigo: 'TJRN', nome: 'Tribunal de Justiça do Rio Grande do Norte',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.20', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjrn.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJPB: {
    codigo: 'TJPB', nome: 'Tribunal de Justiça da Paraíba',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.15', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjpb.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJAL: {
    codigo: 'TJAL', nome: 'Tribunal de Justiça de Alagoas',
    sistema: 'esaj', esfera: 'estadual', cnjCode: '8.02', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://esaj.tjal.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJSE: {
    codigo: 'TJSE', nome: 'Tribunal de Justiça de Sergipe',
    sistema: 'eproc', esfera: 'estadual', cnjCode: '8.25', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://eproc1g.tjse.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    endpoint2g: 'https://eproc2g.tjse.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJTO: {
    codigo: 'TJTO', nome: 'Tribunal de Justiça do Tocantins',
    sistema: 'eproc', esfera: 'estadual', cnjCode: '8.27', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://eproc1g.tjto.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    endpoint2g: 'https://eproc2g.tjto.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJPA: {
    codigo: 'TJPA', nome: 'Tribunal de Justiça do Pará (Projudi)',
    sistema: 'projudi', esfera: 'estadual', cnjCode: '8.14', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://projudi.tjpa.jus.br/projudi/webservices/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'TJPA usa Projudi + PJe.'
  },
  TJAM: {
    codigo: 'TJAM', nome: 'Tribunal de Justiça do Amazonas',
    sistema: 'projudi', esfera: 'estadual', cnjCode: '8.04', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://projudi.tjam.jus.br/projudi/webservices/consultaProcessualWebService',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false, atencao: 'rota_especial',
    obs: 'TJAM usa consultaProcessualWebService.'
  },
  TJRR: {
    codigo: 'TJRR', nome: 'Tribunal de Justiça de Roraima',
    sistema: 'projudi', esfera: 'estadual', cnjCode: '8.23', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://projudi.tjrr.jus.br/projudi/webservices/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJAC: {
    codigo: 'TJAC', nome: 'Tribunal de Justiça do Acre',
    sistema: 'esaj', esfera: 'estadual', cnjCode: '8.01', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://esaj.tjac.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  TJAP: {
    codigo: 'TJAP', nome: 'Tribunal de Justiça do Amapá',
    sistema: 'tucujuris', esfera: 'estadual', cnjCode: '8.03', auth: 'n/a', mniVersion: 'n/a',
    endpoint: null, namespace: null, soapAction: null, validado: false, naoSuportado: true,
    motivo: 'TJAP usa Tucujuris (sistema próprio) — sem MNI. Usar DataJud.'
  },
  TJRO: {
    codigo: 'TJRO', nome: 'Tribunal de Justiça de Rondônia',
    sistema: 'pje', esfera: 'estadual', cnjCode: '8.22', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.tjro.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  },
  // ── TRTs ────────────────────────────────────────────────────
  TRT18: {
    codigo: 'TRT18', nome: 'Tribunal Regional do Trabalho da 18ª Região (GO)',
    sistema: 'pje', esfera: 'trabalho', cnjCode: '5.18', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.trt18.jus.br/pje/intercomunicacao',
    endpoint2g: 'https://pje.trt18.jus.br/pje2g/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'Prioritário (GO trabalho). Health Cloudflare deu 404 — testar com credencial.'
  },
  TRT2: {
    codigo: 'TRT2', nome: 'Tribunal Regional do Trabalho da 2ª Região (SP)',
    sistema: 'pje', esfera: 'trabalho', cnjCode: '5.02', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.trt2.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false,
    obs: 'TRT2 tem dificuldades de acesso externo.'
  },
  TRT10: {
    codigo: 'TRT10', nome: 'Tribunal Regional do Trabalho da 10ª Região (DF/TO)',
    sistema: 'pje', esfera: 'trabalho', cnjCode: '5.10', auth: 'cpf_senha', mniVersion: '2.2.2',
    endpoint: 'https://pje.trt10.jus.br/pje/intercomunicacao',
    namespace: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
    soapAction: '', validado: false
  }
};

// ============================================================
// Detecta tribunal a partir do número CNJ
// Formato: NNNNNNN-DD.AAAA.J.TT.OOOO
//   J = segmento (1=STF, 3=STJ, 4=TRF, 5=TRT, 8=TJ)
//   TT = código tribunal
// Retorna o config ou null.
// Se houver múltiplos matches (ex: TJPR + TJPR_PJe), retorna lista.
// ============================================================
function detectarTribunalPorCnj(numeroProcesso) {
  const padrao = /\d{7}-?\d{2}\.?\d{4}\.?(\d)\.?(\d{2})\.?\d{4}/;
  const m = String(numeroProcesso || '').replace(/\s/g, '').match(padrao);
  if (!m) return null;
  const cnjCode = `${m[1]}.${m[2]}`;
  const matches = Object.values(TRIBUNAIS_REGISTRY).filter(t => t.cnjCode === cnjCode && !t.naoSuportado);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return matches; // múltiplos sistemas (ex: TJPR Projudi+PJe)
}

// ============================================================
// Handler HTTP
// ============================================================

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || 'http://localhost:8000').split(',').map(s => s.trim());
    const origin = request.headers.get('Origin') || '';
    const corsOk = allowed.includes(origin) || allowed.includes('*');
    const corsHeaders = corsOk ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    } : {};

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    if (request.method === 'GET') {
      const codigos = Object.keys(TRIBUNAIS_REGISTRY);
      const validados = codigos.filter(c => TRIBUNAIS_REGISTRY[c].validado);
      const naoSuportados = codigos.filter(c => TRIBUNAIS_REGISTRY[c].naoSuportado);
      return json({
        worker: 'uc-mni', versao: '0.3.0',
        total: codigos.length,
        validados, naoSuportados,
        operacoes: ['consultarProcesso', 'health', 'listarTribunais', 'detectarPorCnj']
      }, 200, corsHeaders);
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, corsHeaders);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'invalid_json' }, 400, corsHeaders); }

    const operacao = String(body.operacao || 'consultarProcesso');

    if (operacao === 'listarTribunais') {
      return json({ sucesso: true, tribunais: TRIBUNAIS_REGISTRY, default: 'TJGO' }, 200, corsHeaders);
    }

    if (operacao === 'detectarPorCnj') {
      const resultado = detectarTribunalPorCnj(body.cnj || '');
      if (!resultado) return json({ sucesso: false, erro: 'cnj_nao_reconhecido' }, 200, corsHeaders);
      if (Array.isArray(resultado)) {
        return json({ sucesso: true, multiplos: true, candidatos: resultado.map(c => c.codigo) }, 200, corsHeaders);
      }
      return json({ sucesso: true, codigo: resultado.codigo, tribunal: resultado }, 200, corsHeaders);
    }

    if (operacao === 'health') {
      const codigo = String(body.tribunal || '').toUpperCase();
      const conf = TRIBUNAIS_REGISTRY[codigo];
      if (!conf) return json({ error: 'tribunal_desconhecido', codigo }, 400, corsHeaders);
      if (conf.naoSuportado) {
        return json({ sucesso: false, codigo, status: 'nao_suportado', motivo: conf.motivo || '' }, 200, corsHeaders);
      }
      const r = await healthCheck(conf);
      return json({ sucesso: true, codigo, ...r }, 200, corsHeaders);
    }

    const codigo = String(body.tribunal || 'TJGO').toUpperCase();
    const conf = TRIBUNAIS_REGISTRY[codigo];
    if (!conf) return json({ error: 'tribunal_desconhecido', codigo }, 400, corsHeaders);
    if (conf.naoSuportado) {
      return json({ error: 'tribunal_nao_suportado', codigo, motivo: conf.motivo || '' }, 400, corsHeaders);
    }

    const grau = body.grau === 2 ? 2 : 1;
    const endpoint = grau === 2 ? (conf.endpoint2g || conf.endpoint) : conf.endpoint;
    if (!endpoint) return json({ error: 'endpoint_nao_configurado', codigo, grau }, 400, corsHeaders);

    const cnj = String(body.cnj || '').replace(/\D/g, '');
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    const senha = String(body.senha || '');
    const debug = !!body.debug;

    if (!cpf || !senha) return json({ error: 'cpf_senha_obrigatorios' }, 400, corsHeaders);

    try {
      if (operacao === 'consultarProcesso') {
        if (!cnj) return json({ error: 'cnj_obrigatorio' }, 400, corsHeaders);
        const result = await consultarProcesso(conf, endpoint, { cnj, cpf, senha, debug });
        result.tribunal = codigo;
        result.grau = grau;
        return json(result, 200, corsHeaders);
      }
      return json({ error: 'operacao_nao_suportada', operacao }, 400, corsHeaders);
    } catch (e) {
      console.error('[MNI] erro:', e?.stack || e);
      return json({ error: 'soap_error', message: String(e?.message || e), tribunal: codigo }, 502, corsHeaders);
    }
  }
};

// ============================================================
// Health check
// ============================================================
async function healthCheck(conf) {
  const url = conf.wsdl || (conf.endpoint + '?WSDL');
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'UC-Juridico-MNI/0.3-healthcheck' },
      signal: AbortSignal.timeout(8000)
    });
    const elapsed = Date.now() - t0;
    const ct = resp.headers.get('content-type') || '';
    let preview = '';
    if (resp.ok) {
      const text = await resp.text();
      preview = text.slice(0, 200);
      const okWsdl = /<\??xml/i.test(preview) && /definitions/i.test(preview);
      return {
        status: okWsdl ? 'ok' : 'resposta_inesperada',
        httpStatus: resp.status, contentType: ct, elapsedMs: elapsed, preview
      };
    }
    return { status: 'http_erro', httpStatus: resp.status, contentType: ct, elapsedMs: elapsed };
  } catch (e) {
    return { status: 'falha_rede', elapsedMs: Date.now() - t0, erro: String(e?.message || e) };
  }
}

// ============================================================
// consultarProcesso
// ============================================================
async function consultarProcesso(conf, endpoint, { cnj, cpf, senha, debug }) {
  const envelope = buildEnvelope(conf.namespace, 'consultarProcesso', `
    <idConsultante>${escapeXml(cpf)}</idConsultante>
    <senhaConsultante>${escapeXml(senha)}</senhaConsultante>
    <numeroProcesso>${escapeXml(cnj)}</numeroProcesso>
    <movimentos>true</movimentos>
    <incluirCabecalho>true</incluirCabecalho>
    <incluirDocumentos>false</incluirDocumentos>
  `);

  const t0 = Date.now();
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': conf.soapAction === '' || conf.soapAction == null
        ? '""'
        : `"${conf.soapAction}"`,
      'User-Agent': 'UC-Juridico-MNI/0.3'
    },
    body: envelope
  });
  const elapsed = Date.now() - t0;
  const text = await resp.text();

  if (!resp.ok) {
    return { sucesso: false, erro: 'http_' + resp.status, httpStatus: resp.status, elapsedMs: elapsed, raw: text.slice(0, 4000) };
  }
  const fault = extractFault(text);
  if (fault) {
    return { sucesso: false, erro: 'soap_fault', mensagem: fault, elapsedMs: elapsed, raw: text.slice(0, 4000) };
  }
  const parsed = parseConsultarProcesso(text);
  const result = { sucesso: parsed.sucesso !== false, elapsedMs: elapsed, ...parsed, rawSize: text.length };
  if (debug) result.rawXml = text;
  return result;
}

// ============================================================
// Envelope SOAP
// ============================================================
function buildEnvelope(namespace, operacao, bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:int="${namespace}">
  <soap:Header/>
  <soap:Body>
    <int:${operacao}>
${bodyXml.trim()}
    </int:${operacao}>
  </soap:Body>
</soap:Envelope>`;
}

// ============================================================
// XML parsing — validado pra TJGO/Projudi
// ============================================================
function extractFault(xml) {
  const m = xml.match(/<(?:soap:|S:|env:)?Fault[^>]*>([\s\S]*?)<\/(?:soap:|S:|env:)?Fault>/i);
  if (!m) return null;
  const inside = m[1];
  const reason = (inside.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)
              || inside.match(/<(?:S:|env:)?Reason[^>]*>([\s\S]*?)<\/(?:S:|env:)?Reason>/i))?.[1] || inside;
  return reason.trim().slice(0, 800);
}
function tagText(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}
function tagAttr(xml, tag, attr) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}
function _parseDataHoraMni(s) {
  if (!s) return '';
  s = String(s).replace(/\D/g, '');
  if (s.length < 8) return s;
  const y = s.slice(0,4), m = s.slice(4,6), d = s.slice(6,8);
  const hh = s.slice(8,10) || '00', mm = s.slice(10,12) || '00', ss = s.slice(12,14) || '00';
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}
function _decodeXmlEntities(s) {
  if (!s) return '';
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function parseConsultarProcesso(xml) {
  const sucessoTag = tagText(xml, 'sucesso');
  const mensagem   = tagText(xml, 'mensagem');
  if (sucessoTag.toLowerCase() === 'false') {
    return { sucesso: false, mensagem: mensagem || '(sem mensagem)' };
  }
  const procBlock = (xml.match(/<(?:\w+:)?processo\b[\s\S]*?<\/(?:\w+:)?processo>/i) || [''])[0];
  const dadosBasicosOpen = (procBlock.match(/<(?:\w+:)?dadosBasicos\b[^>]*>/i) || [''])[0];
  const dadosBasicosBlock = (procBlock.match(/<(?:\w+:)?dadosBasicos\b[\s\S]*?<\/(?:\w+:)?dadosBasicos>/i) || [''])[0];

  const numeroProcesso = (dadosBasicosOpen.match(/\bnumero="([^"]*)"/) || [])[1] || '';
  const classeCodigo = (dadosBasicosOpen.match(/\bclasseProcessual="([^"]*)"/) || [])[1] || '';
  const nivelSigilo = (dadosBasicosOpen.match(/\bnivelSigilo="([^"]*)"/) || [])[1] || '';
  const codigoLocalidade = (dadosBasicosOpen.match(/\bcodigoLocalidade="([^"]*)"/) || [])[1] || '';
  const valorCausa = tagText(dadosBasicosBlock, 'valorCausa') || '';
  const magistradoAtuante = tagText(dadosBasicosBlock, 'magistradoAtuante') || '';
  const orgaoJulgador = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'nomeOrgao') || '';
  const codigoOrgao = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'codigoOrgao') || '';
  const codigoMunicipioIBGE = tagAttr(dadosBasicosBlock, 'orgaoJulgador', 'codigoMunicipioIBGE') || '';

  const assuntoBlock = (dadosBasicosBlock.match(/<(?:\w+:)?assunto\b[\s\S]*?<\/(?:\w+:)?assunto>/i) || [''])[0];
  const assuntoCodigoNacional = tagText(assuntoBlock, 'codigoNacional') || '';
  const assuntoDescricao = _decodeXmlEntities(tagAttr(assuntoBlock, 'assuntoLocal', 'descricao') || '');
  const assuntoCodigoAssunto = tagAttr(assuntoBlock, 'assuntoLocal', 'codigoAssunto') || '';

  const outrosParams = {};
  const opMatches = dadosBasicosBlock.matchAll(/<(?:\w+:)?outroParametro\b[^>]*\bnome="([^"]*)"[^>]*\bvalor="([^"]*)"[^>]*\/?>/g);
  for (const m of opMatches) outrosParams[m[1]] = _decodeXmlEntities(m[2]);
  const area = outrosParams.Area || '';
  const processoFase = outrosParams.ProcessoFase || '';
  const processoStatus = outrosParams.ProcessoStatus || '';
  const processoTipo = outrosParams.ProcessoTipo || '';
  const serventia = outrosParams.Serventia || '';
  const dataDistribuicaoRaw = outrosParams.DataDistribuicao || '';
  const dataAjuizamento = dataDistribuicaoRaw
    ? `${dataDistribuicaoRaw.slice(0,4)}-${dataDistribuicaoRaw.slice(4,6)}-${dataDistribuicaoRaw.slice(6,8)}`
    : '';

  const partes = [];
  const polos = dadosBasicosBlock.match(/<(?:\w+:)?polo\b[\s\S]*?<\/(?:\w+:)?polo>/gi) || [];
  for (const poloXml of polos) {
    const tipoPolo = (poloXml.match(/<(?:\w+:)?polo\b[^>]*\bpolo="([^"]*)"/) || [])[1] || '';
    const partesXml = poloXml.match(/<(?:\w+:)?parte\b[\s\S]*?<\/(?:\w+:)?parte>/gi) || [];
    for (const pXml of partesXml) {
      const nome = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bnome="([^"]*)"/) || [])[1] || '';
      const cpfCnpj = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bnumeroDocumentoPrincipal="([^"]*)"/) || [])[1] || '';
      const tipoPessoa = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\btipoPessoa="([^"]*)"/) || [])[1] || '';
      const sexo = (pXml.match(/<(?:\w+:)?pessoa\b[^>]*\bsexo="([^"]*)"/) || [])[1] || '';
      const advogados = [];
      const advMatches = pXml.matchAll(/<(?:\w+:)?advogado\b[^>]*?>/g);
      for (const a of advMatches) {
        const advNome = (a[0].match(/\bnome="([^"]*)"/) || [])[1] || '';
        const advInscricao = (a[0].match(/\binscricao="([^"]*)"/) || [])[1] || '';
        const advCpf = (a[0].match(/\bnumeroDocumentoPrincipal="([^"]*)"/) || [])[1] || '';
        advogados.push({ nome: advNome, oab: advInscricao, cpf: advCpf });
      }
      partes.push({ nome, polo: tipoPolo, cpfCnpj, tipoPessoa, sexo, advogados });
    }
  }

  const movimentos = [];
  const movsXml = procBlock.match(/<(?:\w+:)?movimento\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/(?:\w+:)?movimento>)/gi) || [];
  for (const m of movsXml) {
    const dataHora = (m.match(/<(?:\w+:)?movimento\b[^>]*\bdataHora="([^"]*)"/) || [])[1] || '';
    const identificador = (m.match(/<(?:\w+:)?movimento\b[^>]*\bidentificadorMovimento="([^"]*)"/) || [])[1] || '';
    const codigoNacional = (m.match(/<(?:\w+:)?movimentoNacional\b[^>]*\bcodigoNacional="([^"]*)"/) || [])[1] || '';
    const codigoLocal = (m.match(/<(?:\w+:)?movimentoLocal\b[^>]*\bcodigoMovimento="([^"]*)"/) || [])[1] || '';
    const descricao = _decodeXmlEntities((m.match(/<(?:\w+:)?movimentoLocal\b[^>]*\bdescricao="([^"]*)"/) || [])[1] || '');
    const complemento = _decodeXmlEntities(tagText(m, 'complemento') || '');
    movimentos.push({
      dataHora,
      dataIso: _parseDataHoraMni(dataHora),
      codigoNacional, codigoLocal, descricao, complemento, identificador
    });
  }
  movimentos.sort((a, b) => (b.dataHora || '').localeCompare(a.dataHora || ''));

  return {
    sucesso: true,
    cnj: numeroProcesso,
    classe: { codigo: classeCodigo },
    assunto: { codigoNacional: assuntoCodigoNacional, codigoLocal: assuntoCodigoAssunto, descricao: assuntoDescricao },
    orgaoJulgador, codigoOrgao, codigoMunicipioIBGE, codigoLocalidade,
    nivelSigilo, valorCausa, dataAjuizamento, magistradoAtuante,
    area, processoFase, processoStatus, processoTipo, serventia,
    outrosParametros: outrosParams,
    partes,
    movimentos: movimentos.slice(0, 100),
    movimentosTotal: movimentos.length
  };
}

// ============================================================
// Helpers
// ============================================================
function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));
}
function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(extraHeaders || {}) }
  });
}
