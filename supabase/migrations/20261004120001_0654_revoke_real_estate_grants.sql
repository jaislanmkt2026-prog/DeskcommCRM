-- 0535 — revoke explícito e grants server-only para tabelas real_estate e constructors
--
-- Forward-fix do achado crítico da auditoria CV CRM: as tabelas real_estate_*
-- e constructors nasceram sem REVOKE/GRANT explícitos nas migrations 0433, 0504,
-- 0506, 0528 e 0529. O default ACL do Supabase concede SELECT/INSERT/UPDATE/DELETE
-- a anon, authenticated e service_role em toda tabela nova sem revoke. RLS está
-- habilitado e policies existem, mas service_role ignora RLS — qualquer chamada
-- com service key pode ler/escrever todos os tenants sem filtro de organization_id.
--
-- Esta migration fecha a superfície: revoga tudo de public/anon/authenticated e
-- concede apenas SELECT a authenticated (RLS filtra por tenant) e CRUD completo
-- a service_role (que já filtra organization_id manualmente no código).
-- Idempotente: safe para re-aplicação via update.sh.

-- ─── 1. REVOKE de todas as tabelas afetadas ──────────────────────────────────
revoke all on table public.real_estate_developments from public, anon, authenticated;
revoke all on table public.real_estate_units from public, anon, authenticated;
revoke all on table public.real_estate_price_lists from public, anon, authenticated;
revoke all on table public.real_estate_price_list_items from public, anon, authenticated;
revoke all on table public.real_estate_history from public, anon, authenticated;
revoke all on table public.constructors from public, anon, authenticated;

-- ─── 2. Grants a authenticated (SELECT only, RLS filtra por tenant) ─────────
grant select on table public.real_estate_developments to authenticated;
grant select on table public.real_estate_units to authenticated;
grant select on table public.real_estate_price_lists to authenticated;
grant select on table public.real_estate_price_list_items to authenticated;
grant select on table public.real_estate_history to authenticated;
grant select on table public.constructors to authenticated;

-- ─── 3. Grants a service_role (CRUD completo, filtro manual no código) ──────
grant select, insert, update, delete on table public.real_estate_developments to service_role;
grant select, insert, update, delete on table public.real_estate_units to service_role;
grant select, insert, update, delete on table public.real_estate_price_lists to service_role;
grant select, insert, update, delete on table public.real_estate_price_list_items to service_role;
grant select, insert, update, delete on table public.real_estate_history to service_role;
grant select, insert, update, delete on table public.constructors to service_role;

notify pgrst, 'reload schema';