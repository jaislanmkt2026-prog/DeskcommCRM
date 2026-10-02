"use client";

import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";

export function AbasContatosLeads({ ativa }: { ativa: "contatos" | "leads" }) {
  const t = useT();
  const abas = [
    { id: "contatos" as const, href: "/app/contacts", rotulo: t("Contatos") },
    { id: "leads" as const, href: "/app/leads", rotulo: t("Leads") },
  ];
  return (
    <nav role="tablist" aria-label={t("Contatos e leads")} className="mb-4 flex gap-1 border-b border-border">
      {abas.map((a) => (
        <Link
          key={a.id}
          href={a.href}
          role="tab"
          aria-selected={a.id === ativa}
          className={cn(
            "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
            a.id === ativa
              ? "border-primary text-text"
              : "border-transparent text-text-muted hover:text-text",
          )}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}