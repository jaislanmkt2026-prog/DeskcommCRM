import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://build-placeholder.example",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "build-anon-key",
    SENTRY_DSN: "off",
  },
}));

import { PublicEnvScript } from "@/app/public-env-script";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;

  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
});

describe("PublicEnvScript — Supabase de runtime", () => {
  test("runtime vence o snapshot de build para URL e anon key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:59991";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "runtime-anon-key";

    const element = await PublicEnvScript({
      marca: { name: "JS Imóveis", logoUrl: null },
    });

    const html = (
      element.props as {
        dangerouslySetInnerHTML: { __html: string };
      }
    ).dangerouslySetInnerHTML.__html;

    const prefix = "window.__PUBLIC_ENV__=";
    expect(html.startsWith(prefix)).toBe(true);

    const payload = JSON.parse(html.slice(prefix.length, -1)) as {
      NEXT_PUBLIC_SUPABASE_URL: string;
      NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
    };

    expect(payload.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:59991");
    expect(payload.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("runtime-anon-key");
    expect(payload.NEXT_PUBLIC_SUPABASE_URL).not.toContain("build-placeholder");
    expect(payload.NEXT_PUBLIC_SUPABASE_ANON_KEY).not.toContain("build-anon-key");
  });
});
