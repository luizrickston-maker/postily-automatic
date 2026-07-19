# Postly

Sistema de publicação multi-rede social para a agência Chapada Digital — Postiz-inspired, escrito do zero, próprio, vendável.

**Status:** MVP — Instagram, TikTok, LinkedIn prontos. Frontend a fazer.

---

## 🎯 O que é

Postly recebe posts agendados via API REST e publica em **múltiplas redes sociais simultaneamente** (Instagram, TikTok, LinkedIn). Foi desenhado para:

1. **Ser consumido pelo taskvisionpro** (sua plataforma de gestão) via API REST
2. **Vender como produto white-label** para clientes da agência
3. **Escalar** sem reescrever — adicionar uma rede nova = 1 arquivo

Inspirado em `gitroomhq/postiz-app` (33k stars), replicando a arquitetura Provider/Strategy + multi-tenant sem a bagunça de lic AGPL.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Camada 1 · Provider Contract                            │
│  SocialProvider interface — contrato por plataforma     │
├─────────────────────────────────────────────────────────┤
│  Camada 2 · Provider Implementations                     │
│  InstagramProvider / TikTokProvider / LinkedInProvider  │
├─────────────────────────────────────────────────────────┤
│  Camada 3 · Business Logic                               │
│  post.service · integration.service · api-key.service   │
├─────────────────────────────────────────────────────────┤
│  Camada 4 · Transport & Storage                          │
│  Fastify routes · PostgreSQL · Scheduler loop           │
└─────────────────────────────────────────────────────────┘
```

Quando o **taskvision** for integrar, ele consome a Camada 3 via REST (Camada 4) usando API keys por tenant. A Camada 1 (contrato) é estável — adicionar uma rede nova não quebra integração.

---

## 📦 Setup

### 1. Pré-requisitos

- Node.js 22+
- Conta no **Supabase** (projeto separado do taskvision) OU Postgres local via Docker

### 2. Instalar

```bash
cd c:\Users\Luis Henrique\Documents\postly
npm install
cp .env.example .env
```

Edite `.env` com:

- `DATABASE_URL` — connection string do Supabase (ou Postgres local)
- Credenciais dos providers que você quer usar:
  - **Meta (Instagram):** criar app em https://developers.facebook.com, ativar Instagram Graph API + Facebook Login for Business
  - **TikTok:** criar app em https://developers.tiktok.com, ativar Content Posting API
  - **LinkedIn:** criar app em https://www.linkedin.com/developers, ativar Share on LinkedIn + Sign In with LinkedIn using OpenID Connect

### 3. Rodar migrations

```bash
npm run migrate
```

Isso aplica as 5 migrations em ordem (tenants → api_keys → integrations → posts → oauth_states).

### 4. Seed inicial

```bash
npm run seed
```

Cria:
- Agência "Chapada Digital"
- Cliente "Cliente Teste" (com `external_id` pra futura integração com taskvision)
- 1 API key — **o token aparece uma única vez no console**

### 5. Rodar o servidor

```bash
npm run dev
```

Abre em `http://localhost:3000`. Healthcheck: `http://localhost:3000/healthz`.

---

## 🔌 Endpoints da API

Todos os endpoints `/api/*` exigem `Authorization: Bearer pl_live_xxxx`.

### Tenants

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/tenants` | Criar tenant |
| `GET` | `/api/tenants/:id` | Detalhe |
| `PATCH` | `/api/tenants/:id` | Atualizar |
| `DELETE` | `/api/tenants/:id` | Deletar |
| `GET` | `/api/tenants?parent_id=xxx` | Listar filhos |

### API Keys

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/api-keys` | Gerar nova key (token aparece 1× só) |
| `GET` | `/api/api-keys` | Listar do tenant |
| `DELETE` | `/api/api-keys/:id` | Revogar |

### Integrações (contas conectadas)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/integrations/providers` | Lista providers disponíveis (não exige auth) |
| `GET` | `/api/integrations` | Lista integrações conectadas |
| `GET` | `/api/integrations/:id` | Detalhe |
| `PATCH` | `/api/integrations/:id` | Toggle `disabled` |
| `DELETE` | `/api/integrations/:id` | Desconectar |

### OAuth (fluxo público — protegido por `state`)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/oauth/:provider/start?tenant_id=xxx` | Redireciona pro consentimento do provider |
| `GET` | `/oauth/:provider/callback` | Recebe code, salva integração, redireciona |

Providers suportados: `instagram`, `tiktok`, `linkedin`.

