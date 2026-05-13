// UC Jurídico — MNI Worker genérico (multi-tribunal)
// Versão: 0.7.0 · sprint MNI.3.5 (consultarTeorComunicacao)
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
//   { tribunal: "TJGO", operacao: "consultarAvisosPendentes", cpf, senha, dataReferencia? (YYYYMMDD), debug? }
//   { tribunal: "TJGO", operacao: "consultarTeorComunicacao", cpf, senha, idAviso, debug? }
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
  STF: {"codigo":"STF","nome":"Supremo Tribunal Federal","sistema":"eSTF","esfera":"superior","cnjCode":"1.00","auth":"icp_brasil","mniVersion":"2.2.2","endpoint":"https://ws.stf.jus.br/servico-intercomunicacao-2.2.2/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"cert_invalido","observacoes":"Acesso restrito (art.246 §2º CPC). Health deu HTTP 526 (SSL inválido no origin)."},
  STJ: {"codigo":"STJ","nome":"Superior Tribunal de Justiça","sistema":"eSTJ","esfera":"superior","cnjCode":"3.00","auth":"ambos","mniVersion":"2.2.2","endpoint":"https://ws.stj.jus.br/servico-intercomunicacao-2.2.2/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"timeout","observacoes":"Endpoint público confirmado por Eduardo. Health deu timeout — testar com credencial real."},
  TST: {"codigo":"TST","nome":"Tribunal Superior do Trabalho","sistema":"pje","esfera":"superior","cnjCode":"5.00","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tst.jus.br/juris/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — provável WAF do TST bloqueando Cloudflare. Testar com browser real."},
  TRF1: {"codigo":"TRF1","nome":"Tribunal Regional Federal da 1ª Região","sistema":"pje","esfera":"federal","cnjCode":"4.01","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje1g.trf1.jus.br/pje/intercomunicacao","endpoint2g":"https://pje2g.trf1.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok"},
  TRF1_eProc: {"codigo":"TRF1_eProc","nome":"TRF1 — eProc (sistema paralelo)","sistema":"eproc","esfera":"federal","cnjCode":"4.01","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://eproc1g.trf1.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","endpoint2g":"https://eproc2g.trf1.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"naoSuportado":true,"motivo":"Health check confirmou: hostname eproc1g.trf1.jus.br não existe. eProc no TRF1 fica nas seções judiciárias (jfgo, jfdf) com hosts próprios."},
  TRF2: {"codigo":"TRF2","nome":"Tribunal Regional Federal da 2ª Região","sistema":"eproc","esfera":"federal","cnjCode":"4.02","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://eproc1g.trf2.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","endpoint2g":"https://eproc2g.trf2.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 530 — Cloudflare não alcança origin. Provável funcionar via browser."},
  TRF3: {"codigo":"TRF3","nome":"Tribunal Regional Federal da 3ª Região","sistema":"pje","esfera":"federal","cnjCode":"4.03","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trf3.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 530 — TRF3 é conhecido por restrições."},
  TRF4: {"codigo":"TRF4","nome":"Tribunal Regional Federal da 4ª Região","sistema":"eproc","esfera":"federal","cnjCode":"4.04","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://eproc1g.trf4.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","endpoint2g":"https://eproc2g.trf4.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 530 — criou o eProc. Endpoint correto, mas Cloudflare bloqueado."},
  TRF5: {"codigo":"TRF5","nome":"Tribunal Regional Federal da 5ª Região","sistema":"pje","esfera":"federal","cnjCode":"4.05","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trf5.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok"},
  TRF6: {"codigo":"TRF6","nome":"Tribunal Regional Federal da 6ª Região","sistema":"pje","esfera":"federal","cnjCode":"4.06","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trf6.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 530 — tribunal novo (2021, MG)."},
  TJGO: {"codigo":"TJGO","nome":"Tribunal de Justiça de Goiás","sistema":"projudi","esfera":"estadual","cnjCode":"8.09","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://projudi.tjgo.jus.br/IntercomunicacaoService","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok","observacoes":"POC validada. Endpoint mudou do v4.3.0 (era /projudi/webservices/intercomunicacao)."},
  TJDF: {"codigo":"TJDF","nome":"Tribunal de Justiça do Distrito Federal e Territórios","sistema":"pje","esfera":"estadual","cnjCode":"8.07","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjdft.jus.br/pje/intercomunicacao","endpoint2g":"https://pje.tjdft.jus.br/pje2g/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"Prioritário (OAB/DF). HTTP 403 — WAF bloqueia Cloudflare. Testar via browser."},
  TJSP: {"codigo":"TJSP","nome":"Tribunal de Justiça de São Paulo","sistema":"esaj","esfera":"estadual","cnjCode":"8.26","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"http://esaj.tjsp.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok","atencao":"endpoint_http","observacoes":"Validado via Cloudflare (45ms). ATENÇÃO: HTTP não HTTPS. Parser pode precisar ajuste pro namespace eSAJ."},
  TJRJ: {"codigo":"TJRJ","nome":"Tribunal de Justiça do Rio de Janeiro","sistema":"pje","esfera":"estadual","cnjCode":"8.19","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjrj.jus.br/pje/intercomunicacao","endpoint2g":"https://pje.tjrj.jus.br/pje2g/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 530 — origin bloqueia Cloudflare."},
  TJMG: {"codigo":"TJMG","nome":"Tribunal de Justiça de Minas Gerais","sistema":"pje","esfera":"estadual","cnjCode":"8.13","auth":"icp_brasil","mniVersion":"2.2.2","endpoint":"https://pje.tjmg.jus.br/pje/intercomunicacao","endpoint2g":"https://pje.tjmg.jus.br/pje2g/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"Exige ICP-Brasil. HTTP 200 mas retorna HTML (não WSDL). Path provavelmente errado."},
  TJES: {"codigo":"TJES","nome":"Tribunal de Justiça do Espírito Santo","sistema":"pje","esfera":"estadual","cnjCode":"8.08","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjes.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok","observacoes":"TJES tem documentação técnica pública do MNI."},
  TJMT: {"codigo":"TJMT","nome":"Tribunal de Justiça de Mato Grosso","sistema":"pje","esfera":"estadual","cnjCode":"8.11","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjmt.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok"},
  TJMS: {"codigo":"TJMS","nome":"Tribunal de Justiça de Mato Grosso do Sul","sistema":"esaj","esfera":"estadual","cnjCode":"8.12","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://esaj.tjms.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok"},
  TJPR: {"codigo":"TJPR","nome":"Tribunal de Justiça do Paraná (Projudi)","sistema":"projudi","esfera":"estadual","cnjCode":"8.16","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://projudi.tjpr.jus.br/projudi/webservices/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"HTTP 404. TJGO migrou o path (de /projudi/webservices/ pra /IntercomunicacaoService) — TJPR pode ter feito o mesmo. Investigar."},
  TJPR_PJe: {"codigo":"TJPR_PJe","nome":"Tribunal de Justiça do Paraná (PJe)","sistema":"pje","esfera":"estadual","cnjCode":"8.16","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjpr.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"DNS resolveu mas request falhou (provável path errado)."},
  TJSC: {"codigo":"TJSC","nome":"Tribunal de Justiça de Santa Catarina","sistema":"esaj","esfera":"estadual","cnjCode":"8.24","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://esaj.tjsc.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 530 — Cloudflare bloqueado. Testar via browser."},
  TJRS: {"codigo":"TJRS","nome":"Tribunal de Justiça do Rio Grande do Sul","sistema":"eproc","esfera":"estadual","cnjCode":"8.21","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://eproc1g.tjrs.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","endpoint2g":"https://eproc2g.tjrs.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"Retorna HTML (não WSDL). TJRS migrou eThemis → eProc, path pode ser diferente."},
  TJPI: {"codigo":"TJPI","nome":"Tribunal de Justiça do Piauí","sistema":"pje","esfera":"estadual","cnjCode":"8.18","auth":"cpf_senha","mniVersion":"2.2.3","endpoint":"https://pje.tjpi.jus.br/1g/intercomunicacao","endpoint2g":"https://pje.tjpi.jus.br/2g/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-12","statusHealth":"ok","observacoes":"Validado via Cloudflare. MNI 2.2.3 (único do registry). Path corrigido 11/05: /1g/intercomunicacao (não /pje/)."},
  TJMA: {"codigo":"TJMA","nome":"Tribunal de Justiça do Maranhão","sistema":"pje","esfera":"estadual","cnjCode":"8.10","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjma.jus.br/pje/ConsultaPJe","endpoint2g":"https://pje2.tjma.jus.br/pje2g/ConsultaPJe","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok","atencao":"rota_especial","observacoes":"Rota /ConsultaPJe (não /intercomunicacao). Parser pode precisar ajuste."},
  TJBA: {"codigo":"TJBA","nome":"Tribunal de Justiça da Bahia","sistema":"pje","esfera":"estadual","cnjCode":"8.05","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjba.jus.br/pje/intercomunicacao","endpoint2g":"https://pje.tjba.jus.br/pje2g/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF. BA também usa eSAJ + Projudi por comarca."},
  TJPE: {"codigo":"TJPE","nome":"Tribunal de Justiça de Pernambuco","sistema":"pje","esfera":"estadual","cnjCode":"8.17","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2","endpoint2g":"https://pjemni.app.tjpe.jus.br/2g/servico-intercomunicacao-2.2.2","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"cert_invalido","observacoes":"HTTP 526 (SSL inválido no subdomínio pjemni.app.tjpe.jus.br)."},
  TJCE: {"codigo":"TJCE","nome":"Tribunal de Justiça do Ceará","sistema":"pje","esfera":"estadual","cnjCode":"8.06","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjce.jus.br/pje1grau/intercomunicacao","endpoint2g":"https://pje.tjce.jus.br/pje2grau/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok","observacoes":"Path /pje1grau, /pje2grau (variação PJe)."},
  TJRN: {"codigo":"TJRN","nome":"Tribunal de Justiça do Rio Grande do Norte","sistema":"pje","esfera":"estadual","cnjCode":"8.20","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjrn.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"HTTP 404 — path errado."},
  TJPB: {"codigo":"TJPB","nome":"Tribunal de Justiça da Paraíba","sistema":"pje","esfera":"estadual","cnjCode":"8.15","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjpb.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 520 — origin Cloudflare error."},
  TJAL: {"codigo":"TJAL","nome":"Tribunal de Justiça de Alagoas","sistema":"esaj","esfera":"estadual","cnjCode":"8.02","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://esaj.tjal.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 530."},
  TJSE: {"codigo":"TJSE","nome":"Tribunal de Justiça de Sergipe","sistema":"eproc","esfera":"estadual","cnjCode":"8.25","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://eproc1g.tjse.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","endpoint2g":"https://eproc2g.tjse.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"HTTP 200 retorna HTML — endpoint eProc TJSE diferente do padrão TRF4."},
  TJTO: {"codigo":"TJTO","nome":"Tribunal de Justiça do Tocantins","sistema":"eproc","esfera":"estadual","cnjCode":"8.27","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://eproc1g.tjto.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","endpoint2g":"https://eproc2g.tjto.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 530."},
  TJPA: {"codigo":"TJPA","nome":"Tribunal de Justiça do Pará (Projudi)","sistema":"projudi","esfera":"estadual","cnjCode":"8.14","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://projudi.tjpa.jus.br/projudi/webservices/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"timeout","observacoes":"Timeout. TJPA também tem PJe paralelo (TJPA_PJe)."},
  TJPA_PJe: {"codigo":"TJPA_PJe","nome":"Tribunal de Justiça do Pará (PJe)","sistema":"pje","esfera":"estadual","cnjCode":"8.14","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjpa.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"Falhou (DNS ou refused). Hostname pje.tjpa.jus.br pode não existir como tal."},
  TJAM: {"codigo":"TJAM","nome":"Tribunal de Justiça do Amazonas","sistema":"projudi","esfera":"estadual","cnjCode":"8.04","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://projudi.tjam.jus.br/projudi/webservices/consultaProcessualWebService","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"falha_rede","atencao":"rota_especial","observacoes":"NetworkError no host projudi.tjam.jus.br. Pode estar offline ou bloqueio rigoroso."},
  TJRR: {"codigo":"TJRR","nome":"Tribunal de Justiça de Roraima","sistema":"projudi","esfera":"estadual","cnjCode":"8.23","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://projudi.tjrr.jus.br/projudi/webservices/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"HTTP 404 — path errado (mesmo TJGO migrou)."},
  TJAC: {"codigo":"TJAC","nome":"Tribunal de Justiça do Acre","sistema":"esaj","esfera":"estadual","cnjCode":"8.01","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://esaj.tjac.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":true,"validadoEm":"2026-05-11","statusHealth":"ok"},
  TJAP: {"codigo":"TJAP","nome":"Tribunal de Justiça do Amapá","sistema":"tucujuris","esfera":"estadual","cnjCode":"8.03","auth":"n/a","mniVersion":"n/a","endpoint":null,"namespace":null,"soapAction":null,"validado":false,"naoSuportado":true,"motivo":"TJAP usa Tucujuris (sistema próprio) — sem MNI. Usar DataJud."},
  TJRO: {"codigo":"TJRO","nome":"Tribunal de Justiça de Rondônia","sistema":"pje","esfera":"estadual","cnjCode":"8.22","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.tjro.jus.br/pje/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"path_errado","observacoes":"HTTP 200 retorna HTML. Path PJe diferente."},
  TRT1: {"codigo":"TRT1","nome":"TRT da 1ª Região (RJ)","sistema":"pje","esfera":"trabalho","cnjCode":"5.01","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt1.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt1.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional do PJe-JT (CSJT) bloqueia Cloudflare. Path confirmado correto. Em browser real funciona."},
  TRT2: {"codigo":"TRT2","nome":"TRT da 2ª Região (SP)","sistema":"pje","esfera":"trabalho","cnjCode":"5.02","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt2.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt2.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT (mesmo erro em todos os 24 TRTs). Path confirmado correto após correção 11/05."},
  TRT3: {"codigo":"TRT3","nome":"TRT da 3ª Região (MG)","sistema":"pje","esfera":"trabalho","cnjCode":"5.03","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt3.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt3.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT4: {"codigo":"TRT4","nome":"TRT da 4ª Região (RS)","sistema":"pje","esfera":"trabalho","cnjCode":"5.04","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt4.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt4.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT5: {"codigo":"TRT5","nome":"TRT da 5ª Região (BA)","sistema":"pje","esfera":"trabalho","cnjCode":"5.05","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt5.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt5.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT6: {"codigo":"TRT6","nome":"TRT da 6ª Região (PE)","sistema":"pje","esfera":"trabalho","cnjCode":"5.06","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt6.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt6.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT7: {"codigo":"TRT7","nome":"TRT da 7ª Região (CE)","sistema":"pje","esfera":"trabalho","cnjCode":"5.07","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt7.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt7.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT8: {"codigo":"TRT8","nome":"TRT da 8ª Região (PA/AP)","sistema":"pje","esfera":"trabalho","cnjCode":"5.08","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt8.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt8.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT9: {"codigo":"TRT9","nome":"TRT da 9ª Região (PR)","sistema":"pje","esfera":"trabalho","cnjCode":"5.09","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt9.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt9.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT10: {"codigo":"TRT10","nome":"TRT da 10ª Região (DF/TO)","sistema":"pje","esfera":"trabalho","cnjCode":"5.10","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt10.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt10.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT. Path corrigido 11/05."},
  TRT11: {"codigo":"TRT11","nome":"TRT da 11ª Região (AM/RR)","sistema":"pje","esfera":"trabalho","cnjCode":"5.11","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt11.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt11.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT12: {"codigo":"TRT12","nome":"TRT da 12ª Região (SC)","sistema":"pje","esfera":"trabalho","cnjCode":"5.12","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt12.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt12.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT13: {"codigo":"TRT13","nome":"TRT da 13ª Região (PB)","sistema":"pje","esfera":"trabalho","cnjCode":"5.13","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt13.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt13.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT14: {"codigo":"TRT14","nome":"TRT da 14ª Região (RO/AC)","sistema":"pje","esfera":"trabalho","cnjCode":"5.14","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt14.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt14.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT15: {"codigo":"TRT15","nome":"TRT da 15ª Região (Campinas/SP)","sistema":"pje","esfera":"trabalho","cnjCode":"5.15","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt15.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt15.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT. Documentação oficial do TRT15 confirma este path; bloqueio é firewall, não path errado."},
  TRT16: {"codigo":"TRT16","nome":"TRT da 16ª Região (MA)","sistema":"pje","esfera":"trabalho","cnjCode":"5.16","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt16.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt16.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT17: {"codigo":"TRT17","nome":"TRT da 17ª Região (ES)","sistema":"pje","esfera":"trabalho","cnjCode":"5.17","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt17.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt17.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT18: {"codigo":"TRT18","nome":"TRT da 18ª Região (GO)","sistema":"pje","esfera":"trabalho","cnjCode":"5.18","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt18.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt18.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT. Prioritário (GO trabalho). Path corrigido 11/05 saiu de 404→403, confirmando path certo. Provável funcionar em browser logado."},
  TRT19: {"codigo":"TRT19","nome":"TRT da 19ª Região (AL)","sistema":"pje","esfera":"trabalho","cnjCode":"5.19","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt19.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt19.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT20: {"codigo":"TRT20","nome":"TRT da 20ª Região (SE)","sistema":"pje","esfera":"trabalho","cnjCode":"5.20","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt20.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt20.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT21: {"codigo":"TRT21","nome":"TRT da 21ª Região (RN)","sistema":"pje","esfera":"trabalho","cnjCode":"5.21","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt21.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt21.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT22: {"codigo":"TRT22","nome":"TRT da 22ª Região (PI)","sistema":"pje","esfera":"trabalho","cnjCode":"5.22","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt22.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt22.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT23: {"codigo":"TRT23","nome":"TRT da 23ª Região (MT)","sistema":"pje","esfera":"trabalho","cnjCode":"5.23","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt23.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt23.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
  TRT24: {"codigo":"TRT24","nome":"TRT da 24ª Região (MS)","sistema":"pje","esfera":"trabalho","cnjCode":"5.24","auth":"cpf_senha","mniVersion":"2.2.2","endpoint":"https://pje.trt24.jus.br/primeirograu/servicosweb/mni222/intercomunicacao","endpoint2g":"https://pje.trt24.jus.br/segundograu/servicosweb/mni222/intercomunicacao","namespace":"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/","soapAction":"","validado":false,"statusHealth":"bloqueio_cloudflare","observacoes":"HTTP 403 — WAF nacional PJe-JT."},
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
        worker: 'uc-mni', versao: '0.7.0',
        total: codigos.length,
        validados, naoSuportados,
        operacoes: ['consultarProcesso', 'consultarAvisosPendentes', 'consultarTeorComunicacao', 'health', 'listarTribunais', 'detectarPorCnj']
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
    const dataReferencia = String(body.dataReferencia || '').replace(/\D/g, ''); // YYYYMMDD opcional
    const idAviso = String(body.idAviso || '');
    // Pra consultarTeorComunicacao, mantemos o CNJ COM pontuação (formato canônico
    // CNJ). Apenas trim. Outros endpoints normalizam pra dígitos.
    const cnjAviso = String(body.cnjAviso || body.numeroProcesso || '').trim();

    if (!cpf || !senha) return json({ error: 'cpf_senha_obrigatorios' }, 400, corsHeaders);

    try {
      if (operacao === 'consultarProcesso') {
        if (!cnj) return json({ error: 'cnj_obrigatorio' }, 400, corsHeaders);
        const result = await consultarProcesso(conf, endpoint, { cnj, cpf, senha, debug });
        result.tribunal = codigo;
        result.grau = grau;
        return json(result, 200, corsHeaders);
      }
      if (operacao === 'consultarAvisosPendentes') {
        const result = await consultarAvisosPendentes(conf, endpoint, { cpf, senha, debug, dataReferencia });
        result.tribunal = codigo;
        result.grau = grau;
        return json(result, 200, corsHeaders);
      }
      if (operacao === 'consultarTeorComunicacao') {
        if (!idAviso) return json({ error: 'idAviso_obrigatorio' }, 400, corsHeaders);
        const result = await consultarTeorComunicacao(conf, endpoint, { cpf, senha, idAviso, cnjAviso, debug });
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
      headers: { 'User-Agent': 'UC-Juridico-MNI/0.5-healthcheck' },
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
      'User-Agent': 'UC-Juridico-MNI/0.5'
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
// consultarAvisosPendentes — intimações pendentes do advogado
// ============================================================
// Operação MNI 2.2.2. Não precisa de CNJ — retorna TODOS os avisos
// pendentes do advogado (CPF) no tribunal. Parser tolerante (schema
// varia bastante entre tribunais).
async function consultarAvisosPendentes(conf, endpoint, { cpf, senha, debug, dataReferencia }) {
  // Parâmetros padrão MNI: idConsultante + senhaConsultante. Alguns
  // tribunais aceitam dataReferencia (YYYYMMDD) pra filtrar a partir de uma data.
  const params = `
    <idConsultante>${escapeXml(cpf)}</idConsultante>
    <senhaConsultante>${escapeXml(senha)}</senhaConsultante>
    ${dataReferencia ? `<dataReferencia>${escapeXml(dataReferencia)}</dataReferencia>` : ''}
  `;
  const envelope = buildEnvelope(conf.namespace, 'consultarAvisosPendentes', params);

  const t0 = Date.now();
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': conf.soapAction === '' || conf.soapAction == null ? '""' : `"${conf.soapAction}"`,
      'User-Agent': 'UC-Juridico-MNI/0.6'
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
  const parsed = parseAvisosPendentes(text);
  const result = { sucesso: parsed.sucesso !== false, elapsedMs: elapsed, ...parsed, rawSize: text.length };
  if (debug) result.rawXml = text;
  return result;
}

// ============================================================
// consultarTeorComunicacao — busca o texto/documento da comunicação
// ============================================================
// Operação MNI 2.2.2. Recebe idAviso (idAviso do <aviso> retornado por
// consultarAvisosPendentes). Retorna o teor — pode vir como texto puro,
// HTML, base64 (PDF/binário) ou referência a documento.
async function consultarTeorComunicacao(conf, endpoint, { cpf, senha, idAviso, cnjAviso, debug }) {
  // Projudi/TJGO exige parâmetros no namespace tipos-servico-intercomunicacao-2.2.2.
  // Schema XSD (revelado pela faultstring) aceita:
  //   <tip:numeroProcesso>, <tip:senhaConsultante>, <tip:idConsultante>,
  //   <tip:identificadorAviso>  ← 'i' MINÚSCULO no XML (a mensagem de erro
  //   do business logic mostra com 'I' maiúsculo, mas o schema é minúsculo)
  const NS_TIPOS = 'http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2';
  const cnjFormatado = cnjAviso || '';                       // mantém pontuação
  const cnjDigitos = String(cnjAviso || '').replace(/\D/g, ''); // só dígitos
  // Variantes tentadas em ordem. Projudi/TJGO faultstring confirmou schema:
  //   numeroProcesso, senhaConsultante, idConsultante, identificadorAviso (i minúsculo)
  // Servidor exige numeroProcesso + identificadorAviso casarem — tenta 2 formatos.
  const variantes = [];
  if (cnjFormatado) {
    variantes.push({
      nome: 'CNJ-pontuado',
      body: `<tip:numeroProcesso>${escapeXml(cnjFormatado)}</tip:numeroProcesso>\n      <tip:identificadorAviso>${escapeXml(idAviso)}</tip:identificadorAviso>`
    });
  }
  if (cnjDigitos && cnjDigitos !== cnjFormatado) {
    variantes.push({
      nome: 'CNJ-digitos',
      body: `<tip:numeroProcesso>${escapeXml(cnjDigitos)}</tip:numeroProcesso>\n      <tip:identificadorAviso>${escapeXml(idAviso)}</tip:identificadorAviso>`
    });
  }
  // Fallback: sem numeroProcesso (caso o tribunal aceite só identificador)
  variantes.push({
    nome: 'apenas-identificadorAviso',
    body: `<tip:identificadorAviso>${escapeXml(idAviso)}</tip:identificadorAviso>`
  });

  const tentativas = [];
  for (const v of variantes) {
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:int="${conf.namespace}"
  xmlns:tip="${NS_TIPOS}">
  <soap:Header/>
  <soap:Body>
    <int:consultarTeorComunicacao>
      <tip:idConsultante>${escapeXml(cpf)}</tip:idConsultante>
      <tip:senhaConsultante>${escapeXml(senha)}</tip:senhaConsultante>
      ${v.body}
    </int:consultarTeorComunicacao>
  </soap:Body>
</soap:Envelope>`;
    const t0 = Date.now();
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': conf.soapAction === '' || conf.soapAction == null ? '""' : `"${conf.soapAction}"`,
        'User-Agent': 'UC-Juridico-MNI/0.7'
      },
      body: envelope
    });
    const elapsed = Date.now() - t0;
    const text = await resp.text();
    tentativas.push({
      nome: v.nome,
      httpStatus: resp.status,
      elapsedMs: elapsed,
      snippet: text.slice(0, 1500)  // aumentado pra ver faultstring completa
    });

    if (!resp.ok) continue;

    const fault = extractFault(text);
    if (fault) {
      if (/par[âa]metro|expected|unexpected element|elemento\s+inesperado|argument|unmarshalling/i.test(fault)) continue;
      return { sucesso: false, erro: 'soap_fault', mensagem: fault, elapsedMs: elapsed, raw: text.slice(0, 4000), tentativas };
    }

    const parsed = parseTeorComunicacao(text);
    // Se o servidor retornou sucesso=false com mensagens conhecidas de
    // formato/validação de parâmetro, tenta próxima variante.
    if (parsed.sucesso === false && (
      /(par[âa]metro|argumento)\s+\S+\s+(n[ãa]o\s+foi\s+informad|obrigat[óo]ri|inv[áa]lid)/i.test(parsed.mensagem || '') ||
      /n[ãa]o\s+est[áa]\s+vinculad/i.test(parsed.mensagem || '')   // CNJ + identificador não casam
    )) {
      tentativas[tentativas.length - 1].sucessoFalse = parsed.mensagem;
      continue;
    }
    const result = { sucesso: parsed.sucesso !== false, elapsedMs: elapsed, parametroUsado: v.nome, ...parsed, rawSize: text.length };
    if (debug) result.rawXml = text;
    if (debug) result.tentativas = tentativas;
    return result;
  }

  // Todas as variantes falharam — retorna detalhes pra debug
  const ultima = tentativas[tentativas.length - 1];
  return {
    sucesso: false,
    erro: 'http_' + ultima.httpStatus,
    httpStatus: ultima.httpStatus,
    elapsedMs: ultima.elapsedMs,
    raw: ultima.snippet,
    tentativas,
    mensagem: `Tentei ${variantes.length} formatos de parâmetro (${variantes.map(v => v.nome).join(', ')}) com namespace tipos-servico-intercomunicacao-2.2.2. Todos falharam. Veja "tentativas" para faultstring completa.`
  };
}

// Parser tolerante de consultarTeorComunicacaoResposta.
// Schema do Projudi pode variar; possíveis caminhos pro teor:
//   <teorComunicacao>texto/html</teorComunicacao>
//   <comunicacao><teorComunicacao>...</teorComunicacao></comunicacao>
//   <documento><conteudo>base64</conteudo><tipoDocumento>PDF</tipoDocumento></documento>
//   <aviso idAviso="..."><texto>...</texto></aviso>
function parseTeorComunicacao(xml) {
  const sucessoTag = tagText(xml, 'sucesso');
  const mensagem = tagText(xml, 'mensagem');
  if (sucessoTag.toLowerCase() === 'false') {
    return { sucesso: false, mensagem: mensagem || '(sem mensagem)', teor: '' };
  }

  // Procura o teor em vários campos possíveis
  let teorTexto = '';
  let teorBase64 = '';
  let mimeType = '';
  let nomeDocumento = '';

  // 1) Tag direta <teorComunicacao> ou <teor>
  const teor1 = tagText(xml, 'teorComunicacao') || tagText(xml, 'teor') || tagText(xml, 'texto');
  if (teor1) teorTexto = _decodeXmlEntities(teor1);

  // 2) Documento estruturado: <documento> com <conteudo> base64 + <tipoDocumento>
  const docBlock = (xml.match(/<(?:\w+:)?documento\b[\s\S]*?<\/(?:\w+:)?documento>/i) || [''])[0];
  if (docBlock) {
    const conteudo = tagText(docBlock, 'conteudo') || tagText(docBlock, 'conteudoDocumento') || '';
    if (conteudo && /^[A-Za-z0-9+/=\s]+$/.test(conteudo.slice(0, 100))) {
      // Parece base64
      teorBase64 = conteudo.replace(/\s/g, '');
    } else if (conteudo) {
      teorTexto = teorTexto || _decodeXmlEntities(conteudo);
    }
    mimeType = tagText(docBlock, 'tipoDocumento') || tagText(docBlock, 'mimetype') || tagText(docBlock, 'mimeType') || '';
    nomeDocumento = tagText(docBlock, 'descricao') || tagText(docBlock, 'nome') || '';
    // Atributos comuns
    if (!mimeType) mimeType = (docBlock.match(/\bmimetype="([^"]*)"/i) || [])[1] || '';
    if (!nomeDocumento) nomeDocumento = (docBlock.match(/\bdescricao="([^"]*)"/i) || [])[1] || '';
  }

  // 3) Atributo de teor em <conteudo>
  if (!teorTexto && !teorBase64) {
    const conteudoTag = tagText(xml, 'conteudo');
    if (conteudoTag) {
      if (/^[A-Za-z0-9+/=\s]+$/.test(conteudoTag.slice(0, 100)) && conteudoTag.length > 200) {
        teorBase64 = conteudoTag.replace(/\s/g, '');
      } else {
        teorTexto = _decodeXmlEntities(conteudoTag);
      }
    }
  }

  // Retorna estrutura unificada
  return {
    sucesso: true,
    teor: teorTexto,                    // texto plain / HTML decodificado
    teorBase64: teorBase64,             // base64 (PDF binário) se for o caso
    mimeType: mimeType || (teorBase64 ? 'application/pdf' : 'text/plain'),
    nomeDocumento,
    formato: teorBase64 ? 'base64' : (teorTexto && /<\w+/.test(teorTexto) ? 'html' : 'texto'),
    tamanhoTexto: teorTexto.length,
    tamanhoBase64: teorBase64.length
  };
}

// Mapeia código curto de tipo de comunicação (Projudi) → nome legível.
function _mapTipoComunicacao(codigo) {
  const map = {
    INT: 'Intimação', CIT: 'Citação', VIS: 'Vista', NOT: 'Notificação',
    OFC: 'Ofício', CAR: 'Carta', MAN: 'Mandado', EDI: 'Edital', COM: 'Comunicação'
  };
  return map[String(codigo || '').toUpperCase()] || codigo || 'Comunicação';
}

// Parser de consultarAvisosPendentesResposta.
// Schema real do Projudi/TJGO (validado 12/05/2026):
//   <ns2:aviso idAviso="..." tipoComunicacao="INT">
//     <ns3:destinatario>...</ns3:destinatario>  (opcional, em VIS)
//     <ns3:processo numero="..." classeProcessual="..." nivelSigilo="...">
//       <ns3:polo polo="AT|PA|TC">...</ns3:polo>
//       <ns3:assunto principal="true"><ns3:assuntoLocal descricao="..."/></ns3:assunto>
//       <ns3:magistradoAtuante>...</ns3:magistradoAtuante>
//       <ns3:prioridade>N-Texto</ns3:prioridade>
//       <ns3:outroParametro nome="Area|Serventia|ProcessoFase|..." valor="..."/>
//       <ns3:valorCausa>...</ns3:valorCausa>
//       <ns3:orgaoJulgador nomeOrgao="..." codigoMunicipioIBGE="..."/>
//     </ns3:processo>
//     <ns3:dataDisponibilizacao>YYYYMMDDHHMMSS</ns3:dataDisponibilizacao>
//   </ns2:aviso>
// NOTA: o Projudi NÃO retorna prazo nem teor aqui — pra ver o teor da
// comunicação seria preciso consultarTeorComunicacao (operação separada).
function parseAvisosPendentes(xml) {
  const sucessoTag = tagText(xml, 'sucesso');
  const mensagem = tagText(xml, 'mensagem');
  if (sucessoTag.toLowerCase() === 'false') {
    return { sucesso: false, mensagem: mensagem || '(sem mensagem)', avisos: [], avisosTotal: 0 };
  }
  const avisos = [];
  const avisoBlocks = xml.match(/<(?:\w+:)?aviso\b[^>]*>[\s\S]*?<\/(?:\w+:)?aviso>/gi) || [];
  for (const b of avisoBlocks) {
    // Atributos do <aviso>
    const idAviso = (b.match(/<(?:\w+:)?aviso\b[^>]*\bidAviso="([^"]*)"/) || [])[1] || '';
    const tipoCodigo = (b.match(/<(?:\w+:)?aviso\b[^>]*\btipoComunicacao="([^"]*)"/) || [])[1] || '';

    // Bloco <processo>
    const procBlock = (b.match(/<(?:\w+:)?processo\b[\s\S]*?<\/(?:\w+:)?processo>/i) || [b])[0];
    const procOpen = (procBlock.match(/<(?:\w+:)?processo\b[^>]*>/i) || [''])[0];
    const numeroProcesso = (procOpen.match(/\bnumero="([^"]*)"/) || [])[1] || '';
    const classeProcessual = (procOpen.match(/\bclasseProcessual="([^"]*)"/) || [])[1] || '';
    const nivelSigilo = (procOpen.match(/\bnivelSigilo="([^"]*)"/) || [])[1] || '';

    // orgaoJulgador (atributos)
    const nomeOrgao = tagAttr(procBlock, 'orgaoJulgador', 'nomeOrgao') || '';
    const codigoMunicipioIBGE = tagAttr(procBlock, 'orgaoJulgador', 'codigoMunicipioIBGE') || '';

    // magistrado, prioridade, valorCausa
    const magistradoAtuante = tagText(procBlock, 'magistradoAtuante') || '';
    const prioridade = tagText(procBlock, 'prioridade') || '';
    const valorCausa = tagText(procBlock, 'valorCausa') || '';

    // assunto principal (descrição do assuntoLocal)
    const assuntoBlock = (procBlock.match(/<(?:\w+:)?assunto\b[^>]*\bprincipal="true"[\s\S]*?<\/(?:\w+:)?assunto>/i)
      || procBlock.match(/<(?:\w+:)?assunto\b[\s\S]*?<\/(?:\w+:)?assunto>/i) || [''])[0];
    const assuntoDescricao = _decodeXmlEntities(tagAttr(assuntoBlock, 'assuntoLocal', 'descricao') || '');
    const assuntoCodigoNacional = tagText(assuntoBlock, 'codigoNacional') || '';

    // outroParametro
    const outros = {};
    const opMatches = procBlock.matchAll(/<(?:\w+:)?outroParametro\b[^>]*\bnome="([^"]*)"[^>]*\bvalor="([^"]*)"[^>]*\/?>/g);
    for (const m of opMatches) outros[m[1]] = _decodeXmlEntities(m[2]);
    const area = outros.Area || '';
    const serventia = outros.Serventia || '';
    const processoFase = outros.ProcessoFase || '';
    const processoStatus = outros.ProcessoStatus || '';
    const processoTipo = outros.ProcessoTipo || '';
    const dataDistRaw = outros.DataDistribuicao || '';

    // dataDisponibilizacao — elemento dentro de <aviso>, formato YYYYMMDDHHMMSS
    const dispRaw = (tagText(b, 'dataDisponibilizacao') || '').replace(/\D/g, '');
    const dataDisp = dispRaw.length >= 8 ? `${dispRaw.slice(0,4)}-${dispRaw.slice(4,6)}-${dispRaw.slice(6,8)}` : '';
    const horaDisp = dispRaw.length >= 12 ? `${dispRaw.slice(8,10)}:${dispRaw.slice(10,12)}` : '';

    // Destinatário (presente em alguns VIS) — primeira pessoa
    const destBlock = (b.match(/<(?:\w+:)?destinatario\b[\s\S]*?<\/(?:\w+:)?destinatario>/i) || [''])[0];
    const destinatario = (destBlock.match(/<(?:\w+:)?pessoa\b[^>]*\bnome="([^"]*)"/) || [])[1] || '';

    avisos.push({
      idAviso,
      idComunicacao: idAviso,                  // alias pra compat
      tipoComunicacao: _mapTipoComunicacao(tipoCodigo),
      tipoComunicacaoCodigo: tipoCodigo,
      numeroProcesso,
      classeProcessual,
      nivelSigilo,
      nomeOrgao,
      codigoMunicipioIBGE,
      magistradoAtuante,
      prioridade,
      valorCausa,
      assunto: { codigoNacional: assuntoCodigoNacional, descricao: assuntoDescricao },
      area,
      serventia,
      processoFase,
      processoStatus,
      processoTipo,
      dataDistribuicao: dataDistRaw && dataDistRaw.length >= 8
        ? `${dataDistRaw.slice(0,4)}-${dataDistRaw.slice(4,6)}-${dataDistRaw.slice(6,8)}` : '',
      dataDisponibilizacao: dataDisp,          // YYYY-MM-DD (date-only — fácil pro cálculo de prazo)
      horaDisponibilizacao: horaDisp,          // HH:MM
      destinatario,
      // Projudi não retorna estes nesse SOAP:
      prazo: '',
      meio: '',
      teor: ''
    });
  }
  // Ordena por data disponibilização desc
  avisos.sort((a, b) => (b.dataDisponibilizacao || '').localeCompare(a.dataDisponibilizacao || ''));
  return { sucesso: true, avisos: avisos.slice(0, 200), avisosTotal: avisos.length };
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
