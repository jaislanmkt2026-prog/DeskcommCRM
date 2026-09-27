"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Risk = "low" | "medium" | "high" | "critical";
type AnalysisStatus = "never" | "no_change" | "completed" | "incomplete" | "failed";

interface AnalysisSummary {
  fork_reference?: string;
  fork_reference_source?: "APP_REVISION" | "CRIVO_FORK_REF";
  fork_commit?: string;
  total_commits_delta?: number;
  total_commits_analyzed?: number;
  total_files_delta?: number;
  total_files_analyzed?: number;
  parity?: { commits?: boolean; files?: boolean };
  counts?: { added?: number; modified?: number; deleted?: number; renamed?: number };
  categories?: Record<string, number>;
  conflict_status?: string;
  conflicts?: Array<{ file: string; area: string; status: string; reason: string }>;
  files?: Array<{ path: string; status: string; area: string; risk: Risk }>;
}

interface UpstreamState {
  repository: string;
  default_branch: string;
  local_commit: string;
  last_seen_commit: string;
  latest_upstream_commit: string;
  last_seen_tag: string;
  last_seen_release: string;
  last_checked_at: string | null;
  next_check_at: string | null;
  update_available: boolean;
  commits_behind: number;
  files_changed: number;
  risk_level: Risk;
  analysis_status: AnalysisStatus;
  analysis_summary: AnalysisSummary;
}

interface CheckRow {
  id: string;
  started_at: string;
  upstream_commit: string;
  result: string;
  commits_delta: number;
  files_delta: number;
  risk_level: Risk;
  analysis_status: AnalysisStatus;
  error: string | null;
}

interface CenterData {
  state: UpstreamState | null;
  history: CheckRow[];
}