### Posts (agendamento)

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/posts` | Criar post agendado |
| `GET` | `/api/posts` | Listar (com filtros) |
| `GET` | `/api/posts/:id` | Detalhe |
| `PATCH` | `/api/posts/:id/cancel` | Cancelar post QUEUE |

**Multi-plataforma numa única chamada:**

```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer pl_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "integration_ids": ["uuid-instagram", "uuid-linkedin"],
    "publish_date": "2026-07-20T14:00:00Z",
    "content": "Lançamento da semana!",
    "media": [
      {"type": "image", "path": "https://your-supabase.co/storage/v1/object/sign/postly-media/photo.jpg"}
    ]
  }'
```

O service gera um `group_id` automático ligando os posts criados.

---

## ⏰ Scheduler

O scheduler roda **dentro do mesmo processo Fastify** (configurável via `SCHEDULER_ENABLED=false`). A cada 30s:

1. `UPDATE posts SET state='PUBLISHING' WHERE state='QUEUE' AND publish_date <= NOW() ... FOR UPDATE SKIP LOCKED` — pega até 10 posts
2. Para cada post, resolve o provider via `IntegrationManager.getSocialProvider(integration.provider_identifier)`
3. Chama `provider.post(integration, postDetails)`
4. Marca como `PUBLISHED` ou `ERROR`
5. Em caso de `RefreshTokenError`, marca `integrations.refresh_needed=true` e volta o post pra `QUEUE` (próxima tick, após renew)

**Para escalar:** rode múltiplas instâncias do Postly. `FOR UPDATE SKIP LOCKED` garante que cada post é pego por apenas 1 worker.

---

## 🔗 Integração com taskvisionpro (futuro)

Quando você quiser conectar:

1. **No Postly:** criar tenant com `external_id = taskvision_client.id` (já feito no seed de demo)
2. **No taskvision:** armazenar `postly_api_key` por cliente
3. **Fluxo:** taskvision chama `POST /api/posts` com `integration_ids` que vieram de `GET /api/integrations` do Postly
4. **Mídia:** o taskvision faz upload no Supabase Storage do Postly e passa a URL pública no campo `media[].path`

O taskvision **nunca importa código do Postly**. Eles se conversam só por HTTP.

---

## 🧪 Verificação end-to-end

1. `npm install`
2. Configure `.env`
3. `npm run migrate`
4. `npm run seed` — copia o token que aparece no console
5. `npm run dev` — servidor em `:3000`
6. Abra `http://localhost:3000/oauth/instagram/start?tenant_id=<ID_DO_CLIENTE>` no navegador
7. Autorize no Meta — vai voltar pro callback, integração salva
8. `curl -X POST http://localhost:3000/api/posts -H "Authorization: Bearer pl_live_xxxx" ...`
9. Espere 30s — post vai pra `state=PUBLISHED` com `release_url`
10. Verifique no Instagram — post está lá ✓

---

## 📁 Estrutura de pastas

```
postly/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── supabase/migrations/         # 5 SQL files
├── scripts/
│   ├── migrate.ts               # roda migrations
│   └── seed.ts                  # cria tenant + api key iniciais
└── src/
    ├── server.ts                # Fastify bootstrap
    ├── config.ts                # zod env validation
    ├── logger.ts                # pino
    ├── http.ts                  # fetch wrapper
    ├── db/pool.ts               # PostgreSQL pool
    ├── integrations/
    │   ├── types.ts             # SocialProvider interface (Camada 1)
    │   ├── errors.ts            # RefreshTokenError, BadBodyError
    │   ├── social.abstract.ts   # Base class
    │   ├── integration.manager.ts
    │   ├── integration.repository.ts
    │   ├── integration.service.ts
    │   ├── integration.routes.ts
    │   └── social/
    │       ├── instagram.provider.ts   # Priority 1
    │       ├── tiktok.provider.ts      # Priority 1
    │       └── linkedin.provider.ts    # Priority 2
    ├── posts/                   # Camada 3 - posts
    ├── tenants/                 # Camada 3 - multi-tenant
    ├── api-keys/                # Camada 3 - auth
    ├── oauth/                   # Camada 3 - OAuth flow
    └── worker/
        └── scheduler.ts         # Loop 30s com FOR UPDATE SKIP LOCKED
```

---

## 🚧 Roadmap (fora do MVP)

- Frontend React (shadcn/ui) — composer de posts, calendário, fila
- Webhooks Meta → Postly (comentários/reactions)
- Analytics (insights por post)
- Stripe (cobrança de mensalidade)
- White-label por tenant (custom domain)
- Mais providers: YouTube, Pinterest, Facebook Page, Threads, X (Twitter), Bluesky
- Migração para Temporal se passar de ~1000 posts/dia

---

## 📝 Licença

Proprietário. Não incluir em forks públicos sem autorização.
