"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface LeadLinha {
  id: string;
  title: string;
  status: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  pipeline_id: string;
  contact_id: string | null;
  pipeline: { name: string } | null;
  stage: { name: string } | null;
  contact: { id: string; phone_number: string | null; display_name: string | null; name: string | null } | null;
}

interface RespostaLeads {
  leads: LeadLinha[];
  total: number;
  por_pagina: number;
  origens: string[];
  tags: string[];
  funis: Array<{ id: string; name: string }>;
}

const SELECT_CLASSE =
  "h-9 rounded-md border border-border bg-surface-elevated px-2 text-sm text-text";

function quando(valor: string): string {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function LeadsClient() {
  const t = useT();
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState("");
  const [tag, setTag] = useState("");
  const [funil, setFunil] = useState("");
  const [pagina, setPagina] = useState(1);

  const query = useQuery({
    queryKey: ["leads-lista", busca, origem, tag, funil, pagina],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (busca) params.set("q", busca);
      if (origem) params.set("origem", origem);
      if (tag) params.set("tag", tag);
      if (funil) params.set("funil", funil);
      params.set("pagina", String(pagina));
      const r = await apiClient.get<{ data: RespostaLeads }>(`/api/v1/leads/lista?${params.toString()}`);
      return r.data;
    },
    placeholderData: (anterior) => anterior,
    staleTime: 30_000,
  });

  const dados = query.data;
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;
  const mudar = (fn: () => void) => {
    fn();
    setPagina(1);
  };

  return (
    <section aria-labelledby="leads-titulo" className="space-y-4">
      <header>
        <h1 id="leads-titulo" className="text-2xl font-semibold">
          {t("Leads")}
        </h1>
        <p className="text-sm text-text-muted">
          {t("Quem você decidiu tratar como oportunidade, com origem e etiquetas para saber de onde veio.")}
        </p>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          mudar(() => setBusca(q.trim()));
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Buscar por nome ou telefone")}
          aria-label={t("Buscar por nome ou telefone")}
          className="h-9 w-64 rounded-md border border-border bg-surface-elevated px-3 text-sm text-text"
        />
        <select
          className={SELECT_CLASSE}
          value={origem}
          aria-label={t("Origem")}
          onChange={(e) => mudar(() => setOrigem(e.target.value))}
        >
          <option value="">{t("Todas as origens")}</option>
          {(dados?.origens ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASSE}
          value={tag}
          aria-label={t("Etiqueta")}
          onChange={(e) => mudar(() => setTag(e.target.value))}
        >
          <option value="">{t("Todas as etiquetas")}</option>
          {(dados?.tags ?? []).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASSE}
          value={funil}
          aria-label={t("Funil")}
          onChange={(e) => mudar(() => setFunil(e.target.value))}
        >
          <option value="">{t("Todos os funis")}</option>
          {(dados?.funis ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" size="sm">
          {t("Buscar")}
        </Button>
      </form>

      {query.isError ? (
        <p className="text-sm text-error">{t("Não foi possível carregar os leads.")}</p>
      ) : !dados ? (
        <p className="text-sm text-text-muted">{t("Carregando leads…")}</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            {dados.total} {t("Leads")}
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-elevated text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2">{t("Lead")}</th>
                  <th className="px-3 py-2">{t("Telefone")}</th>
                  <th className="px-3 py-2">{t("Funil")}</th>
                  <th className="px-3 py-2">{t("Etapa")}</th>
                  <th className="px-3 py-2">{t("Origem")}</th>
                  <th className="px-3 py-2">{t("Etiquetas")}</th>
                  <th className="px-3 py-2">{t("Criado em")}</th>
                </tr>
              </thead>
              <tbody>
                {dados.leads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                      {t("Nenhum lead encontrado.")}
                    </td>
                  </tr>
                ) : (
                  dados.leads.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">
                        {l.contact_id ? (
                          <Link href={`/app/contacts/${l.contact_id}`} className="hover:underline">
                            {l.title}
                          </Link>
                        ) : (
                          l.title
                        )}
                      </td>
                      <td className="px-3 py-2">{l.contact?.phone_number ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Link href={`/app/pipelines/${l.pipeline_id}`} className="hover:underline">
                          {l.pipeline?.name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{l.stage?.name ?? "—"}</td>
                      <td className="px-3 py-2">{l.source ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {(l.tags ?? []).map((x) => (
                            <span key={x} className="rounded-full border border-border px-2 py-0.5 text-xs">
                              {x}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{quando(l.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>
              {t("Anterior")}
            </Button>
            <span className="text-sm text-text-muted">
              {pagina} / {totalPaginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagina >= totalPaginas}
              onClick={() => setPagina((n) => n + 1)}
            >
              {t("Próxima")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}