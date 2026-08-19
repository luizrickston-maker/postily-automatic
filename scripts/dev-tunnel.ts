// scripts/dev-tunnel.ts — sobe cloudflared tunnel + servidor Postly num único comando.
//
// Fluxo:
//   1. Sobe cloudflared tunnel --url http://localhost:3001 (gera URL pública aleatória)
//   2. Captura a URL do stdout (regex no padrão trycloudflare.com)
//   3. Atualiza META_REDIRECT_URI no .env com a URL nova
//   4. Sobe o servidor Postly (tsx watch src/server.ts)
//
// Requisitos:
//   - cloudflared instalado e no PATH (https://github.com/cloudflare/cloudflared)
//   - .env com PORT=3001
//
// Uso:
//   npm run dev:tunnel

import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');
const PORT = process.env.PORT ?? '3001';

const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

let cloudflared: ChildProcess | null = null;
let postly: ChildProcess | null = null;

function shutdown(signal: string) {
  console.log('\n[dev-tunnel] Recebido ' + signal + ', encerrando processos...');
  cloudflared?.kill('SIGTERM');
  postly?.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function updateEnvWithTunnelUrl(publicUrl: string) {
  const envContent = await readFile(ENV_PATH, 'utf-8');
  const redirectUri = publicUrl + '/oauth/instagram/callback';

  let updated: string;
  if (envContent.match(/^META_REDIRECT_URI=.*$/m)) {
    updated = envContent.replace(
      /^META_REDIRECT_URI=.*$/m,
      'META_REDIRECT_URI=' + redirectUri,
    );
  } else {
    updated = envContent + '\nMETA_REDIRECT_URI=' + redirectUri + '\n';
  }

  await writeFile(ENV_PATH, updated, 'utf-8');
  console.log('[dev-tunnel] ✓ META_REDIRECT_URI atualizado no .env');
  console.log('[dev-tunnel]   ' + redirectUri);
}

function startCloudflared(): Promise<string> {
  return new Promise((resolve, reject) => {
 console.log('[dev-tunnel] Subindo cloudflared tunnel...');
    cloudflared = spawn(
      'cloudflared',
      ['tunnel', '--url', 'http://localhost:' + PORT],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        reject(new Error('Timeout esperando URL do cloudflared (30s)'));
        cloudflared?.kill('SIGTERM');
      }
    }, 30_000);

    const onChunk = (buf: Buffer) => {
      const text = buf.toString();
      process.stdout.write('[cloudflared] ' + text);
      const match = text.match(URL_REGEX);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    cloudflared.stdout?.on('data', onChunk);
    cloudflared.stderr?.on('data', onChunk);

    cloudflared.on('error', (err) => {
      clearTimeout(timeout);
      if (!resolved) reject(err);
    });

    cloudflared.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error('cloudflared saiu com código ' + code + ' antes de gerar URL'));
      }
    });
  });
}

function startPostly() {
  console.log('[dev-tunnel] Subindo Postly em :' + PORT + '...');
  postly = spawn('npx', ['tsx', 'watch', 'src/server.ts'], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  postly.on('exit', (code) => {
    console.log('[dev-tunnel] Postly saiu com código ' + code);
    cloudflared?.kill('SIGTERM');
    process.exit(code ?? 0);
  });
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Postly dev:tunnel');
  console.log('═══════════════════════════════════════════');

  try {
    const publicUrl = await startCloudflared();
    console.log('');
    console.log('[dev-tunnel] ✓ Tunnel ativo em:');
    console.log('[dev-tunnel]   ' + publicUrl);
    console.log('');

    await updateEnvWithTunnelUrl(publicUrl);
    console.log('');

    startPostly();
  } catch (err) {
    console.error('[dev-tunnel] ✗ Falha:', err);
    cloudflared?.kill('SIGTERM');
    process.exit(1);
  }
}

main();
