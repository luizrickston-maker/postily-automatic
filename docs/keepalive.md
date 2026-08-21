# Keepalive do Supabase — como não deixar o banco pausar

O **Supabase Free tier pausa projetos inativos após 7 dias sem atividade**. Esse problema já nos pegou uma vez (DNS sumiu, certificado SSL expirou, banco inacessível).

## Solução implementada

Dois workflows no GitHub Actions que fazem requests periódicos:

| Workflow | Frequência | O que faz |
|---|---|---|
| `.github/workflows/scheduler-cron.yml` | a cada 1 min | Publica posts agendados |
| `.github/workflows/supabase-keepalive.yml` | 1× por dia (12h UTC) | Ping na REST API Supabase |

O `supabase-keepalive.yml` chama a REST API do projeto todo dia — qualquer request conta como atividade, e o Supabase não pausa.

## Configurar no GitHub

Os secrets necessários (já configurados durante o setup inicial):

- `SUPABASE_URL` — `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY` — Project API Keys → `anon` `public`
- `POSTLY_URL` — URL canônica da Vercel (ex: `https://postly-six-blond.vercel.app`)

Para setar via CLI:
```bash
gh secret set SUPABASE_URL --body "https://<ref>.supabase.co"
gh secret set SUPABASE_ANON_KEY --body "<anon-key>"
```

## Se o Supabase pausar mesmo assim

1. Acesse https://supabase.com/dashboard/project/<project-ref>
2. Status: **Paused** → clique em **Restore**
3. Aguarde a reativação (~5 min)
4. O certificado SSL pode levar até 24h para rotacionar completamente

## Alternativa: Supabase Pro ($25/mês)

Sem pausas automáticas. Mas o keepalive gratuito é suficiente na maioria dos casos.

## Ajustar frequência (opcional)

Se quiser mais agressivo, edite o cron em `supabase-keepalive.yml`:
- 1× por dia: `'0 12 * * *'`
- 2× por dia: `'0 8,20 * * *'`
- A cada 6h: `'0 */6 * * *'`
