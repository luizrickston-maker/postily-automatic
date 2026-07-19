// scripts/seed.ts — cria tenant + API key inicial pra você começar a testar
import { config } from '../src/config.js';
import { logger } from '../src/logger.js';
import { closePool, pool } from '../src/db/pool.js';
import * as tenantRepo from '../src/tenants/tenant.repository.js';
import { createApiKey } from '../src/api-keys/api-key.service.js';

async function main() {
  logger.info('🌱 Rodando seed...');

  // 1. Cria agência "Chapada Digital"
  const agency = await tenantRepo.create({
    type: 'agency',
    name: 'Chapada Digital',
    slug: 'chapada-digital',
    settings: {
      description: 'Agência-mãe do Postly',
    },
  });
  logger.info({ agencyId: agency.id, name: agency.name }, '✓ Agência criada');

  // 2. Cria 1 cliente de teste vinculado à agência
  const client = await tenantRepo.create({
    type: 'client',
    name: 'Cliente Teste',
    slug: 'cliente-teste',
    parent_id: agency.id,
    external_id: 'taskvision-client-demo', // simula integração futura com taskvision
    settings: {},
  });
  logger.info({ clientId: client.id, externalId: client.external_id }, '✓ Cliente criado');

  // 3. Cria API key pro cliente
  const { apiKey, token } = await createApiKey({
    tenant_id: client.id,
    name: 'Seed key (delete após uso)',
    scopes: [
      'posts:read',
      'posts:write',
      'integrations:read',
      'integrations:write',
    ],
  });

  logger.info({ apiKeyId: apiKey.id }, '✓ API key criada');

  // 4. Imprime tudo formatado
  console.log('\n========================================');
  console.log('🎉 SEED COMPLETO');
  console.log('========================================');
  console.log(`Agência:    ${agency.name} (${agency.id})`);
  console.log(`Cliente:    ${client.name} (${client.id})`);
  console.log(`  external_id (taskvision): ${client.external_id}`);
  console.log(`\n🔑 API KEY (guarde com cuidado — não aparece de novo):`);
  console.log(`   ${token}`);
  console.log(`\n📋 Header para requests:`);
  console.log(`   Authorization: Bearer ${token}`);
  console.log('\n🚀 Próximos passos:');
  console.log(`   1. Conecte uma rede social:`);
  console.log(`      http://localhost:${config.PORT}/oauth/instagram/start?tenant_id=${client.id}`);
  console.log(`   2. Crie um post:`);
  console.log(`      curl -X POST http://localhost:${config.PORT}/api/posts \\`);
  console.log(`        -H "Authorization: Bearer ${token}" \\`);
  console.log(`        -H "Content-Type: application/json" \\`);
  console.log(`        -d '{"integration_ids":["<ID_DA_INTEGRACAO>"],"publish_date":"2026-07-16T20:00:00Z","content":"Hello"}'`);
  console.log('========================================\n');

  await closePool();
}

main().catch(async (err) => {
  logger.error({ err }, 'Seed falhou');
  await closePool();
  process.exit(1);
});