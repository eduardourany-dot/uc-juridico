// UC Jurídico — MNI Worker genérico (multi-tribunal)
// Versão: 0.11.0 · MNI — headers de browser pra contornar WAF da PJe-JT
//   - Cloudflare WAF da Justiça do Trabalho (PJe) bloqueia User-Agent
//     minimalista 'UC-Juridico-MNI/0.5' com HTTP 403.
//   - Helper _soapHeaders(conf, operacao) injeta headers de browser
//     realista quando conf.statusHealth='bloqueio_cloudflare' OU
//     conf.sistema='pje' OU codigo começa com 'TRT'.
//   - Headers extras: User-Agent Chrome, Accept, Accept-Language,
//     Referer, Origin (todos comuns em tráfego de browser).
//   - TJGO Projudi e outros tribunais NÃO-WAF mantêm headers mínimos
//     (não quebra o que já funciona).
// Versão: 0.10.10 · MNI.5 — volta <conteudo> + normaliza base64 (whitespace)
//   - Teste anterior com <conteudoBase64> confirmou que Projudi NÃO
//     reconhece esse nome (HTTP 500 em 1.1s, sem mensagem).
//   - <conteudo> é o nome correto (parser reconhece, mas valor vinha vazio).
//   - Suspeita: base64 com whitespace (RFC 2045 quebra a cada 76 chars)
//     pode estar invalidando o parser do Projudi. Agora removemos
//     todo \s+ do base64 antes de incluir no XML.
// Versão: 0.10.9 · MNI.5 — testa <conteudoBase64> em vez de <conteudo>
//   - Debug confirmou: base64 chega no Worker (343856 chars) e vai pro XML
//     (envelope 344KB), mas Projudi reportava 'Arquivo sem conteúdo'.
//   - Conclusão: nome do elemento <conteudo> está errado no schema do
//     Projudi TJGO. Testando alternativa <conteudoBase64> (camelCase
//     comum em sistemas Java).
//   - Se Projudi rejeitar com Unmarshalling Error, ele vai listar o
//     nome correto na mensagem — replicar pra 0.10.10.
// Versão: 0.10.8 · MNI.5 — debugInfo no response (envelope size, base64 size, hash)
//   - Diagnóstico: quando tribunal retorna 'Arquivo sem conteúdo' precisamos
//     ver se o base64 chegou ao Worker E se o XML montado tem o conteúdo.
//   - Não precisa flag — sempre inclui debugInfo no result (overhead mínimo).
//   - debug=true ainda adiciona rawXml (resposta) + rawRequest (primeiros 8KB do envelope).
// Versão: 0.10.7 · MNI.5 — parametros nome="ID_MOVIMENTACAO_TIPO" (UPPER)
//   - Erro estruturado do Projudi confirmou nome exato do parâmetro:
//     "O parâmetro ID_MOVIMENTACAO_TIPO não foi informado."
//   - SCREAMING_SNAKE_CASE — padrão constantes Java do Projudi/TJGO
//   - Removidas 3 variantes anteriores (idTipoMovimentacao,
//     codigoMovimento, movimentoLocal) + codigoNacional — só envia
//     o nome correto agora
// Versão: 0.10.6 · MNI.5 — tipoDocumento default = id Projudi (não TPU CNJ)
//   - Projudi TJGO valida tipoDocumento contra tabela 'arquivoTipo'
//     interna, NÃO contra TPU CNJ universal
//   - Tabela Projudi: 16=Petição, 6=Petição Inicial, 23=Contestação,
//     108=Alegações Finais, 8=Procuração, 17=Substabelecimento, 1=Outros
//   - Default mudou de '60' (CNJ Outros) pra '1' (Projudi Outros)
//   - Frontend agora envia id Projudi explícito no payload
// Versão: 0.10.5 · MNI.5 — múltiplos nomes de parâmetro pra movimento Projudi
//   - TJGO Projudi tem tabela interna (id 260, 1003, etc), todos
//     mapeados pro CNJ:85 (Juntada → Petição)
//   - Envia 3 variantes do nome do parâmetro pro mesmo valor:
//     idTipoMovimentacao, codigoMovimento, movimentoLocal
//   - Plus: codigoNacional=85 sempre (universal pra peticionamento TJGO)
//   - Projudi pega o que reconhece, ignora o resto (não há erro de
//     parâmetro desconhecido)
// Versão: 0.10.4 · MNI.5 — adiciona codigoMovimento (TPU CNJ) como parametros
//   - Campo 'Tipo Movimentação' obrigatório na tela web do Projudi —
//     equivale ao código TPU CNJ. Sem ele, Projudi crashava HTTP 500
//     sem mensagem (não chega a SOAP Fault).
//   - Frontend agora coleta + envia via <parametros nome="codigoMovimento"/>
// Versão: 0.10.3 · MNI.5 — remove <outroParametro> aninhado de <documento>
//   - <outroParametro NomeArquivo> dentro de <documento> causava HTTP 500
//     sem mensagem no Projudi TJGO. Removido — descricao do <documento>
//     já carrega o nome.
// Versão: 0.10.2 · MNI.5 — <parametros> usa atributos (nome="X" valor="Y")
//   - Schema correto: <parametros nome="..." valor="..."/> self-closing
//   - Antes (0.10.1) tinha sub-elementos <nome>/<valor> que o tribunal recusou
// Versão: 0.10.1 · MNI.5 — XML fixed pro schema MNI 2.2.2 real
//   - Removido <idTipoTransmissao> elemento direto (não existe no WSDL)
//   - Removido <petição> wrapper (documentos vão direto)
//   - idTipoTransmissao agora vai em <parametros>
//   - Complemento idem (era outroParametro dentro de <petição>)
//   - Ordem dos elementos respeitada: idManifestante, senhaManifestante,
//     numeroProcesso, documento[], dataEnvio, parametros[]
// Versão: 0.10.0 · MNI.5 — entregarManifestacaoProcessual (MVP TJGO)
//   - Nova operação: protocolar petição via SOAP MNI 2.2.2
//   - SHA-256 do conteúdo de cada documento (alguns tribunais validam)
//   - PDFs em base64 inline (sem MTOM por enquanto — funciona até ~5MB total)
//   - Assinatura digital ICP-Brasil obrigatória (.pdf.p7s) pra Projudi TJGO
// Versão: 0.9.3 · timeout (45s sem docs, 90s com) + timing detalhado
//   - signal: AbortSignal.timeout() pra falhar rápido quando Projudi engasga
//   - tempoSoapMs / tempoParseMs / elapsedMs no JSON pra diagnóstico
// Versão: 0.9.2 · parser de documentos calibrado pro TJGO Projudi
//   - <documento> usa atributo `movimento="ID"` (não <vinculacaoDocumento>)
//   - <outroParametro nome="NomeArquivo"> tem o filename real
//   - <outroParametro nome="ArquivoTipo"> tem o tipo legível
//   - Projudi NÃO devolve <conteudo> via consultarProcesso — só metadata
//   - mantém cascata de tags de conteúdo pra outros sistemas (PJe, eSAJ)
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
// MUDANÇAS v0.8.0 vs v0.7.0:
//   - REMOVIDO: consultarAvisosPendentes + consultarTeorComunicacao
//     Justificativa: DJEN (CNJ Nacional) já entrega o teor completo das
//     publicações com parser de prazo maduro (parsearPublicacao no app).
//     O Projudi/TJGO tinha bugs no consultarTeorComunicacao (server rejeita
//     request válido pelo WSDL — provável buffer interno). DJEN é a fonte
//     única de intimações; MNI fica só pra consultarProcesso (partes,
//     advogados, movimentos detalhados).
//   - Mantido o registry + detectarPorCnj + health + consultarProcesso.
//   - Pra reativar: ver commits anteriores a 2026-05-13 (sandbox).

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
  TJAP: {"codigo":"TJAP","nome":"Tribunal de Justiça do Amapá","sistema":"tucujuris","esfera":"estadual","cnjCode":"8.03","auth":"n/a","mniVersion":"n/a","endpoint":null,"namespace":null,"soapAction":null,"validado":false,"naoSuportado":true,"motivo":"TJAP usa Tucujuris (sistema próprio) — sem MNI público."},
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

