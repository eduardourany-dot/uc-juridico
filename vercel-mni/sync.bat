@echo off
REM Sincroniza workers/mni-worker.js -> vercel-mni/lib/mni-worker.js
REM Vercel Edge Functions exigem que o codigo esteja dentro do diretorio do projeto.
copy /Y ..\workers\mni-worker.js lib\mni-worker.js
echo Sync OK.
