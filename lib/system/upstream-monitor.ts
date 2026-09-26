import type { createAdminClient } from "@/lib/supabase/admin";

export const INTERVALO_CRIVO_MS = 6 * 60 * 60 * 1000;
export const RETENCAO_HISTORICO_DIAS = 90;

const GITHUB_API = "https://api.github.com";
const TIMEOUT_MS = 12_000;
const TENTATIVAS = 2;
const POR_PAGINA = 100;

type AdminClient = ReturnType<typeof createAdminClient>;

/** Configuração interna controlada; nada deste trio vem do browser. */
export const CRIVO_REPOSITORY = {
  upstream: "melgarafael/DeskcommCRM",
  fork: "jaislanmkt2026-prog/DeskcommCRM",
  forkOwner: "jaislanmkt2026-prog",
} as const;

type AmbienteCrivo = Record<string, string | undefined>;
export type FonteReferenciaFork = "APP_REVISION" | "CRIVO_FORK_REF";

export interface ReferenciaFork {
  reference: string;
  source: FonteReferenciaFork;
}

export type NivelRisco = "low" | "medium" | "high" | "critical";
export type StatusAnalise = "never" | "no_change" | "completed" | "incomplete" | "failed";
export type StatusArquivo = "added" | "modified" | "deleted" | "renamed";
export type StatusConflito =
  | "SEM CONFLITO APARENTE"
  | "CONFLITO PROVÁVEL"
  | "CONFLITO CRÍTICO";

export interface EntradaArvoreGit {
  path: string;
  sha: string;
  type: string;
}

export interface ArquivoDelta {
  path: string;
  previous_path?: string;
  status: StatusArquivo;
  area: string;
  risk: NivelRisco;
  reason: string;
}

export interface ConflitoDelta {
  file: string;
  area: string;
  risk: NivelRisco;
  status: Exclude<StatusConflito, "SEM CONFLITO APARENTE">;
  reason: string;
}

export interface ResumoAnaliseUpstream {
  fork_reference: string;
  fork_reference_source: FonteReferenciaFork;
  fork_commit: string;
  merge_base_commit: string;
  upstream_commit: string;
  total_commits_delta: number;
  total_commits_analyzed: number;
  total_files_delta: number;
  total_files_analyzed: number;
  parity: { commits: boolean; files: boolean };
  counts: { added: number; modified: number; deleted: number; renamed: number };
  categories: Record<string, number>;
  files: ArquivoDelta[];
  conflict_status: StatusConflito;
  conflicts: ConflitoDelta[];
}

export interface DescobertaUpstream {
  repository: string;
  defaultBranch: string;
  forkReference: string;
  forkReferenceSource: FonteReferenciaFork;
  forkCommit: string;
  upstreamCommit: string;
  mergeBaseCommit: string;
  latestTag: string;
  latestRelease: string;
  commitsBehind: number;
}

export function snapshotMudou(
  previous: Pick<
    EstadoAnterior,
    | "local_commit"
    | "latest_upstream_commit"
    | "last_seen_tag"
    | "last_seen_release"
    | "analysis_status"
    | "analysis_summary"
  >,
  current: DescobertaUpstream,
): boolean {
  const summary =
    previous.analysis_summary && typeof previous.analysis_summary === "object"
      ? (previous.analysis_summary as Record<string, unknown>)
      : null;
  return !(
    previous.latest_upstream_commit === current.upstreamCommit &&
    previous.local_commit === current.forkCommit &&
    summary?.fork_reference === current.forkReference &&
    previous.last_seen_tag === current.latestTag &&
    previous.last_seen_release === current.latestRelease &&
    previous.analysis_status === "completed"
  );
}

interface EstadoAnterior {
  local_commit?: string | null;
  last_seen_commit?: string | null;
  latest_upstream_commit?: string | null;
  last_seen_tag?: string | null;
  last_seen_release?: string | null;
  risk_level?: NivelRisco | null;
  analysis_status?: string | null;
  analysis_summary?: unknown;
}

interface GitHubRepo {
  default_branch: string;
}

interface GitHubCommit {
  sha: string;
  tree?: { sha: string };
}

interface GitHubCompare {
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  base_commit: { sha: string };
  merge_base_commit: { sha: string };
  commits: Array<{ sha: string }>;
}

