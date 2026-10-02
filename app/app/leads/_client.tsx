"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

function linkDoWhatsapp(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  return digitos.length >= 8 ? `https://wa.me/${digitos}` : null;
}

const NOVA_ORIGEM = "__nova__";

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
  const [marcados, setMarcados] = useState<string[]>([]);
  const [painel, setPainel] = useState(false);
  const [escolha, setEscolha] = useState("");
  const [nova, setNova] = useState("");
  const queryClient = useQueryClient();

  const alterar = useMutation({
    mutationFn: (corpo: { ids: string[]; origem: string }) =>
      apiClient.patch<{ data: { alterados: number } }>("/api/v1/leads/lista", corpo),
    onSuccess: () => {
      setMarcados([]);
      setPainel(false);
      setEscolha("");
      setNova("");
      return queryClient.invalidateQueries({ queryKey: ["leads-lista"] });
    },
  });

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
    setMarcados([]);
  };
  const idsDaPagina = (dados?.leads ?? []).map((l) => l.id);
  const todosMarcados = idsDaPagina.length > 0 && idsDaPagina.every((id) => marcados.includes(id));
  const alternar = (id: string) =>
    setMarcados((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  const origemFinal = escolha === NOVA_ORIGEM ? nova.trim() : escolha;

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
          {marcados.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-elevated p-2 text-sm">
              <span>
                {marcados.length} {t("selecionado(s)")}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setPainel((v) => !v)}>
                {t("Alterar origem")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMarcados([])}>
                {t("Limpar seleção")}
              </Button>
            </div>
          ) : null}
          {painel && marcados.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
              <select
                className={SELECT_CLASSE}
                value={escolha}
                aria-label={t("Nova origem")}
                onChange={(e) => setEscolha(e.target.value)}
              >
                <option value="">{t("Escolha a nova origem")}</option>
                {(dados?.origens ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                <option value={NOVA_ORIGEM}>{t("Outra origem…")}</option>
              </select>
              {escolha === NOVA_ORIGEM ? (
                <input
                  value={nova}
                  onChange={(e) => setNova(e.target.value)}
                  placeholder={t("Nome da origem")}
                  aria-label={t("Nome da origem")}
                  className="h-9 w-56 rounded-md border border-border bg-surface-elevated px-3 text-sm text-text"
                />
              ) : null}
              <Button
                size="sm"
                disabled={!origemFinal || alterar.isPending}
                onClick={() => alterar.mutate({ ids: marcados, origem: origemFinal })}
              >
                {alterar.isPending ? t("Alterando…") : t("Aplicar")}
              </Button>
              {alterar.isError ? (
                <span className="text-error">{t("Não consegui alterar a origem.")}</span>
              ) : null}
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-elevated text-xs uppercase text-text-muted">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={t("Selecionar todos desta página")}
                      checked={todosMarcados}
                      onChange={() => setMarcados(todosMarcados ? [] : idsDaPagina)}
                    />
                  </th>
                  <th className="px-3 py-2">{t("Lead")}</th>
                  <th className="px-3 py-2">{t("Telefone")}</th>
                  <th className="px-3 py-2">{t("Funil")}</th>
                  <th className="px-3 py-2">{t("Etapa")}</th>
                  <th className="px-3 py-2">{t("Origem")}</th>
                  <th className="px-3 py-2">{t("Etiquetas")}</th>
                  <th className="px-3 py-2">{t("Criado em")}</th>
                  <th className="px-3 py-2">{t("Ações")}</th>
                </tr>
              </thead>
              <tbody>
                {dados.leads.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-text-muted">
                      {t("Nenhum lead encontrado.")}
                    </td>
                  </tr>
                ) : (
                  dados.leads.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={t("Selecionar lead")}
                          checked={marcados.includes(l.id)}
                          onChange={() => alternar(l.id)}
                        />
                      </td>                      <td className="px-3 py-2 font-medium">
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
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="flex gap-1">
                          {linkDoWhatsapp(l.contact?.phone_number) ? (
                            <a
                              href={linkDoWhatsapp(l.contact?.phone_number) ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-elevated"
                            >
                              {t("WhatsApp")}
                            </a>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setMarcados([l.id]);
                              setPainel(true);
                            }}
                          >
                            {t("Origem")}
                          </Button>
                        </span>
                      </td>                    </tr>
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