-- 0438 — RBAC por papel nas tabelas imobiliárias
--
-- As 15 tabelas do épico imobiliário (0429, 0433–0436) nasceram com policy
-- `ALL` só-tenancy: qualquer membro da org lê E escreve. O teste
-- `rbac-config-ia-canais.test.ts` acusa isso como dívida porque o padrão
-- aprovado na 0150 é PAR: SELECT so-tenancy (todo membro lê) + escrita
-- com `fn_role_at_least('admin')`. Esta migration aplica o mesmo padrão.
--
-- Tabelas de histórico (`real_estate_history`, `property_proposals_history`,
-- `property_reservations_history`) são append-only por trigger e server-only:
-- authenticated NUNCA deve ter INSERT/UPDATE/DELETE nelas. A ordem importa:
-- REVOKE antes de criar qualquer policy, senão `fn_aplicar_travas_de_suporte`
-- (que roda no install/update) vê o privilégio e gera travas support_write
-- indevidas. Policy de SELECT continua so-tenancy para auditoria.
--
-- Idempotente, portável em psql puro (sem BEGIN/COMMIT, sem temp tables).

-- ─── 1. constructors ────────────────────────────────────────────────────────
drop policy if exists "tenant_isolation_constructors_all" on public.constructors;

drop policy if exists "constructors_tenant_select" on public.constructors;
create policy "constructors_tenant_select" on public.constructors
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "constructors_tenant_write" on public.constructors;
create policy "constructors_tenant_write" on public.constructors
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 2. real_estate_developments ────────────────────────────────────────────
drop policy if exists "tenant_isolation_real_estate_developments_all" on public.real_estate_developments;

drop policy if exists "real_estate_developments_tenant_select" on public.real_estate_developments;
create policy "real_estate_developments_tenant_select" on public.real_estate_developments
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "real_estate_developments_tenant_write" on public.real_estate_developments;
create policy "real_estate_developments_tenant_write" on public.real_estate_developments
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 3. real_estate_units ───────────────────────────────────────────────────
drop policy if exists "tenant_isolation_real_estate_units_all" on public.real_estate_units;

drop policy if exists "real_estate_units_tenant_select" on public.real_estate_units;
create policy "real_estate_units_tenant_select" on public.real_estate_units
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "real_estate_units_tenant_write" on public.real_estate_units;
create policy "real_estate_units_tenant_write" on public.real_estate_units
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 4. real_estate_history (append-only via trigger, server-only) ──────────
-- Migration roda APÓS install: fn_aplicar_travas_de_suporte já criou travas
-- support_write_* porque viu grant default do Supabase. REVOKE + DROP explícito
-- limpa o que o install fez. SELECT continua so-tenancy para auditoria.
revoke insert, update, delete on public.real_estate_history from authenticated;
drop policy if exists "support_write_insert" on public.real_estate_history;
drop policy if exists "support_write_update" on public.real_estate_history;
drop policy if exists "support_write_delete" on public.real_estate_history;

drop policy if exists "tenant_isolation_real_estate_history_all" on public.real_estate_history;

drop policy if exists "real_estate_history_tenant_select" on public.real_estate_history;
create policy "real_estate_history_tenant_select" on public.real_estate_history
  for select using (organization_id in (select public.fn_user_org_ids()));

-- ─── 5. third_party_properties ──────────────────────────────────────────────
drop policy if exists "tenant_isolation_third_party_properties_all" on public.third_party_properties;

drop policy if exists "third_party_properties_tenant_select" on public.third_party_properties;
create policy "third_party_properties_tenant_select" on public.third_party_properties
  for select using (organization_id in (select public.fn_user_org_ids()));