interface GitHubTag {
  name: string;
}

interface GitHubRelease {
  tag_name: string;
}

interface GitHubTree {
  truncated: boolean;
  tree: EntradaArvoreGit[];
}

export class CrivoUpstreamError extends Error {
  constructor(
    public readonly code:
      | "upstream_unavailable"
      | "analysis_incomplete"
      | "invalid_upstream"
      | "invalid_fork_reference",
    message: string,
  ) {
    super(message);
    this.name = "CrivoUpstreamError";
  }
}

const SHA_COMPLETO = /^[0-9a-f]{40}$/i;
const REF_GIT_CONTROLADA = /^[A-Za-z0-9._/-]{1,200}$/;

function referenciaGitValida(value: string): boolean {
  return (
    REF_GIT_CONTROLADA.test(value) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !value.split("/").some((parte) => parte.startsWith(".") || parte.endsWith(".lock"))
  );
}

/**
 * Referência oficial do fork JS Imóveis.
 *
 * Em imagem publicada, `APP_REVISION` é o SHA exato gravado pelo CI e vence:
 * ele representa o código que está rodando. Fora desse caminho (desenvolvimento
 * ou instalação legada), `CRIVO_FORK_REF` precisa ser informado explicitamente.
 * Não existe fallback para uma branch histórica.
 */
export function resolverReferenciaFork(env: AmbienteCrivo = process.env): ReferenciaFork {
  const revision = env.APP_REVISION?.trim();
  if (revision) {
    if (!SHA_COMPLETO.test(revision)) {
      throw new CrivoUpstreamError(
        "invalid_fork_reference",
        "APP_REVISION não contém um SHA Git completo válido.",
      );
    }
    return { reference: revision.toLowerCase(), source: "APP_REVISION" };
  }

  const configured = env.CRIVO_FORK_REF?.trim();
  if (!configured) {
    throw new CrivoUpstreamError(
      "invalid_fork_reference",
      "Referência oficial do fork ausente. Configure APP_REVISION ou CRIVO_FORK_REF.",
    );
  }
  if (!SHA_COMPLETO.test(configured) && !referenciaGitValida(configured)) {
    throw new CrivoUpstreamError(
      "invalid_fork_reference",
      "CRIVO_FORK_REF possui formato Git inválido.",
    );
  }
  return { reference: configured, source: "CRIVO_FORK_REF" };
}