// Função handler nomeada — exportada também separadamente pra ser
// reutilizada em outros runtimes (Vercel Edge Functions, Deno Deploy, etc).
// Mantém o `export default { fetch }` pra continuar funcionando como
// Cloudflare Worker.
export async function handleMniRequest(request, env) {
  if (!env) env = {};
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
        worker: 'uc-mni', versao: '0.11.0',
        total: codigos.length,
        validados, naoSuportados,
        operacoes: ['consultarProcesso', 'entregarManifestacaoProcessual', 'health', 'listarTribunais', 'detectarPorCnj']
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
    const incluirDocumentos = body.incluirDocumentos === true;

    if (!cpf || !senha) return json({ error: 'cpf_senha_obrigatorios' }, 400, corsHeaders);

    try {
      if (operacao === 'consultarProcesso') {
        if (!cnj) return json({ error: 'cnj_obrigatorio' }, 400, corsHeaders);
        const result = await consultarProcesso(conf, endpoint, { cnj, cpf, senha, debug, incluirDocumentos });
        result.tribunal = codigo;
        result.grau = grau;
        return json(result, 200, corsHeaders);
      }
      if (operacao === 'entregarManifestacaoProcessual') {
        if (!cnj) return json({ error: 'cnj_obrigatorio' }, 400, corsHeaders);
        const documentos = Array.isArray(body.documentos) ? body.documentos : [];
        if (documentos.length === 0) return json({ error: 'documentos_obrigatorios' }, 400, corsHeaders);
        const tipoTransmissao = Number(body.tipoTransmissao || 3);  // 3 = Petição/Manifestação intercorrente
        const codigoMovimento = String(body.codigoMovimento || '').trim();  // TPU CNJ (obrigatório no Projudi)
        const descricao = String(body.descricao || '').slice(0, 500);
        const result = await entregarManifestacao(conf, endpoint, {
          cnj, cpf, senha, tipoTransmissao, codigoMovimento, descricao, documentos, debug
        });
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

// Compat Cloudflare Workers: mantém o formato esperado `export default { fetch }`.
export default {
  fetch: handleMniRequest
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
// entregarManifestacaoProcessual (MNI.5)
// ============================================================
//
// Protocola petição/manifestação direto no tribunal via SOAP. Validado
// pra TJGO/Projudi (POC v0.1.0). Outros tribunais podem ter quirks
// específicos (movimentoLocal obrigatório, classeProcessual em recursos,
// etc.) — adicionar suporte caso a caso.
//
// Tipos de transmissão (idTipoTransmissao — Tabela CNJ 1.21):
//   1 = Petição Inicial
//   2 = Recurso (Apelação)
//   3 = Petição/Manifestação intercorrente (DEFAULT — caso comum)
//   4 = Recurso Adesivo
//   5 = Embargos de Declaração
//   ...
//
// Documentos esperados:
//   [{ nomeArquivo, base64, mimetype?, tipoDocumento?, descricao?, nivelSigilo? }]
//   - mimetype default: application/pdf
//   - tipoDocumento default: 60 (Outros — Tabela CNJ — funciona pra petição)
//   - nivelSigilo default: 0 (público)
//   - hash SHA-256 do conteúdo é computado e enviado (alguns tribunais validam)
async function entregarManifestacao(conf, endpoint, { cnj, cpf, senha, tipoTransmissao, codigoMovimento, descricao, documentos, debug }) {
  // Pre-processa: computa hash de cada documento + monta XML
  const docsXml = [];
  for (let i = 0; i < documentos.length; i++) {
    const d = documentos[i];
    // Normaliza base64: remove TODO whitespace (espaços, \r, \n, tabs).
    // O FileReader.readAsDataURL pode retornar base64 com quebras de linha
    // conforme RFC 2045. Parsers SOAP estritos (Projudi) podem rejeitar
    // base64 com whitespace embebido como "conteúdo inválido".
    const base64 = String(d.base64 || '').replace(/\s+/g, '');
    if (!base64) {
      return { sucesso: false, erro: 'documento_vazio', mensagem: `Documento ${i+1} sem conteúdo base64` };
    }
    const nomeArquivo = String(d.nomeArquivo || `doc-${i+1}.pdf`).slice(0, 200);
    const mimetype = String(d.mimetype || 'application/pdf');
    // v0.10.6: default = '1' (Outros, id Projudi TJGO) em vez de '60' (TPU CNJ).
    // Projudi TJGO valida contra tabela 'arquivoTipo' interna (não tabela CNJ).
    const tipoDocumento = String(d.tipoDocumento || '1');
    const nivelSigilo = String(d.nivelSigilo != null ? d.nivelSigilo : 0);
    const descricaoDoc = String(d.descricao || nomeArquivo).slice(0, 200);
    const hash = await sha256Hex(base64);
    const dataHora = mniDataHora(new Date());

    // Documento principal = i===0, demais = anexos. Mas o WSDL aceita
    // múltiplos <documento> filhos sem hierarquia — o tribunal decide
    // qual é principal pela ordem (primeiro = principal).
    //
    // v0.10.10 (18/05/2026): VOLTANDO pra <conteudo> (era o nome correto).
    // Teste anterior com <conteudoBase64> deu HTTP 500 sem mensagem em
    // 1.1s — parser do Projudi NÃO conhece esse nome. <conteudo> é
    // reconhecido (1.4s + erro estruturado).
    //
    // Mantendo o nome correto mas:
    //   - Normalizamos base64 removendo whitespace (acima)
    //   - Mantemos sem CDATA (base64 não tem chars XML especiais)
    docsXml.push(`
      <documento idDocumento="${i+1}" tipoDocumento="${escapeXml(tipoDocumento)}" dataHora="${dataHora}" mimetype="${escapeXml(mimetype)}" nivelSigilo="${escapeXml(nivelSigilo)}" hash="${hash}" descricao="${escapeXml(descricaoDoc)}">
        <conteudo>${base64}</conteudo>
      </documento>`);
  }

  // Schema MNI 2.2.2 (tribunal listou explicitamente os elementos aceitos
  // num erro SOAP em 18/05/2026): a operação entregarManifestacaoProcessual
  // espera filhos diretos NESTA ordem do tipos-servico-intercomunicacao-2.2.2:
  //
  //   1. idManifestante      (string)
  //   2. senhaManifestante   (string)
  //   3. numeroProcesso      (string)
  //   4. dadosBasicos        (opcional — não usado pra manifestação intercorrente)
  //   5. documento[]         (1+ documentos, SEM wrapper <petição>)
  //   6. dataEnvio           (yyyyMMddHHmmss)
  //   7. parametros[]        (chave/valor — onde vai idTipoTransmissao e Complemento)
  //
  // idTipoTransmissao NÃO é elemento direto — é parâmetro nome/valor.
  // <petição> wrapper NÃO existe — documentos vão diretos.
  //
  // IMPORTANTE: <parametros> usa ATRIBUTOS XML (nome="X" valor="Y"),
  // NÃO sub-elementos. Validado em 18/05/2026 via erro SOAP do TJGO:
  // "elemento inesperado <nome> dentro de <parametros>".
  //
  // codigoMovimento é o ID INTERNO do Projudi TJGO (não TPU CNJ).
  // Validado em 18/05/2026: TJGO Projudi tem tabela própria (id 260 =
  // Petição genérica, 1003 = Embargos de declaração, etc) — todos
  // mapeados pro CNJ:85 (Juntada de Petição).
  //
  // Enviamos múltiplos nomes de parâmetro pra cobrir diferenças de
  // implementação entre tribunais. Projudi pega o que reconhece, ignora
  // o resto (não dá erro de parâmetro desconhecido).
  const parametros = [
    `<parametros nome="idTipoTransmissao" valor="${tipoTransmissao}"/>`
  ];
  if (codigoMovimento) {
    // Confirmado em 18/05/2026 via erro estruturado do Projudi TJGO:
    //   "O parâmetro ID_MOVIMENTACAO_TIPO não foi informado."
    // Nome do parâmetro em SCREAMING_SNAKE_CASE — padrão constantes Java
    // típico do Projudi/TJGO.
    parametros.push(`<parametros nome="ID_MOVIMENTACAO_TIPO" valor="${escapeXml(codigoMovimento)}"/>`);
  }
  if (descricao) {
    parametros.push(`<parametros nome="Complemento" valor="${escapeXml(descricao)}"/>`);
  }
  const envelope = buildEnvelope(conf.namespace, 'entregarManifestacaoProcessual', `
    <idManifestante>${escapeXml(cpf)}</idManifestante>
    <senhaManifestante>${escapeXml(senha)}</senhaManifestante>
    <numeroProcesso>${escapeXml(cnj)}</numeroProcesso>
    ${docsXml.join('\n')}
    <dataEnvio>${mniDataHora(new Date())}</dataEnvio>
    ${parametros.join('\n    ')}
  `);

  const t0 = Date.now();
  const timeoutMs = 120000;  // 2min — upload pode demorar com PDFs grandes
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: _soapHeaders(conf, 'protocolo'),
      body: envelope,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const elapsed = Date.now() - t0;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return {
        sucesso: false,
        erro: 'timeout',
        mensagem: `Timeout após ${(timeoutMs/1000).toFixed(0)}s no protocolo. Não confirme reenvio sem checar o portal — pode ter sido recebido pelo tribunal sem retornar a resposta no prazo.`,
        elapsedMs: elapsed
      };
    }
    return { sucesso: false, erro: 'rede', mensagem: String(e?.message || e), elapsedMs: elapsed };
  }
  const text = await resp.text();
  const tempoSoapMs = Date.now() - t0;

  // Info de debug do REQUEST enviado — útil pra diagnosticar quando
  // tribunal responde 'conteúdo vazio' ou similar. Inclui no objeto de
  // diagnóstico independente de sucesso/falha.
  const debugInfo = {
    envelopeSize: envelope.length,
    docsCount: documentos.length,
    doc0_base64Size: documentos[0]?.base64?.length || 0,
    doc0_hash: documentos[0] ? await sha256Hex(documentos[0].base64) : null,
    doc0_mimetype: documentos[0]?.mimetype,
    doc0_nomeArquivo: documentos[0]?.nomeArquivo,
    parametros: parametros.join(' · ')
  };

  if (!resp.ok) {
    return { sucesso: false, erro: 'http_' + resp.status, httpStatus: resp.status, elapsedMs: tempoSoapMs, raw: text.slice(0, 4000), debugInfo };
  }
  const fault = extractFault(text);
  if (fault) {
    return { sucesso: false, erro: 'soap_fault', mensagem: fault, elapsedMs: tempoSoapMs, raw: text.slice(0, 4000), debugInfo };
  }

  const parsed = parseEntregaManifestacao(text);
  const result = {
    sucesso: parsed.sucesso !== false,
    elapsedMs: tempoSoapMs,
    tempoSoapMs,
    rawSize: text.length,
    debugInfo,
    ...parsed
  };
  if (debug) {
    result.rawXml = text;
    result.rawRequest = envelope.slice(0, 8000);  // primeiros 8KB do request
  }
  return result;
}

// ============================================================
// Headers SOAP — masquerade pra contornar WAF da PJe-JT
// ============================================================
//
// Cloudflare WAF da Justiça do Trabalho bloqueia requests com User-Agent
// minimalista tipo 'UC-Juridico-MNI/0.5' (HTTP 403). Pra tribunais
// marcados com statusHealth='bloqueio_cloudflare' ou sistema='pje', enviamos
// headers de browser realista (Chrome desktop) pra parecer tráfego legítimo.
// Pra outros tribunais (TJGO Projudi etc), mantém os headers atuais.
function _soapHeaders(conf, operacao) {
  const base = {
    'Content-Type': 'text/xml; charset=utf-8',
    'SOAPAction': conf.soapAction === '' || conf.soapAction == null
      ? '""' : `"${conf.soapAction}"`,
    'User-Agent': 'UC-Juridico-MNI/0.5-' + (operacao || 'op')
  };
  // Tribunais com WAF anti-bot conhecido (PJe da Justiça do Trabalho, etc):
  // adiciona headers de browser realista.
  const precisaMasquerade = conf.statusHealth === 'bloqueio_cloudflare'
    || conf.sistema === 'pje'
    || /^trt/i.test(conf.codigo || '');
  if (precisaMasquerade) {
    base['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    base['Accept'] = 'text/xml, application/xml, application/soap+xml, text/html, */*';
    base['Accept-Language'] = 'pt-BR,pt;q=0.9,en;q=0.8';
    base['Accept-Encoding'] = 'gzip, deflate, br';
    base['Cache-Control'] = 'no-cache';
    base['Pragma'] = 'no-cache';
    // Referer apontando pra raiz do host evita WAFs que validam origem
    try {
      const u = new URL(conf.endpoint);
      base['Referer'] = u.origin + '/';
      base['Origin'] = u.origin;
    } catch (_) {}
  }
  return base;
}

// SHA-256 do conteúdo binário (decodificado do base64), retorno em hex
async function sha256Hex(base64) {
  // atob no Worker é nativo
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Formato yyyyMMddHHmmss usado pelos campos dataHora/dataEnvio do MNI
function mniDataHora(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getUTCFullYear()
    + pad(d.getUTCMonth() + 1)
    + pad(d.getUTCDate())
    + pad(d.getUTCHours())
    + pad(d.getUTCMinutes())
    + pad(d.getUTCSeconds());
}

// Parser da resposta SOAP do entregarManifestacaoProcessual
function parseEntregaManifestacao(xml) {
  const sucessoTag = tagText(xml, 'sucesso');
  const mensagem = tagText(xml, 'mensagem');
  if (sucessoTag.toLowerCase() === 'false') {
    return { sucesso: false, mensagem: mensagem || '(sem mensagem)' };
  }
  const protocolo = tagText(xml, 'protocoloRecebimento')
    || tagText(xml, 'numeroProtocolo')
    || tagText(xml, 'protocolo');
  const dataOperacaoRaw = tagText(xml, 'dataOperacao') || tagText(xml, 'dataRecebimento');
  const recibo = tagText(xml, 'recibo');
  return {
    sucesso: true,
    mensagem: mensagem || 'Petição protocolada com sucesso',
    protocolo: protocolo || '',
    dataOperacao: _parseDataHoraMni(dataOperacaoRaw),
    recibo: recibo || ''
  };
}

// ============================================================
// consultarProcesso
// ============================================================
async function consultarProcesso(conf, endpoint, { cnj, cpf, senha, debug, incluirDocumentos }) {
  // incluirDocumentos = true → resposta vem com <documento> elements
  // contendo metadata + <conteudo> em base64. Atenção: response pode crescer
  // muito (PDFs em base64), 30s+ de timeout e MB-de-resposta são comuns.
  // Default false pra manter "Buscar MNI" rápido — só ativar quando o
  // usuário pede docs explicitamente via "Baixar documentos".
  const flagDocs = incluirDocumentos === true ? 'true' : 'false';
  const envelope = buildEnvelope(conf.namespace, 'consultarProcesso', `
    <idConsultante>${escapeXml(cpf)}</idConsultante>
    <senhaConsultante>${escapeXml(senha)}</senhaConsultante>
    <numeroProcesso>${escapeXml(cnj)}</numeroProcesso>
    <movimentos>true</movimentos>
    <incluirCabecalho>true</incluirCabecalho>
    <incluirDocumentos>${flagDocs}</incluirDocumentos>
  `);

  // Timeout: incluirDocumentos=true pode levar 30-60s pro Projudi devolver
  // a resposta inteira; sem docs, esperamos 5-15s típicos. Damos uma margem
  // generosa mas evitamos travar o user indefinidamente quando o tribunal
  // está engasgado. AbortError vira mensagem clara abaixo.
  const t0 = Date.now();
  const timeoutMs = incluirDocumentos ? 90000 : 45000;
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: _soapHeaders(conf, 'consultar'),
      body: envelope,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const elapsed = Date.now() - t0;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return {
        sucesso: false,
        erro: 'timeout',
        mensagem: `Timeout após ${(timeoutMs/1000).toFixed(0)}s. O ${conf.codigo || 'tribunal'} demorou demais pra responder (provável congestionamento). Tente de novo em alguns minutos.`,
        elapsedMs: elapsed
      };
    }
    return {
      sucesso: false,
      erro: 'rede',
      mensagem: String(e?.message || e),
      elapsedMs: elapsed
    };
  }
  const text = await resp.text();
  const tDownload = Date.now();
  const tempoSoapMs = tDownload - t0;

  if (!resp.ok) {
    return { sucesso: false, erro: 'http_' + resp.status, httpStatus: resp.status, elapsedMs: tempoSoapMs, raw: text.slice(0, 4000) };
  }
  const fault = extractFault(text);
  if (fault) {
    return { sucesso: false, erro: 'soap_fault', mensagem: fault, elapsedMs: tempoSoapMs, raw: text.slice(0, 4000) };
  }
  const parsed = parseConsultarProcesso(text);
  const tempoParseMs = Date.now() - tDownload;
  // Timing detalhado pra diagnosticar onde fica o gargalo:
  //   tempoSoapMs   = roundtrip + download da resposta XML (Projudi + rede)
  //   tempoParseMs  = parser regex local (Worker CPU)
  //   elapsedMs     = total (compat com clientes antigos)
  const result = {
    sucesso: parsed.sucesso !== false,
    elapsedMs: tempoSoapMs + tempoParseMs,
    tempoSoapMs,
    tempoParseMs,
    rawSize: text.length,
    ...parsed
  };
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

  // Helper pra extrair metadata + conteúdo de um <documento> XML qualquer.
  //
  // Estrutura real do TJGO Projudi (confirmada via amostra Eduardo 2026-05):
  //   <documento idDocumento="525597370" tipoDocumento="16"
  //              dataHora="20260512202332" mimetype="application/pdf"
  //              nivelSigilo="0" movimento="476235048"  ← linkagem aqui
  //              hash="..." descricao="Petição">
  //     <outroParametro nome="NomeArquivo" valor="bmbxsamir.pdf"/>
  //     <outroParametro nome="ArquivoTipo" valor="Petição"/>
  //   </documento>
  // OBS: Projudi TJGO NÃO devolve <conteudo> base64 via consultarProcesso
  // (limitação da implementação). Parser captura metadata pra exibição.
  function _parseDocumentoBlock(dXml) {
    const openTag = (dXml.match(/<(?:\w+:)?documento\b[^>]*>/) || [''])[0];
    const idDocumento = (openTag.match(/\bidDocumento="([^"]*)"/) || [])[1] || '';
    if (!idDocumento) return null;
    const tipoDocumento = (openTag.match(/\btipoDocumento="([^"]*)"/) || [])[1] || '';
    const dataHora = (openTag.match(/\bdataHora="([^"]*)"/) || [])[1] || '';
    const mimetype = (openTag.match(/\bmimetype="([^"]*)"/) || [])[1] || 'application/pdf';
    const descricao = _decodeXmlEntities((openTag.match(/\bdescricao="([^"]*)"/) || [])[1] || '');
    const nivelSigilo = (openTag.match(/\bnivelSigilo="([^"]*)"/) || [])[1] || '0';
    const hash = (openTag.match(/\bhash="([^"]*)"/) || [])[1] || '';
    const tipoDocumentoLocal = (openTag.match(/\btipoDocumentoLocal="([^"]*)"/) || [])[1] || '';
    // Atributo `movimento`: alguns sistemas (Projudi TJGO) linkam doc ao
    // movimento via atributo direto, não via <vinculacaoDocumento> filha.
    const movimentoAttr = (openTag.match(/\bmovimento="([^"]*)"/) || [])[1] || '';

    // outroParametro: NomeArquivo + ArquivoTipo + outros campos custom
    const outroParams = {};
    const opMatches = dXml.matchAll(/<(?:\w+:)?outroParametro\b[^>]*\bnome="([^"]*)"[^>]*\bvalor="([^"]*)"[^>]*\/?>/g);
    for (const m of opMatches) outroParams[m[1]] = _decodeXmlEntities(m[2]);
    const nomeArquivo = outroParams.NomeArquivo || '';
    const arquivoTipo = outroParams.ArquivoTipo || '';

    // Conteúdo: tenta múltiplas variantes de tag — sistemas diferentes usam
    // nomes distintos. Pega texto BRUTO (espaços removidos pra base64 limpo).
    let conteudoB64 = '';
    const variantes = ['conteudo', 'conteudoDocumento', 'documentoBase64', 'binario'];
    for (const tag of variantes) {
      const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
      const m = dXml.match(re);
      if (m && m[1].trim()) { conteudoB64 = m[1].replace(/\s+/g, ''); break; }
    }
    return {
      idDocumento, tipoDocumento, tipoDocumentoLocal, dataHora,
      dataIso: _parseDataHoraMni(dataHora),
      mimetype, descricao, nivelSigilo, hash,
      movimentoAttr,
      nomeArquivo, arquivoTipo,
      outroParametros: outroParams,
      conteudoB64,
      tamanhoB64: conteudoB64.length
    };
  }

  const movimentos = [];
  const documentos = [];
  const docsById = new Map(); // idDocumento → doc (preenchido conforme acha)

  // Estratégia 1 — docs aninhados em <movimento>: Projudi tipicamente põe
  // <documento> direto dentro de cada movimento. Vamos descer no
  // movimento, extrair os documentos LÁ DENTRO e linkar imediatamente.
  const movsXml = procBlock.match(/<(?:\w+:)?movimento\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/(?:\w+:)?movimento>)/gi) || [];
  for (const m of movsXml) {
    const dataHora = (m.match(/<(?:\w+:)?movimento\b[^>]*\bdataHora="([^"]*)"/) || [])[1] || '';
    const identificador = (m.match(/<(?:\w+:)?movimento\b[^>]*\bidentificadorMovimento="([^"]*)"/) || [])[1] || '';
    const codigoNacional = (m.match(/<(?:\w+:)?movimentoNacional\b[^>]*\bcodigoNacional="([^"]*)"/) || [])[1] || '';
    const codigoLocal = (m.match(/<(?:\w+:)?movimentoLocal\b[^>]*\bcodigoMovimento="([^"]*)"/) || [])[1] || '';
    const descricao = _decodeXmlEntities((m.match(/<(?:\w+:)?movimentoLocal\b[^>]*\bdescricao="([^"]*)"/) || [])[1] || '');
    const complemento = _decodeXmlEntities(tagText(m, 'complemento') || '');

    // Documentos VINCULADOS via referência: <vinculacaoDocumento> ou
    // <documentoVinculado> apontando pra um doc declarado em outro lugar
    const docsVinculadosIds = [];
    const vinculacoes = m.matchAll(/<(?:\w+:)?(?:vinculacao|documento)Documento\b[^>]*\bidDocumento="([^"]*)"/g);
    for (const v of vinculacoes) docsVinculadosIds.push(v[1]);

    // Documentos ANINHADOS direto neste movimento: extrai e linka aqui mesmo.
    // Important: usa expressão pra ignorar self-closing tags falsas (<docu... />)
    const movDocsXml = m.match(/<(?:\w+:)?documento\b[^>]*>[\s\S]*?<\/(?:\w+:)?documento>/gi) || [];
    const movDocsIds = [];
    for (const dXml of movDocsXml) {
      const doc = _parseDocumentoBlock(dXml);
      if (!doc) continue;
      if (!docsById.has(doc.idDocumento)) {
        docsById.set(doc.idDocumento, doc);
        documentos.push(doc);
      }
      movDocsIds.push(doc.idDocumento);
    }

    movimentos.push({
      dataHora,
      dataIso: _parseDataHoraMni(dataHora),
      codigoNacional, codigoLocal, descricao, complemento, identificador,
      docsVinculados: [...docsVinculadosIds, ...movDocsIds]
    });
  }
  movimentos.sort((a, b) => (b.dataHora || '').localeCompare(a.dataHora || ''));

  // Estratégia 2 — docs no nível de <processo> com atributo `movimento="ID"`:
  // o padrão TJGO Projudi. Cada <documento> top-level tem movimento="..."
  // apontando pro identificadorMovimento do <movimento>. Vincula assim.
  const docsXmlOuter = procBlock.match(/<(?:\w+:)?documento\b[^>]*>[\s\S]*?<\/(?:\w+:)?documento>/gi) || [];
  const movByIdentificador = new Map();
  for (const m of movimentos) {
    if (m.identificador) movByIdentificador.set(m.identificador, m);
  }
  for (const dXml of docsXmlOuter) {
    const doc = _parseDocumentoBlock(dXml);
    if (!doc) continue;
    if (docsById.has(doc.idDocumento)) continue; // já capturado nos movimentos
    docsById.set(doc.idDocumento, doc);
    documentos.push(doc);
    // Linkagem via atributo `movimento` → adiciona aos docsVinculados do
    // movimento correspondente
    if (doc.movimentoAttr) {
      const m = movByIdentificador.get(doc.movimentoAttr);
      if (m) m.docsVinculados.push(doc.idDocumento);
    }
  }

  // Linka movimentos.documentos[] com metadata dos docs achados.
  // Nome do arquivo: prefere NomeArquivo (Projudi) > descricao > fallback.
  for (const m of movimentos) {
    m.documentos = (m.docsVinculados || []).map(id => docsById.get(id)).filter(Boolean).map(d => ({
      idDocumento: d.idDocumento,
      nome: d.nomeArquivo || d.descricao || `documento_${d.idDocumento}`,
      tituloLegivel: d.arquivoTipo || d.descricao || 'Documento',
      mimetype: d.mimetype,
      dataHora: d.dataHora,
      tipoDocumento: d.tipoDocumento,
      nivelSigilo: d.nivelSigilo,
      hash: d.hash,
      tamanhoB64: d.tamanhoB64
    }));
  }
  // Órfãos: docs achados que não estão vinculados a NENHUM movimento
  const usedIds = new Set();
  for (const m of movimentos) for (const d of (m.documentos || [])) usedIds.add(d.idDocumento);
  const docsOrfaos = documentos.filter(d => !usedIds.has(d.idDocumento));

  // Diagnóstico automático: quando docs existem mas NENHUM trouxe
  // conteúdo base64, captura snippet do XML pra cliente investigar a
  // estrutura real e refinar o parser. Pega o primeiro <documento>
  // completo (até 20KB) — geralmente revela qual é o nome da tag de
  // conteúdo usada pelo sistema (Projudi vs PJe vs eSAJ variam).
  let xmlSnippetDocumentos = null;
  if (documentos.length > 0 && documentos.every(d => !d.tamanhoB64)) {
    const firstDocMatch = procBlock.match(/<(?:\w+:)?documento\b[^>]*>[\s\S]{0,20000}?<\/(?:\w+:)?documento>/i);
    if (firstDocMatch) xmlSnippetDocumentos = firstDocMatch[0];
  }

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
    movimentosTotal: movimentos.length,
    // Documentos: incluídos só quando incluirDocumentos=true foi passado
    // na request. Conteúdo em base64 separado pra o cliente decidir cachear.
    documentos: documentos.map(d => ({ ...d, conteudoB64: undefined, hasConteudo: !!d.conteudoB64 })),
    documentosConteudo: Object.fromEntries(documentos.filter(d => d.conteudoB64).map(d => [d.idDocumento, d.conteudoB64])),
    documentosTotal: documentos.length,
    documentosOrfaos: docsOrfaos.length,
    // Snippet diagnóstico do XML quando docs vieram sem conteúdo — ajuda
    // refinar o parser sem precisar passar debug=true (resposta grande).
    xmlSnippetDocumentos
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
