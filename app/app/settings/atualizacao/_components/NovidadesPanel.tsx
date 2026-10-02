"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type TipoDeItem = "novo" | "melhoria" | "corrigido";

interface ItemDaNovidade {
  tipo: TipoDeItem;
  titulo: string;
  onde?: { menu?: string; rota?: string } | null;
  commit?: string;
}

interface Novidade {
  id: string;
  aplicada_em: string;
  de_sha: string | null;
  para_sha: string | null;
  titulo: string;
  resumo: string;
  itens: ItemDaNovidade[];
}

function dia(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

// "O que chegou": cada atualização aplicada pelo Crivo, em linguagem do dono,
// com o lugar do CRM onde cada coisa nova fica (link direto para a tela).
export function NovidadesPanel() {
  const t = useT();
  const query = useQuery({
    queryKey: ["system-novidades"],
    queryFn: async () => {
      const response = await apiClient.get<{ data: { novidades: Novidade[] } }>(
        "/api/v1/system/novidades",
      );
      return response.data.novidades;
    },
    staleTime: 60_000,
  });

  const grupos: Array<{ tipo: TipoDeItem; rotulo: string }> = [
    { tipo: "novo", rotulo: t("Novo") },
    { tipo: "melhoria", rotulo: t("Melhorado") },
    { tipo: "corrigido", rotulo: t("Corrigido") },
  ];

  return (
    <section className="mx-auto mb-8 w-full max-w-5xl" aria-labelledby="novidades-title">
      <Card>
        <CardHeader>
          <CardTitle id="novidades-title" className="text-lg">
            {t("O que chegou nas atualizações")}
          </CardTitle>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            {t("Cada atualização aplicada pelo Crivo, com o lugar do CRM onde fica cada novidade.")}
          </p>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="text-sm text-text-muted">{t("Carregando novidades…")}</p>
          ) : query.isError ? (
            <p className="text-sm text-error">{t("Não foi possível carregar as novidades.")}</p>
          ) : !query.data?.length ? (
            <p className="text-sm text-text-muted">
              {t("Nenhuma atualização registrada ainda. Quando o Crivo aplicar a próxima, ela aparece aqui.")}
            </p>
          ) : (
            <div className="space-y-6">
              {query.data.map((n) => (
                <article key={n.id} className="rounded-md border border-border p-4">
                  <header className="mb-3">
                    <h3 className="text-base font-semibold">{n.titulo}</h3>
                    <p className="text-xs text-text-muted">{dia(n.aplicada_em)}</p>
                    {n.resumo ? <p className="mt-2 text-sm">{n.resumo}</p> : null}
                  </header>
                  {grupos.map(({ tipo, rotulo }) => {
                    const itens = (n.itens ?? []).filter((i) => i.tipo === tipo);
                    if (!itens.length) return null;
                    return (
                      <details key={tipo} open={tipo !== "corrigido"} className="mt-3">
                        <summary className="cursor-pointer text-sm font-semibold">
                          {rotulo} ({itens.length})
                        </summary>
                        <ul className="mt-2 space-y-1.5">
                          {itens.map((i, idx) => (
                            <li key={`${tipo}-${idx}`} className="text-sm">
                              <span>{i.titulo}</span>
                              {i.onde?.rota ? (
                                <>
                                  {" — "}
                                  <Link href={i.onde.rota} className="text-primary underline">
                                    {t("Onde fica")}: {i.onde.menu || i.onde.rota}
                                  </Link>
                                </>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    );
                  })}
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}