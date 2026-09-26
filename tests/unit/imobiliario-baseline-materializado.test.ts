import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const baseline = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");
const baselineLower = baseline.toLowerCase();
const manifest = readFileSync(join(process.cwd(), "supabase", "migrations", "MANIFEST.md"), "utf8");

describe("baseline imobiliário materializado", () => {
  it("cria owners antes da FK usada por third_party_properties", () => {
    const owners = baseline.indexOf("create table if not exists public.owners (");
    const thirdParty = baseline.indexOf("create table if not exists public.third_party_properties (");
    expect(owners).toBeGreaterThan(-1);
    expect(thirdParty).toBeGreaterThan(-1);
    expect(owners).toBeLessThan(thirdParty);
  });

  it("inclui somente o schema imobiliário materializado desta missão", () => {
    for (const trecho of [
      "create table if not exists public.property_proposals (",
      "create table if not exists public.property_reservations (",
      "create table if not exists public.property_proposals_history (",
      "create table if not exists public.property_reservations_history (",
      "create table if not exists public.real_estate_price_lists (",
      "create table if not exists public.real_estate_price_list_items (",
      "create table if not exists public.document_checklist_items (",
      "property_proposals_price_list_id_fkey",
      "fn_track_proposal_reservation_history",
    ]) expect(baselineLower).toContain(trecho.toLowerCase());

    expect(baseline).not.toContain("create table if not exists public.real_estate_property_proposals (");
    expect(baseline).not.toContain("create table if not exists public.real_estate_property_reservations (");
    expect(baseline).not.toContain("create table if not exists public.real_estate_credit_analyses (");
    expect(baseline).not.toContain("20260925010000_0385_lia_qualification");
  });

  it("documenta materializadas e migrations deliberadamente fora de aplicação", () => {
    for (const nome of [
      "0382_fundacao_imobiliaria",
      "0383_property_proposals_reservations",
      "0384_property_proposals_reservations_history",
      "0383_price_lists",
      "0384_business_flow",
      "0429_document_checklist_items",
    ]) expect(manifest).toContain(`\`${nome}\``);

    expect(manifest).toContain("0384_business_flow` | **NÃO APLICADA / DEPRECATED / FORA DO ESCOPO.**");
    expect(manifest).toContain("20260925010000_0385_lia_qualification.sql` — **NÃO APLICADA / VETADA.**");
  });
});
