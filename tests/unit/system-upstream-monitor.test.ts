import { describe, expect, it } from "vitest";

import {
  classificarArquivos,
  compararArvores,
  detectarConflitos,
  descobrirUpstream,
  montarResumoAnalise,
  snapshotMudou,
  statusDaAnalise,
  type DescobertaUpstream,
  type EntradaArvoreGit,
} from "@/lib/system/upstream-monitor";

const descoberta: DescobertaUpstream = {
  repository: "melgarafael/DeskcommCRM",
  defaultBranch: "main",
  localCommit: "local",
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
    local_commit: descoberta.localCommit,
    latest_upstream_commit: descoberta.upstreamCommit,
    last_seen_tag: descoberta.latestTag,
    last_seen_release: descoberta.latestRelease,
    analysis_status: "completed",
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

  it("upstream indisponível falha fechado e não inventa estado atualizado", async () => {
    const brokenFetch: typeof fetch = async () => {
      throw new Error("network down");
    };
    await expect(descobrirUpstream(brokenFetch)).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });
});