function shortSha(value?: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function when(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function risco(value?: Risk): string {
  return ({ low: "BAIXO", medium: "MÉDIO", high: "ALTO", critical: "CRÍTICO" } as const)[
    value ?? "low"
  ];
}

function estado(state: UpstreamState | null): string {
  if (!state || state.analysis_status === "never") return "AGUARDANDO PRIMEIRA VERIFICAÇÃO";
  if (state.analysis_status === "failed" || state.analysis_status === "incomplete") {
    return "ERRO NA VERIFICAÇÃO";
  }
  return state.update_available ? "ATUALIZAÇÃO DISPONÍVEL" : "ATUALIZADO";
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-3">
      <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 font-medium text-text">{value}</p>
    </div>
  );
}

export function UpdateCenterPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["system-upstream"],
    queryFn: async () => {
      const response = await apiClient.get<{ data: CenterData }>("/api/v1/system/upstream");
      return response.data;
    },
    staleTime: 60_000,
  });
  const check = useMutation({
    mutationFn: () =>
      apiClient.post("/api/v1/system/upstream", { action: "check" }, { timeoutMs: 120_000 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["system-upstream"] }),
  });

  const state = query.data?.state ?? null;
  const summary = state?.analysis_summary ?? {};
  const counts = summary.counts ?? {};
  const analysisComplete =
    state?.analysis_status === "completed" &&
    summary.parity?.commits === true &&
    summary.parity?.files === true;

  return (
    <section className="mx-auto mb-8 w-full max-w-5xl" aria-labelledby="central-updates-title">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle id="central-updates-title" className="text-lg">
                {t("Central de Atualizações")}
              </CardTitle>
              <p className="mt-1 max-w-2xl text-sm text-text-muted">
                {t("O Crivo interno monitora e analisa o upstream. Esta área não aplica atualização, migration, merge ou rebase.")}
              </p>
            </div>
            <Button onClick={() => check.mutate()} disabled={check.isPending} variant="secondary">
              {check.isPending ? t("Verificando…") : t("Executar nova verificação")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="text-sm text-text-muted">{t("Carregando estado do Crivo…")}</p>
          ) : query.isError ? (
            <p className="text-sm text-error">{t("Não foi possível carregar o estado do Crivo.")}</p>
          ) : (
            <div className="space-y-5">
              <div className="rounded-md border border-border p-4" aria-live="polite">
                <p className="text-xs uppercase tracking-wide text-text-muted">{t("Status")}</p>
                <p className="mt-1 text-lg font-semibold">{t(estado(state))}</p>
                {check.isError ? (
                  <p className="mt-2 text-sm text-error">
                    {t("A verificação manual falhou. O estado anterior foi preservado.")}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Upstream" value={state?.repository ?? "—"} />
                <Stat label="Branch" value={state?.default_branch || "—"} />
                <Stat label="HEAD upstream" value={shortSha(state?.latest_upstream_commit)} />
                <Stat
                  label={t("Referência JS Imóveis")}
                  value={state?.analysis_status === "completed" ? summary.fork_reference || "—" : "—"}
                />
                <Stat
                  label={t("SHA JS Imóveis")}
                  value={
                    state?.analysis_status === "completed"
                      ? shortSha(summary.fork_commit || state?.local_commit)
                      : "—"
                  }
                />
                <Stat label={t("Última verificação")} value={when(state?.last_checked_at)} />
                <Stat label={t("Próxima verificação")} value={when(state?.next_check_at)} />
                <Stat label="Tag" value={state?.last_seen_tag || "—"} />
                <Stat label="Release" value={state?.last_seen_release || "—"} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Commits no delta" value={summary.total_commits_delta ?? state?.commits_behind ?? 0} />
                <Stat label="Arquivos no delta" value={summary.total_files_delta ?? state?.files_changed ?? 0} />
                <Stat label="Risco" value={risco(state?.risk_level)} />
                <Stat label="Conflitos JS" value={summary.conflict_status ?? "—"} />
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label={t("Adicionados")} value={counts.added ?? 0} />
                <Stat label={t("Modificados")} value={counts.modified ?? 0} />
                <Stat label={t("Excluídos")} value={counts.deleted ?? 0} />
                <Stat label={t("Renomeados")} value={counts.renamed ?? 0} />
              </div>

              <div className="rounded-md border border-border p-4 text-sm">
                <p className="font-medium">{t("Paridade da análise")}</p>
                <p className="mt-1 text-text-muted">
                  Commits: {summary.total_commits_analyzed ?? 0}/{summary.total_commits_delta ?? 0} · Arquivos:{" "}
                  {summary.total_files_analyzed ?? 0}/{summary.total_files_delta ?? 0}
                </p>
                <p className="mt-1 font-medium">
                  {analysisComplete
                    ? t("ANÁLISE COMPLETA")
                    : state?.analysis_status === "never"
                      ? t("AINDA NÃO MEDIDA")
                      : "ANALYSIS_INCOMPLETE"}
                </p>
              </div>

              {Object.keys(summary.categories ?? {}).length > 0 ? (
                <details className="rounded-md border border-border p-4">
                  <summary className="cursor-pointer font-medium">{t("Áreas afetadas")}</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {Object.entries(summary.categories ?? {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, count]) => (
                        <div key={name} className="flex justify-between gap-3 text-sm">
                          <span>{name}</span>
                          <span className="text-text-muted">{count}</span>
                        </div>
                      ))}
                  </div>
                </details>
              ) : null}

              {(summary.conflicts?.length ?? 0) > 0 ? (
                <details className="rounded-md border border-border p-4">
                  <summary className="cursor-pointer font-medium">
                    {t("Conflitos prováveis (")}{summary.conflicts?.length})
                  </summary>
                  <ul className="mt-3 space-y-2 text-sm">
                    {summary.conflicts?.slice(0, 100).map((conflict) => (
                      <li key={conflict.file} className="break-all">
                        <strong>{conflict.status}</strong> · {conflict.file} · {conflict.area}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {(summary.files?.length ?? 0) > 0 ? (
                <details className="rounded-md border border-border p-4">
                  <summary className="cursor-pointer font-medium">
                    {t("Arquivos analisados (")}{summary.files?.length})
                  </summary>
                  <div className="mt-3 max-h-96 overflow-auto">
                    <ul className="space-y-1 text-xs">
                      {summary.files?.map((file) => (
                        <li key={`${file.status}:${file.path}`} className="break-all">
                          {file.status.toUpperCase()} · {file.area} · {risco(file.risk)} · {file.path}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              ) : null}

              {(query.data?.history.length ?? 0) > 0 ? (
                <details className="rounded-md border border-border p-4">
                  <summary className="cursor-pointer font-medium">{t("Histórico de verificações")}</summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="text-text-muted">
                        <tr>
                          <th className="pb-2 pr-4">{t("Quando")}</th>
                          <th className="pb-2 pr-4">{t("Resultado")}</th>
                          <th className="pb-2 pr-4">HEAD</th>
                          <th className="pb-2 pr-4">{t("Delta")}</th>
                          <th className="pb-2 pr-4">{t("Risco")}</th>
                          <th className="pb-2">{t("Erro")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {query.data?.history.map((row) => (
                          <tr key={row.id} className="border-t border-border">
                            <td className="py-2 pr-4">{when(row.started_at)}</td>
                            <td className="py-2 pr-4">{row.result}</td>
                            <td className="py-2 pr-4">{shortSha(row.upstream_commit)}</td>
                            <td className="py-2 pr-4">{row.commits_delta}c / {row.files_delta}a</td>
                            <td className="py-2 pr-4">{risco(row.risk_level)}</td>
                            <td className="py-2">{row.error || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
