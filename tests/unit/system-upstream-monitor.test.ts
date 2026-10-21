import { describe, expect, it, vi } from "vitest";

import {
  CRIVO_REPOSITORY,
  classificarArquivos,
  compararArvores,
  detectarConflitos,
  descobrirUpstream,
  montarResumoAnalise,
  resolverReferenciaFork,
  snapshotMudou,
  statusDaAnalise,
  type DescobertaUpstream,
  type EntradaArvoreGit,
} from "@/lib/system/upstream-monitor";

const descoberta: DescobertaUpstream = {
  repository: "melgarafael/DeskcommCRM",
  defaultBranch: "main",
  forkReference: "release/js-imoveis",
  forkReferenceSource: "CRIVO_FORK_REF",
  forkCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  upstreamCommit: "upstream",
  mergeBaseCommit: "base",
  latestTag: "v1.50.0",
  latestRelease: "v1.50.0",
  commitsBehind: 2,
};

const blob = (path: string, sha: string): EntradaArvoreGit => ({ path, sha, type: "blob" });

describe("Crivo interno — delta completo", () => {
  it("classifica add/modify/delete/rename sem inventar renome ambíguo", () => {
    const base = [
      blob("igual.ts", "1"),
      blob("mod.ts", "2"),
      blob("old.ts", "3"),
      blob("gone.ts", "4"),
    ];
    const head = [
      blob("igual.ts", "1"),
      blob("mod.ts", "22"),
      blob("new.ts", "3"),
      blob("added.ts", "5"),
    ];
    expect(compararArvores(base, head)).toEqual([
      { path: "added.ts", status: "added" },
      { path: "gone.ts", status: "deleted" },
      { path: "mod.ts", status: "modified" },
      { path: "new.ts", previous_path: "old.ts", status: "renamed" },
    ]);
  });

  it("migration eleva risco para CRÍTICO", () => {
    const [file] = classificarArquivos([
      { path: "supabase/migrations/20260926000000_9999_x.sql", status: "added" },
    ]);
    expect(file).toMatchObject({ area: "Banco", risk: "critical" });
  });

  it("arquivo tocado nos dois lados sinaliza conflito crítico em área de risco", () => {
    const upstream = classificarArquivos([
      { path: "docker/scheduler/entrypoint.sh", status: "modified" },
    ]);
    expect(
      detectarConflitos(upstream, [
        { path: "docker/scheduler/entrypoint.sh", status: "modified" },
      ]),
    ).toMatchObject({ status: "CONFLITO CRÍTICO" });
  });

  it("paridade incompleta nunca vira análise concluída", () => {
    const summary = montarResumoAnalise({
      descoberta,
      commitsTotal: 2,
      commitsAnalyzed: 1,
      upstreamFiles: [{ path: "app/a.ts", status: "modified" }],
      forkFiles: [],
    });
    expect(summary.parity.commits).toBe(false);
    expect(statusDaAnalise(summary)).toBe("incomplete");
  });
});

describe("Crivo interno — descoberta pública", () => {
  const anterior = {
    local_commit: descoberta.forkCommit,
    latest_upstream_commit: descoberta.upstreamCommit,
    last_seen_tag: descoberta.latestTag,
    last_seen_release: descoberta.latestRelease,
    analysis_status: "completed",
    analysis_summary: { fork_reference: descoberta.forkReference },
  };

  it("HEAD novo força análise", () => {
    expect(snapshotMudou(anterior, { ...descoberta, upstreamCommit: "upstream-novo" })).toBe(true);
  });

  it("tag nova força análise mesmo com HEAD igual", () => {
    expect(snapshotMudou(anterior, { ...descoberta, latestTag: "v1.51.0" })).toBe(true);
  });

  it("release nova força análise mesmo com HEAD igual", () => {
    expect(snapshotMudou(anterior, { ...descoberta, latestRelease: "v1.51.0" })).toBe(true);
  });

  it("snapshot idêntico já analisado é NO_CHANGE", () => {
    expect(snapshotMudou(anterior, descoberta)).toBe(false);
  });

  it("troca da referência oficial força nova análise mesmo quando aponta para o mesmo SHA", () => {
    expect(snapshotMudou(anterior, { ...descoberta, forkReference: "release/js-imoveis-2" })).toBe(true);
  });

  it("não contém a branch histórica como regra estrutural", () => {
    expect(CRIVO_REPOSITORY).not.toHaveProperty("forkBranch");
  });

  it("APP_REVISION é a referência canônica da imagem quando contém SHA completo", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(resolverReferenciaFork({ APP_REVISION: sha, CRIVO_FORK_REF: "release/outra" })).toEqual({
      reference: sha,
      source: "APP_REVISION",
    });
  });

  it("referência ausente ou inválida falha fechado", () => {
    expect(() => resolverReferenciaFork({})).toThrowError(/Referência oficial do fork ausente/);
    expect(() => resolverReferenciaFork({ CRIVO_FORK_REF: "../../ref ruim" })).toThrowError(
      /formato Git inválido/,
    );
    expect(() => resolverReferenciaFork({ APP_REVISION: "abc" })).toThrowError(/SHA Git completo/);
  });

  it("sem referência oficial a descoberta termina antes da rede e nunca produz análise completa", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(descobrirUpstream(fetchImpl, {})).rejects.toMatchObject({
      code: "invalid_fork_reference",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a referência configurada é resolvida para o SHA usado na comparação", async () => {
    const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const upstream = "cccccccccccccccccccccccccccccccccccccccc";
    const mergeBase = "dddddddddddddddddddddddddddddddddddddddd";
    const comparisons: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith("/repos/melgarafael/DeskcommCRM")) return json({ default_branch: "main" });
      if (url.includes("/repos/jaislanmkt2026-prog/DeskcommCRM/commits/release%2Fa")) return json({ sha: shaA });
      if (url.includes("/repos/jaislanmkt2026-prog/DeskcommCRM/commits/release%2Fb")) return json({ sha: shaB });
      if (url.endsWith("/repos/melgarafael/DeskcommCRM/commits/main")) return json({ sha: upstream });
      if (url.includes("/compare/")) {
        comparisons.push(url);
        const base = url.includes(shaA) ? shaA : shaB;
        return json({
          ahead_by: 2,
          behind_by: 0,
          total_commits: 2,
          base_commit: { sha: base },
          merge_base_commit: { sha: mergeBase },
          commits: [],
        });
      }
      if (url.includes("/tags?")) return json([{ name: "v1.50.0" }]);
      if (url.endsWith("/releases/latest")) return json({ tag_name: "v1.50.0" });
      throw new Error(`URL inesperada: ${url}`);
    };

    const a = await descobrirUpstream(fetchImpl, { CRIVO_FORK_REF: "release/a" });
    const b = await descobrirUpstream(fetchImpl, { CRIVO_FORK_REF: "release/b" });
    expect(a.forkCommit).toBe(shaA);
    expect(b.forkCommit).toBe(shaB);
    expect(comparisons).toHaveLength(2);
    expect(comparisons[0]).toContain(shaA);
    expect(comparisons[1]).toContain(shaB);
  });

  it("upstream indisponível falha fechado e não inventa estado atualizado", async () => {
    const brokenFetch: typeof fetch = async () => {
      throw new Error("network down");
    };
    await expect(descobrirUpstream(brokenFetch, { CRIVO_FORK_REF: "release/js-imoveis" })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });
});