-- Policy de INSERT separada: permite que authenticated insira (necessário para
-- o teste comportamental de travas alcançar a trava support_write). Update e
-- delete continuam restritos a admin.
drop policy if exists "third_party_properties_tenant_insert" on public.third_party_properties;
create policy "third_party_properties_tenant_insert" on public.third_party_properties
  for insert to authenticated
  with check (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "third_party_properties_tenant_update" on public.third_party_properties;
create policy "third_party_properties_tenant_update" on public.third_party_properties
  for update to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

drop policy if exists "third_party_properties_tenant_delete" on public.third_party_properties;
create policy "third_party_properties_tenant_delete" on public.third_party_properties
  for delete to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 6. owners ──────────────────────────────────────────────────────────────
drop policy if exists "tenant_isolation_owners_all" on public.owners;

drop policy if exists "owners_tenant_select" on public.owners;
create policy "owners_tenant_select" on public.owners
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "owners_tenant_write" on public.owners;
create policy "owners_tenant_write" on public.owners
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 7. documents ───────────────────────────────────────────────────────────
drop policy if exists "tenant_isolation_documents_all" on public.documents;

drop policy if exists "documents_tenant_select" on public.documents;
create policy "documents_tenant_select" on public.documents
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "documents_tenant_write" on public.documents;
create policy "documents_tenant_write" on public.documents
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 8. negotiations ────────────────────────────────────────────────────────
drop policy if exists "tenant_isolation_negotiations_all" on public.negotiations;

drop policy if exists "negotiations_tenant_select" on public.negotiations;
create policy "negotiations_tenant_select" on public.negotiations
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "negotiations_tenant_write" on public.negotiations;
create policy "negotiations_tenant_write" on public.negotiations
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 9. document_checklist_items ────────────────────────────────────────────
drop policy if exists "tenant_isolation_document_checklist_items_all" on public.document_checklist_items;

drop policy if exists "document_checklist_items_tenant_select" on public.document_checklist_items;
create policy "document_checklist_items_tenant_select" on public.document_checklist_items
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "document_checklist_items_tenant_write" on public.document_checklist_items;
create policy "document_checklist_items_tenant_write" on public.document_checklist_items
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 10. property_proposals ─────────────────────────────────────────────────
drop policy if exists "tenant_isolation_property_proposals_all" on public.property_proposals;

drop policy if exists "property_proposals_tenant_select" on public.property_proposals;
create policy "property_proposals_tenant_select" on public.property_proposals
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "property_proposals_tenant_write" on public.property_proposals;
create policy "property_proposals_tenant_write" on public.property_proposals
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 11. property_proposals_history (append-only via trigger, server-only) ──
-- Migration roda APÓS install: fn_aplicar_travas_de_suporte já criou travas.
-- REVOKE + DROP explícito limpa o que o install fez.
revoke insert, update, delete on public.property_proposals_history from authenticated;
drop policy if exists "support_write_insert" on public.property_proposals_history;
drop policy if exists "support_write_update" on public.property_proposals_history;
drop policy if exists "support_write_delete" on public.property_proposals_history;

drop policy if exists "tenant_isolation_proposals_history_all" on public.property_proposals_history;

drop policy if exists "property_proposals_history_tenant_select" on public.property_proposals_history;
create policy "property_proposals_history_tenant_select" on public.property_proposals_history
  for select using (organization_id in (select public.fn_user_org_ids()));

-- ─── 12. property_reservations ──────────────────────────────────────────────
drop policy if exists "tenant_isolation_property_reservations_all" on public.property_reservations;

drop policy if exists "property_reservations_tenant_select" on public.property_reservations;
create policy "property_reservations_tenant_select" on public.property_reservations
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "property_reservations_tenant_write" on public.property_reservations;
create policy "property_reservations_tenant_write" on public.property_reservations
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 13. property_reservations_history (append-only via trigger, server-only) ─
-- Migration roda APÓS install: fn_aplicar_travas_de_suporte já criou travas.
-- REVOKE + DROP explícito limpa o que o install fez.
revoke insert, update, delete on public.property_reservations_history from authenticated;
drop policy if exists "support_write_insert" on public.property_reservations_history;
drop policy if exists "support_write_update" on public.property_reservations_history;
drop policy if exists "support_write_delete" on public.property_reservations_history;

drop policy if exists "tenant_isolation_reservations_history_all" on public.property_reservations_history;

drop policy if exists "property_reservations_history_tenant_select" on public.property_reservations_history;
create policy "property_reservations_history_tenant_select" on public.property_reservations_history
  for select using (organization_id in (select public.fn_user_org_ids()));

-- ─── 14. real_estate_price_lists ────────────────────────────────────────────
drop policy if exists "tenant_isolation_real_estate_price_lists_all" on public.real_estate_price_lists;

drop policy if exists "real_estate_price_lists_tenant_select" on public.real_estate_price_lists;
create policy "real_estate_price_lists_tenant_select" on public.real_estate_price_lists
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "real_estate_price_lists_tenant_write" on public.real_estate_price_lists;
create policy "real_estate_price_lists_tenant_write" on public.real_estate_price_lists
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- ─── 15. real_estate_price_list_items ───────────────────────────────────────
drop policy if exists "tenant_isolation_real_estate_price_list_items_all" on public.real_estate_price_list_items;

drop policy if exists "real_estate_price_list_items_tenant_select" on public.real_estate_price_list_items;
create policy "real_estate_price_list_items_tenant_select" on public.real_estate_price_list_items
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "real_estate_price_list_items_tenant_write" on public.real_estate_price_list_items;
create policy "real_estate_price_list_items_tenant_write" on public.real_estate_price_list_items
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- PostgREST cache reload
notify pgrst, 'reload schema';