function sanitizarErro(error: unknown): string {
  const raw = error instanceof CrivoUpstreamError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Falha desconhecida na verificação do upstream.";
  return raw
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/(token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function espera(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubJson<T>(
  path: string,
  fetchImpl: typeof fetch,
  aceitar404 = false,
): Promise<T | null> {
  if (!path.startsWith("/")) throw new CrivoUpstreamError("invalid_upstream", "Caminho GitHub inválido.");

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${GITHUB_API}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "DeskcommCRM-Crivo-Interno",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: controller.signal,
        cache: "no-store",
      });
      if (aceitar404 && response.status === 404) return null;
      if (!response.ok) {
        throw new CrivoUpstreamError(
          "upstream_unavailable",
          `GitHub respondeu HTTP ${response.status} durante a verificação.`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      ultimoErro = error;
      if (tentativa < TENTATIVAS) await espera(250 * tentativa);
    } finally {
      clearTimeout(timer);
    }
  }

  if (ultimoErro instanceof CrivoUpstreamError) throw ultimoErro;
  throw new CrivoUpstreamError("upstream_unavailable", "Não foi possível consultar o GitHub.");
}

function endpointCompare(base: string, head: string): string {
  return `/repos/${CRIVO_REPOSITORY.upstream}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
}

export async function descobrirUpstream(
  fetchImpl: typeof fetch = fetch,
  env: AmbienteCrivo = process.env,
): Promise<DescobertaUpstream> {
  const referenciaFork = resolverReferenciaFork(env);
  const [repo, forkHead] = await Promise.all([
    githubJson<GitHubRepo>(`/repos/${CRIVO_REPOSITORY.upstream}`, fetchImpl),
    githubJson<GitHubCommit>(
      `/repos/${CRIVO_REPOSITORY.fork}/commits/${encodeURIComponent(referenciaFork.reference)}`,
      fetchImpl,
    ),
  ]);
  const defaultBranch = repo?.default_branch?.trim();
  if (!defaultBranch || !/^[A-Za-z0-9._/-]{1,200}$/.test(defaultBranch) || defaultBranch.includes("..")) {
    throw new CrivoUpstreamError("invalid_upstream", "Branch default do upstream é inválida.");
  }
  if (!forkHead?.sha || !SHA_COMPLETO.test(forkHead.sha)) {
    throw new CrivoUpstreamError(
      "invalid_fork_reference",
      "A referência oficial do fork não resolveu para um commit Git válido.",
    );
  }

  const forkRef = `${CRIVO_REPOSITORY.forkOwner}:${forkHead.sha}`;
  const [head, cross, tags, release] = await Promise.all([
    githubJson<GitHubCommit>(
      `/repos/${CRIVO_REPOSITORY.upstream}/commits/${encodeURIComponent(defaultBranch)}`,
      fetchImpl,
    ),
    githubJson<GitHubCompare>(endpointCompare(forkRef, defaultBranch), fetchImpl),
    githubJson<GitHubTag[]>(`/repos/${CRIVO_REPOSITORY.upstream}/tags?per_page=1`, fetchImpl),
    githubJson<GitHubRelease>(`/repos/${CRIVO_REPOSITORY.upstream}/releases/latest`, fetchImpl, true),
  ]);

  if (!head?.sha || !cross?.base_commit?.sha || !cross.merge_base_commit?.sha) {
    throw new CrivoUpstreamError("upstream_unavailable", "GitHub devolveu comparação incompleta.");
  }
  if (cross.base_commit.sha !== forkHead.sha) {
    throw new CrivoUpstreamError(
      "invalid_fork_reference",
      "A comparação do GitHub não usou o commit resolvido da referência oficial do fork.",
    );
  }

  return {
    repository: CRIVO_REPOSITORY.upstream,
    defaultBranch,
    forkReference: referenciaFork.reference,
    forkReferenceSource: referenciaFork.source,
    forkCommit: forkHead.sha,
    upstreamCommit: head.sha,
    mergeBaseCommit: cross.merge_base_commit.sha,
    latestTag: tags?.[0]?.name ?? "",
    latestRelease: release?.tag_name ?? "",
    commitsBehind: Math.max(0, cross.ahead_by ?? 0),
  };
}

async function commitsDoDelta(
  descoberta: DescobertaUpstream,
  fetchImpl: typeof fetch,
): Promise<{ total: number; analyzed: number }> {
  const endpoint = endpointCompare(descoberta.mergeBaseCommit, descoberta.upstreamCommit);
  const primeira = await githubJson<GitHubCompare>(`${endpoint}?per_page=${POR_PAGINA}&page=1`, fetchImpl);
  if (!primeira) throw new CrivoUpstreamError("upstream_unavailable", "Comparação upstream vazia.");

  const total = primeira.total_commits;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const shas = new Set(primeira.commits.map((commit) => commit.sha));

  if (paginas > 1) {
    const restantes = await Promise.all(
      Array.from({ length: paginas - 1 }, (_, index) =>
        githubJson<GitHubCompare>(`${endpoint}?per_page=${POR_PAGINA}&page=${index + 2}`, fetchImpl),
      ),
    );
    for (const pagina of restantes) {
      for (const commit of pagina?.commits ?? []) shas.add(commit.sha);
    }
  }

  return { total, analyzed: shas.size };
}

async function arvoreDoCommit(
  repository: string,
  commitSha: string,
  fetchImpl: typeof fetch,
): Promise<EntradaArvoreGit[]> {
  const commit = await githubJson<GitHubCommit>(`/repos/${repository}/git/commits/${commitSha}`, fetchImpl);
  if (!commit?.tree?.sha) {
    throw new CrivoUpstreamError("upstream_unavailable", "Commit sem árvore Git no upstream.");
  }
  const tree = await githubJson<GitHubTree>(
    `/repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`,
    fetchImpl,
  );
  if (!tree) throw new CrivoUpstreamError("upstream_unavailable", "Árvore Git ausente.");
  if (tree.truncated) {
    throw new CrivoUpstreamError(
      "analysis_incomplete",
      "GitHub truncou a árvore do repositório; a paridade de arquivos não pode ser provada.",
    );
  }
  return tree.tree.filter((entry) => entry.type === "blob");
}

function agruparPorSha(entries: Array<[string, string]>): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [path, sha] of entries) {
    const paths = grouped.get(sha) ?? [];
    paths.push(path);
    grouped.set(sha, paths);
  }
  return grouped;
}

export function compararArvores(base: EntradaArvoreGit[], head: EntradaArvoreGit[]): Array<{
  path: string;
  previous_path?: string;
  status: StatusArquivo;
}> {
  const a = new Map(base.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const b = new Map(head.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const added = new Map<string, string>();
  const deleted = new Map<string, string>();
  const changed: Array<{ path: string; previous_path?: string; status: StatusArquivo }> = [];

  for (const [path, sha] of a) {
    if (!b.has(path)) deleted.set(path, sha);
    else if (b.get(path) !== sha) changed.push({ path, status: "modified" });
  }
  for (const [path, sha] of b) if (!a.has(path)) added.set(path, sha);

  // Rename só quando há prova inequívoca: um blob saiu de um único caminho e
  // apareceu, byte a byte igual, em um único caminho novo. Caso ambíguo fica
  // add+delete em vez de inventar renome.
  const deletedBySha = agruparPorSha([...deleted]);
  const addedBySha = agruparPorSha([...added]);
  for (const [sha, oldPaths] of deletedBySha) {
    const newPaths = addedBySha.get(sha) ?? [];
    if (oldPaths.length !== 1 || newPaths.length !== 1) continue;
    const previousPath = oldPaths[0]!;
    const path = newPaths[0]!;
    deleted.delete(previousPath);
    added.delete(path);
    changed.push({ path, previous_path: previousPath, status: "renamed" });
  }

  for (const path of added.keys()) changed.push({ path, status: "added" });
  for (const path of deleted.keys()) changed.push({ path, status: "deleted" });
  return changed.sort((x, y) => x.path.localeCompare(y.path));
}

const RANK_RISCO: Record<NivelRisco, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function regraDoArquivo(path: string): { area: string; risk: NivelRisco; reason: string } {
  const p = path.toLowerCase();
  if (p.startsWith("supabase/migrations/") || p === "supabase/baseline.sql") {
    return { area: "Banco", risk: "critical", reason: "migration/baseline" };
  }
  if (["auth", "security", "rls", "multi-tenant", "multi_tenant", "secret", "mfa"].some((x) => p.includes(x))) {
    return { area: "Segurança", risk: "critical", reason: "auth/RLS/segurança" };
  }
  if (["agent-engine", "ai_agent", "agent-worker", "/lia/", "lia."].some((x) => p.includes(x))) {
    return { area: "Agent Engine / Lia", risk: "critical", reason: "motor do agente/Lia" };
  }
  if (p.includes("mcp") || p.includes("tool/" ) || p.includes("tools/")) {
    return { area: "MCP / Tools", risk: "critical", reason: "MCP/tools" };
  }
  if (p.includes("inbox")) return { area: "Inbox", risk: "high", reason: "Inbox" };
  if (p.includes("whatsapp") || p.includes("waha")) {
    return { area: "WhatsApp / WAHA", risk: "high", reason: "WhatsApp/WAHA" };
  }
  if (p.startsWith("worker/") || p.startsWith("workers/")) {
    return { area: "Workers", risk: "high", reason: "worker" };
  }
  if (p.includes("scheduler") || p.startsWith("docker/") || p.includes("dockerfile") || p.includes("docker-compose")) {
    return { area: "Scheduler / Docker", risk: "high", reason: "scheduler/Docker" };
  }
  if (["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"].some((x) => p.endsWith(x))) {
    return { area: "Dependências", risk: "high", reason: "dependências" };
  }
  if (p.startsWith("app/api/") || p.startsWith("lib/api/")) {
    return { area: "API", risk: "medium", reason: "API" };
  }
  if (p.includes("prospect")) return { area: "Prospectar", risk: "medium", reason: "Prospectar" };
  if (p.includes("agenda") || p.includes("calendar")) {
    return { area: "Agenda", risk: "medium", reason: "Agenda" };
  }
  if (p.startsWith("app/app/") || p.startsWith("components/") || p.endsWith(".tsx") || p.endsWith(".css")) {
    return { area: "UI", risk: "medium", reason: "UI" };
  }
  if (p.startsWith("lib/ai/") || p.includes("/ai/")) {
    return { area: "IA", risk: "medium", reason: "IA" };
  }
  return { area: "CRM / Core", risk: "low", reason: "core sem gatilho de risco elevado" };
}

export function classificarArquivos(
  files: Array<{ path: string; previous_path?: string; status: StatusArquivo }>,
): ArquivoDelta[] {
  return files.map((file) => ({ ...file, ...regraDoArquivo(file.path) }));
}

function maiorRisco(files: ArquivoDelta[]): NivelRisco {
  return files.reduce<NivelRisco>(
    (current, file) => (RANK_RISCO[file.risk] > RANK_RISCO[current] ? file.risk : current),
    "low",
  );
}

export function detectarConflitos(
  upstream: ArquivoDelta[],
  fork: Array<{ path: string; previous_path?: string; status: StatusArquivo }>,
): { status: StatusConflito; conflicts: ConflitoDelta[] } {
  const tocados = new Set<string>();
  for (const file of fork) {
    tocados.add(file.path);
    if (file.previous_path) tocados.add(file.previous_path);
  }

  const conflicts = upstream
    .filter((file) => tocados.has(file.path) || (file.previous_path ? tocados.has(file.previous_path) : false))
    .map<ConflitoDelta>((file) => ({
      file: file.path,
      area: file.area,
      risk: file.risk,
      status: file.risk === "critical" || file.risk === "high" ? "CONFLITO CRÍTICO" : "CONFLITO PROVÁVEL",
      reason: "O mesmo arquivo também foi alterado no fork desde o merge-base.",
    }));

  if (conflicts.some((c) => c.status === "CONFLITO CRÍTICO")) {
    return { status: "CONFLITO CRÍTICO", conflicts };
  }
  if (conflicts.length > 0) return { status: "CONFLITO PROVÁVEL", conflicts };
  return { status: "SEM CONFLITO APARENTE", conflicts: [] };
}

export function montarResumoAnalise(input: {
  descoberta: DescobertaUpstream;
  commitsTotal: number;
  commitsAnalyzed: number;
  upstreamFiles: Array<{ path: string; previous_path?: string; status: StatusArquivo }>;
  forkFiles: Array<{ path: string; previous_path?: string; status: StatusArquivo }>;
}): ResumoAnaliseUpstream {
  const files = classificarArquivos(input.upstreamFiles);
  const counts = {
    added: files.filter((f) => f.status === "added").length,
    modified: files.filter((f) => f.status === "modified").length,
    deleted: files.filter((f) => f.status === "deleted").length,
    renamed: files.filter((f) => f.status === "renamed").length,
  };
  const categories: Record<string, number> = {};
  for (const file of files) categories[file.area] = (categories[file.area] ?? 0) + 1;
  const conflicts = detectarConflitos(files, input.forkFiles);
  const totalFiles = counts.added + counts.modified + counts.deleted + counts.renamed;

  return {
    fork_reference: input.descoberta.forkReference,
    fork_reference_source: input.descoberta.forkReferenceSource,
    fork_commit: input.descoberta.forkCommit,
    merge_base_commit: input.descoberta.mergeBaseCommit,
    upstream_commit: input.descoberta.upstreamCommit,
    total_commits_delta: input.commitsTotal,
    total_commits_analyzed: input.commitsAnalyzed,
    total_files_delta: totalFiles,
    total_files_analyzed: files.length,
    parity: {
      commits: input.commitsTotal === input.commitsAnalyzed,
      files: totalFiles === files.length,
    },
    counts,
    categories,
    files,
    conflict_status: conflicts.status,
    conflicts: conflicts.conflicts,
  };
}

export function statusDaAnalise(summary: ResumoAnaliseUpstream): StatusAnalise {
  return summary.parity.commits && summary.parity.files ? "completed" : "incomplete";
}

export async function analisarUpstream(
  descoberta: DescobertaUpstream,
  fetchImpl: typeof fetch = fetch,
): Promise<{ summary: ResumoAnaliseUpstream; risk: NivelRisco; status: StatusAnalise }> {
  const commits = await commitsDoDelta(descoberta, fetchImpl);
  const [baseTree, upstreamTree, forkTree] = await Promise.all([
    arvoreDoCommit(CRIVO_REPOSITORY.upstream, descoberta.mergeBaseCommit, fetchImpl),
    arvoreDoCommit(CRIVO_REPOSITORY.upstream, descoberta.upstreamCommit, fetchImpl),
    arvoreDoCommit(CRIVO_REPOSITORY.fork, descoberta.forkCommit, fetchImpl),
  ]);
  const summary = montarResumoAnalise({
    descoberta,
    commitsTotal: commits.total,
    commitsAnalyzed: commits.analyzed,
    upstreamFiles: compararArvores(baseTree, upstreamTree),
    forkFiles: compararArvores(baseTree, forkTree),
  });
  return { summary, risk: maiorRisco(summary.files), status: statusDaAnalise(summary) };
}

function resumoCompacto(summary: ResumoAnaliseUpstream): Record<string, unknown> {
  return {
    fork_reference: summary.fork_reference,
    fork_reference_source: summary.fork_reference_source,
    fork_commit: summary.fork_commit,
    parity: summary.parity,
    counts: summary.counts,
    categories: summary.categories,
    conflict_status: summary.conflict_status,
    conflicts: summary.conflicts.length,
  };
}

export async function executarCrivoUpstream(options?: {
  fetchImpl?: typeof fetch;
  now?: Date;
  db?: AdminClient;
  env?: AmbienteCrivo;
}): Promise<{ result: "no_change" | "update_available" | "failed"; analysis_status: StatusAnalise; error?: string }> {
  const db = options?.db ?? (await import("@/lib/supabase/admin")).createAdminClient();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? new Date();
  const next = new Date(now.getTime() + INTERVALO_CRIVO_MS);

  const { data: previous, error: stateError } = await db
    .from("system_upstream_state")
    .select(
      "local_commit,last_seen_commit,latest_upstream_commit,last_seen_tag,last_seen_release,risk_level,analysis_status,analysis_summary",
    )
    .eq("id", 1)
    .maybeSingle();
  if (stateError) throw new Error(`system_upstream_state: ${stateError.message}`);

  const { data: check, error: startError } = await db
    .from("system_upstream_checks")
    .insert({
      repository: CRIVO_REPOSITORY.upstream,
      started_at: now.toISOString(),
      result: "started",
      analysis_status: "never",
      events: ["UPSTREAM_CHECK_STARTED"],
    })
    .select("id")
    .single();
  if (startError || !check) throw new Error(`system_upstream_checks: ${startError?.message ?? "sem id"}`);

  const previousState = (previous ?? {}) as EstadoAnterior;
  let descobertaAtual: DescobertaUpstream | null = null;
  try {
    const descoberta = await descobrirUpstream(fetchImpl, options?.env ?? process.env);
    descobertaAtual = descoberta;
    const sameSnapshot = !snapshotMudou(previousState, descoberta);

    if (sameSnapshot) {
      const events = ["UPSTREAM_CHECK_STARTED", "UPSTREAM_CHECK_OK", "UPSTREAM_NO_CHANGE"];
      await db
        .from("system_upstream_state")
        .upsert({
          id: 1,
          repository: descoberta.repository,
          default_branch: descoberta.defaultBranch,
          local_commit: descoberta.forkCommit,
          latest_upstream_commit: descoberta.upstreamCommit,
          last_checked_at: now.toISOString(),
          next_check_at: next.toISOString(),
          update_available: descoberta.commitsBehind > 0,
          commits_behind: descoberta.commitsBehind,
          updated_at: now.toISOString(),
        });
      await db
        .from("system_upstream_checks")
        .update({
          finished_at: now.toISOString(),
          default_branch: descoberta.defaultBranch,
          local_commit: descoberta.forkCommit,
          upstream_commit: descoberta.upstreamCommit,
          result: "no_change",
          analysis_status: "no_change",
          commits_delta: descoberta.commitsBehind,
          risk_level: previousState.risk_level ?? "low",
          events,
        })
        .eq("id", check.id);
      await podarHistorico(db, now);
      return { result: "no_change", analysis_status: "no_change" };
    }

    const analysis = await analisarUpstream(descoberta, fetchImpl);
    const complete = analysis.status === "completed";
    const events = ["UPSTREAM_CHECK_STARTED", "UPSTREAM_CHECK_OK"];
    if (descoberta.commitsBehind > 0) events.push("UPSTREAM_UPDATE_DETECTED");
    events.push(complete ? "UPDATE_ANALYSIS_COMPLETED" : "UPDATE_ANALYSIS_FAILED");
    const result = descoberta.commitsBehind > 0 ? "update_available" : "no_change";

    await db.from("system_upstream_state").upsert({
      id: 1,
      repository: descoberta.repository,
      default_branch: descoberta.defaultBranch,
      local_commit: descoberta.forkCommit,
      last_seen_commit: complete ? descoberta.upstreamCommit : (previousState.last_seen_commit ?? ""),
      latest_upstream_commit: descoberta.upstreamCommit,
      last_seen_tag: complete ? descoberta.latestTag : (previousState.last_seen_tag ?? ""),
      last_seen_release: complete ? descoberta.latestRelease : (previousState.last_seen_release ?? ""),
      last_checked_at: now.toISOString(),
      next_check_at: next.toISOString(),
      update_available: descoberta.commitsBehind > 0,
      commits_behind: descoberta.commitsBehind,
      files_changed: analysis.summary.total_files_delta,
      risk_level: analysis.risk,
      analysis_status: analysis.status,
      analysis_summary: analysis.summary,
      updated_at: now.toISOString(),
    });
    await db
      .from("system_upstream_checks")
      .update({
        finished_at: now.toISOString(),
        default_branch: descoberta.defaultBranch,
        local_commit: descoberta.forkCommit,
        upstream_commit: descoberta.upstreamCommit,
        result,
        commits_delta: analysis.summary.total_commits_delta,
        commits_analyzed: analysis.summary.total_commits_analyzed,
        files_delta: analysis.summary.total_files_delta,
        files_analyzed: analysis.summary.total_files_analyzed,
        risk_level: analysis.risk,
        analysis_status: analysis.status,
        events,
        summary: resumoCompacto(analysis.summary),
      })
      .eq("id", check.id);
    await podarHistorico(db, now);
    return { result, analysis_status: analysis.status };
  } catch (error) {
    const sanitized = sanitizarErro(error);
    const incomplete = error instanceof CrivoUpstreamError && error.code === "analysis_incomplete";
    const analysisStatus: StatusAnalise = incomplete ? "incomplete" : "failed";
    await db.from("system_upstream_state").upsert({
      id: 1,
      repository: CRIVO_REPOSITORY.upstream,
      ...(descobertaAtual
        ? {
            default_branch: descobertaAtual.defaultBranch,
            local_commit: descobertaAtual.forkCommit,
            latest_upstream_commit: descobertaAtual.upstreamCommit,
            update_available: descobertaAtual.commitsBehind > 0,
            commits_behind: descobertaAtual.commitsBehind,
          }
        : {}),
      last_checked_at: now.toISOString(),
      next_check_at: next.toISOString(),
      analysis_status: analysisStatus,
      updated_at: now.toISOString(),
    });
    await db
      .from("system_upstream_checks")
      .update({
        finished_at: now.toISOString(),
        result: "failed",
        analysis_status: analysisStatus,
        events: [
          "UPSTREAM_CHECK_STARTED",
          incomplete ? "UPDATE_ANALYSIS_FAILED" : "UPSTREAM_CHECK_FAILED",
        ],
        error: sanitized,
      })
      .eq("id", check.id);
    await podarHistorico(db, now);
    return { result: "failed", analysis_status: analysisStatus, error: sanitized };
  }
}

async function podarHistorico(
  db: AdminClient,
  now: Date,
): Promise<void> {
  const cutoff = new Date(now.getTime() - RETENCAO_HISTORICO_DIAS * 24 * 60 * 60 * 1000);
  await db.from("system_upstream_checks").delete().lt("started_at", cutoff.toISOString());
}
