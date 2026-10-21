import type { Metadata } from "next";
import { AbasContatosLeads } from "@/components/crm/AbasContatosLeads";
import { ContactsListClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contatos" };

export default function ContactsPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-4 pt-6">
        <AbasContatosLeads ativa="contatos" />
      </div>
      <ContactsListClient />
    </>
  );
}
