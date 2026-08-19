// scripts/create-clients.ts — cria os 2 tenants-cliente novos sob a agência Chapada Digital
// Uso: npm run create:clients

import { config } from '../src/config.js';
import { logger } from '../src/logger.js';
import { closePool, pool } from '../src/db/pool.js';
import * as tenantRepo from '../src/tenants/tenant.repository.js';

const NEW_CLIENTS = [
  {
    name: 'Mestre Alex',
    slug: 'mestre-alex',
    external_id: 'cliente-mestre-alex',
    settings: {
      description: 'Cliente Mestre Alex',
      instagram_handle: null,
      notes: 'Tenant criado em 2026-08-11',
    },
  },
  {
    name: 'Adilma Corretora',
    slug: 'adilma-corretora',
    external_id: 'cliente-adilma-corretora',
    settings: {
      description: 'Cliente Adilma Corretora',
      instagram_handle: null,
      notes: 'Tenant criado em 2026-08-11',
    },
  },
];

async function main() {
  logger.info('Criando tenants dos novos clientes...');

  const agencyResult = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE type = 'agency' AND slug = 'chapada-digital' LIMIT 1`,
  );
  const agency = agencyResult.rows[0];

  if (!agency) {
    logger.error('Agência Chapada Digital não encontrada. Rode npm run seed primeiro.');
    await closePool();
    process.exit(1);
  }

  logger.info({ agencyId: agency.id }, 'Agência Chapada Digital encontrada');

  const created: Array<{ name: string; id: string; slug: string; oauthUrl: string }> = [];

  for (const input of NEW_CLIENTS) {
    const existing = await tenantRepo.findBySlug(input.slug);
    if (existing) {
      logger.warn({ slug: input.slug, id: existing.id }, 'Tenant já existe, pulando');
      created.push({
        name: existing.name,
        id: existing.id,
        slug: existing.slug,
        oauthUrl: 'http://localhost:' + config.PORT + '/oauth/instagram/start?tenant_id=' + existing.id,
      });
      continue;
    }

    const tenant = await tenantRepo.create({
      type: 'client',
      name: input.name,
      slug: input.slug,
      external_id: input.external_id,
      parent_id: agency.id,
      settings: input.settings,
    });

    logger.info({ tenantId: tenant.id, name: tenant.name }, '✓ Tenant criado');

    created.push({
      name: tenant.name,
      id: tenant.id,
      slug: tenant.slug,
      oauthUrl: 'http://localhost:' + config.PORT + '/oauth/instagram/start?tenant_id=' + tenant.id,
    });
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Tenants criados / encontrados');
  console.log('═══════════════════════════════════════════════════');
  for (const c of created) {
    console.log('');
    console.log('  Cliente: ' + c.name);
    console.log('  ID:      ' + c.id);
    console.log('  Slug:    ' + c.slug);
    console.log('  OAuth:   ' + c.oauthUrl);
  }
  console.log('\n═══════════════════════════════════════════════════\n');

  await closePool();
}

main().catch(async (err) => {
  logger.error({ err }, 'Falha ao criar tenants');
  await closePool();
  process.exit(1);
});
