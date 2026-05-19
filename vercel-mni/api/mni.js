// UC Jurídico — MNI Worker (adaptador pra Vercel Edge Functions)
//
// Mesma lógica do workers/mni-worker.js (Cloudflare Worker) mas roda em
// Vercel Edge Function com região `gru1` (São Paulo). Motivação: TRT18 e
// outros tribunais de Justiça do Trabalho bloqueiam o IP do Cloudflare
// Workers (rede US/EU) via 'administrative rules' (HTTP 403). IP brasileiro
// pode passar.
//
// Deploy:
//   cd vercel-mni
//   npx vercel deploy
//
// Mais detalhes: ./README.md

// IMPORTANTE: cópia local de workers/mni-worker.js (Vercel Edge Functions
// não pode importar de fora do diretório do projeto). Manter sincronizado:
// quando atualizar workers/mni-worker.js, rodar o sync.bat (ou copiar manual)
// pra refletir aqui. Detalhe no README.md → seção "Sincronizando o código".
import { handleMniRequest } from '../lib/mni-worker.js';

export const config = {
  runtime: 'edge',
  regions: ['gru1']  // São Paulo
};

export default async function handler(req) {
  // Mapeia env do Vercel pro formato que o handler espera.
  // ALLOWED_ORIGINS configurada via Vercel Dashboard → Environment Variables.
  const env = {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
      || 'https://uc-juridico-sandbox.pages.dev,https://eduardourany-dot.github.io,http://localhost:8000'
  };
  return handleMniRequest(req, env);
}
