import type { Metadata } from "next";

import { AbasContatosLeads } from "@/components/crm/AbasContatosLeads";
import { LeadsClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <AbasContatosLeads ativa="leads" />
      <LeadsClient />
    </div>
  );
}