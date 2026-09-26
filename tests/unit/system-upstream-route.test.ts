import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarCrivoUpstream } from "@/lib/system/upstream-monitor";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/system/upstream-monitor", () => ({ executarCrivoUpstream: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("/api/v1/system/upstream", () => {
  it("tenant admin sem autoridade de plataforma recebe 403 antes do service role", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue({ id: "u", is_platform_admin: false } as never);
    const { GET } = await import("@/app/api/v1/system/upstream/route");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each(["merge", "apply", "update"])("não aceita ação destrutiva %s", async (action) => {
    vi.mocked(loadAuthUser).mockResolvedValue({ id: "owner", is_platform_admin: true } as never);
    const { POST } = await import("@/app/api/v1/system/upstream/route");
    const response = await POST(
      new NextRequest("http://localhost/api/v1/system/upstream", {
        method: "POST",
        body: JSON.stringify({ action }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
    expect(executarCrivoUpstream).not.toHaveBeenCalled();
  });
});
