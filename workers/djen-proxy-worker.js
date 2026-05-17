// UC Jurídico — DJEN Proxy Worker
// Versão: 0.1.0 · proxy simples pra API DJEN do CNJ
//
// Motivação: a API pública DJEN do CNJ (https://comunicaapi.pje.jus.br/api/v1/comunicacao)
// é hospedada em AWS CloudFront com geo-restriction: bloqueia requests
// fora do Brasil. Apps Script roda em IPs do Google Cloud (datacenters
// EUA) — request é rejeitado com HTTP 403 e body "The Amazon CloudFront
// distribution is configured to block access from your country."
//
// Cloudflare Workers rodam em POPs próximos ao usuário; quando chamados
// do Brasil, saem de IPs BR (SAO/GIG) e o CloudFront aceita. Este worker
// repassa a query da API com headers de browser.
//
// Deploy:
//   dash.cloudflare.com → Workers & Pages → Create Worker
//   Nome sugerido: uc-djen-proxy
//   Colar este arquivo, Save and deploy.
//   Anota a URL: https://uc-djen-proxy.SEU-USUARIO.workers.dev
//
// Uso (do Apps Script):
//   GET https://uc-djen-proxy.SEU-USUARIO.workers.dev?numeroOab=16539&ufOab=GO&...
//   Response: mesmo JSON que a API DJEN retornaria (status 200 + items[])
//
// Limites:
//   - Free tier: 100k requests/dia · 10ms CPU/req
//   - Varredura cron diária ~30 requests/dia → folgadíssimo

const DJEN_API = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

const BROWSER_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': 'https://comunicaapi.pje.jus.br/'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env, ctx) {
    // CORS pre-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Status/info endpoint
    if (new URL(request.url).pathname === '/health' || new URL(request.url).search === '') {
      return new Response(JSON.stringify({
        service: 'uc-djen-proxy',
        version: '0.1.0',
        upstream: DJEN_API,
        ok: true
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Aceita GET (querystring) ou POST (JSON body)
    let params = {};
    if (request.method === 'GET') {
      const url = new URL(request.url);
      url.searchParams.forEach((v, k) => { params[k] = v; });
    } else if (request.method === 'POST') {
      try {
        params = await request.json();
      } catch (_) {
        return jsonErr(400, 'body_inválido_não_é_json');
      }
    } else {
      return jsonErr(405, 'método_não_permitido');
    }

    // Validação mínima — exige numeroOab + ufOab pra evitar abuso
    if (!params.numeroOab || !params.ufOab) {
      return jsonErr(400, 'params_obrigatórios_numeroOab_ufOab');
    }

    // Monta URL upstream
    const qs = new URLSearchParams(params).toString();
    const upstreamUrl = `${DJEN_API}?${qs}`;

    try {
      const upstream = await fetch(upstreamUrl, {
        method: 'GET',
        headers: BROWSER_HEADERS,
        cf: {
          // Hint pro Cloudflare: cache 5min na borda (mesma query repetida
          // dentro desse intervalo serve do cache, alivia CNJ).
          cacheTtl: 300,
          cacheEverything: false
        }
      });

      const body = await upstream.text();
      const contentType = upstream.headers.get('Content-Type') || 'application/json';

      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': contentType,
          'X-Proxy-By': 'uc-djen-proxy',
          'X-Upstream-Status': String(upstream.status),
          ...CORS_HEADERS
        }
      });
    } catch (e) {
      return jsonErr(502, 'upstream_falhou: ' + (e && e.message || String(e)));
    }
  }
};

function jsonErr(status, msg) {
  return new Response(JSON.stringify({ erro: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}
