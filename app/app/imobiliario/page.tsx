import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  Buildings,
  CheckCircle,
  ClipboardText,
  FileText,
  House,
  Inbox,
  Kanban,
  Receipt,
  Signpost,
  UsersThree,
  Warning,
} from "@/lib/ui/icons";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Imobiliário" };

interface KpiProps {
  label: string;
  value: number;
  detail: string;
  icon: PhosphorIcon;
}

function Kpi({ label, value, detail, icon: Icon }: KpiProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        <Icon size={20} weight="duotone" className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
      </CardContent>
    </Card>
  );
}

const STATUS_DO_EMPREENDIMENTO: Record<string, string> = {
  planejamento: "Planejamento",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  pausado: "Pausado",
};

export default async function ImobiliarioPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const orgId = activeOrg.orgId;
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const resultados = await Promise.all([
    supabase
      .from("real_estate_developments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("real_estate_units")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("real_estate_units")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "disponivel"),
    supabase
      .from("real_estate_price_lists")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("third_party_properties")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("negotiations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("real_estate_developments")
      .select("id, nome, cidade, bairro, status, updated_at")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(4),
  ]);

  const erro = resultados.find((resultado) => resultado.error)?.error;
  if (erro) throw erro;

  const [
    empreendimentos,
    unidades,
    disponiveis,
    tabelasPreco,
    terceiros,
    documentos,
    negociacoes,
    empreendimentosRecentes,
  ] = resultados;

  const kpis: KpiProps[] = [
    {
      label: t("Empreendimentos"),
      value: empreendimentos.count ?? 0,
      detail: t("cadastrados nesta organização"),
      icon: Buildings,
    },
    {
      label: t("Unidades"),
      value: unidades.count ?? 0,
      detail: t("unidades na base local"),
      icon: House,
    },
    {
      label: t("Disponíveis"),
      value: disponiveis.count ?? 0,
      detail: t("marcadas como disponíveis localmente"),
      icon: CheckCircle,
    },
    {
      label: t("Tabelas de preço"),
      value: tabelasPreco.count ?? 0,
      detail: t("tabelas cadastradas no CRM"),
      icon: Receipt,
    },
    {
      label: t("Imóveis de terceiros"),
      value: terceiros.count ?? 0,
      detail: t("captações cadastradas"),
      icon: Signpost,
    },
    {
      label: t("Documentos"),
      value: documentos.count ?? 0,
      detail: t("documentos imobiliários"),
      icon: FileText,
    },
    {
      label: t("Negociações"),
      value: negociacoes.count ?? 0,
      detail: t("negociações registradas"),
      icon: ClipboardText,
    },
  ];

  const vazios = [
    tabelasPreco.count === 0 ? t("Nenhuma tabela de preço cadastrada.") : null,
    terceiros.count === 0 ? t("Nenhum imóvel de terceiro cadastrado.") : null,
    documentos.count === 0 ? t("Nenhum documento imobiliário cadastrado.") : null,
    negociacoes.count === 0 ? t("Nenhuma negociação imobiliária registrada.") : null,
  ].filter((item): item is string => Boolean(item));

  const recentes = empreendimentosRecentes.data ?? [];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <House size={28} weight="duotone" className="text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">{t("Imobiliário")}</h1>
          <Badge variant="neutral">{t("Base local")}</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("Visão geral da operação imobiliária cadastrada neste CRM.")}
        </p>
        <p className="max-w-4xl text-xs text-muted-foreground">
          {t(
            "Disponibilidade e preços abaixo vêm da base local desta organização e não representam, por si só, estoque oficial do CV CRM.",
          )}
        </p>
      </header>

      <nav aria-label={t("Atalhos operacionais")} className="flex flex-wrap gap-2">
        {[
          { href: "/app/inbox", label: "Inbox", icon: Inbox },
          { href: "/app/kanban", label: "Funis", icon: Kanban },
          { href: "/app/contacts", label: "Contatos", icon: UsersThree },
          { href: "/app/radar", label: "Radar", icon: Warning },
        ].map(({ href, label, icon: Icon }) => (
          <Button key={href} asChild variant="outline" size="sm">
            <Link href={href}>
              <Icon aria-hidden />
              {t(label)}
            </Link>
          </Button>
        ))}
      </nav>

      <section aria-labelledby="imobiliario-kpis" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="imobiliario-kpis" className="text-base font-semibold">
            {t("Estado da base imobiliária")}
          </h2>
          <span className="text-xs text-muted-foreground">{t("Organização atual")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <Kpi key={kpi.label} {...kpi} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{t("Empreendimentos recentes")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {recentes.length > 0 ? (
              recentes.map((empreendimento) => (
                <div
                  key={empreendimento.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{empreendimento.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {[empreendimento.bairro, empreendimento.cidade].filter(Boolean).join(" · ") ||
                        t("Localização não informada")}
                    </p>
                  </div>
                  <Badge variant="neutral">
                    {t(STATUS_DO_EMPREENDIMENTO[empreendimento.status] ?? empreendimento.status)}
                  </Badge>
                </div>
              ))
            ) : (
              <div className="flex items-start gap-3 py-4">
                <House size={20} weight="duotone" className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{t("Nenhum empreendimento cadastrado")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("A base local desta organização ainda não possui empreendimentos.")}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{t("Cadastros ainda vazios")}</CardTitle>
          </CardHeader>
          <CardContent>
            {vazios.length > 0 ? (
              <ul className="space-y-3">
                {vazios.map((texto) => (
                  <li key={texto} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                    <span>{texto}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-start gap-3 py-2">
                <CheckCircle size={20} weight="duotone" className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{t("Base preenchida")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("Os cadastros operacionais acompanhados nesta visão já possuem registros.")}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
