import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { isPublicPath } from "@/lib/auth/public-paths";
import { deterministicAuditId } from "@/lib/integrations/external-auth";

describe("Time Chaves / Squad100 integration contract", () => {
  it("lets bearer-auth integration routes reach their own auth gate", () => {
    expect(isPublicPath("/api/v1/integrations/time-chaves/state")).toBe(true);
    expect(isPublicPath("/api/v1/integrations/time-chaves/events")).toBe(true);
    expect(isPublicPath("/api/v1/integrations/squad100/artifacts")).toBe(true);
  });

  it("does not make neighboring integration paths public", () => {
    expect(isPublicPath("/api/v1/integrations/time-chaves/state/extra")).toBe(false);
    expect(isPublicPath("/api/v1/integrations/squad100/artifacts/extra")).toBe(false);
  });

  it("keeps integration audit actions in the canonical vocabulary", () => {
    expect(AUDIT_ACTIONS).toContain("integration.time_chaves.event_received");
    expect(AUDIT_ACTIONS).toContain("integration.squad100.artifact_received");
  });

  it("derives a stable idempotency id from tenant/source/correlation", () => {
    const a = deterministicAuditId("org-a", "time_chaves", "task:123");
    const b = deterministicAuditId("org-a", "time_chaves", "task:123");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  });

  it("changes the id across source or tenant boundaries", () => {
    const base = deterministicAuditId("org-a", "time_chaves", "same");
    expect(deterministicAuditId("org-b", "time_chaves", "same")).not.toBe(base);
    expect(deterministicAuditId("org-a", "squad100", "same")).not.toBe(base);
  });
});
