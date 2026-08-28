import { describe, it, expect } from "vitest";
import { createActiveSpaceTracker } from "../src/index.ts";
import { resolveAutoClose, buildAiSearchScript } from "../src/ai-search.ts";

describe("active ego task space (single tracker semantics)", () => {
  it("routes omitted-space calls to the most recently opened space", () => {
    const tracker = createActiveSpaceTracker("dsh-agent").shared;
    tracker.opened({ name: "open bilibili" }, { ok: true, id: 45, name: "open bilibili" });
    expect(tracker.current()).toBe(45);
  });

  it("tracks explicit selection and resets after closing the active space", () => {
    const tracker = createActiveSpaceTracker("dsh-agent").shared;
    tracker.selected("research");
    expect(tracker.current()).toBe("research");
    tracker.closed("research", true);
    expect(tracker.current()).toBe("dsh-agent");
  });

  it("resets an ID-backed active space when closed by its name", () => {
    const tracker = createActiveSpaceTracker("dsh-agent").shared;
    tracker.opened({ name: "task" }, { ok: true, id: 45, name: "task" });
    tracker.closed("task", true);
    expect(tracker.current()).toBe("dsh-agent");
  });
});

describe("per-agent space isolation", () => {
  const agentA = { id: "agent-aaaa" };
  const agentB = { id: "agent-bbbb" };

  it("gives each agent an independent active space", () => {
    const map = createActiveSpaceTracker("dsh-agent");
    const a = map.for(agentA);
    const b = map.for(agentB);
    a.opened({ name: "space A" }, { ok: true, id: 1, name: "space A" });
    b.opened({ name: "space B" }, { ok: true, id: 2, name: "space B" });
    expect(a.current()).toBe(1);
    expect(b.current()).toBe(2);
  });

  it("is not cross-polluted by another agent's explicit selection", () => {
    const map = createActiveSpaceTracker("dsh-agent");
    map.for(agentA).opened({ name: "A" }, { ok: true, id: 1, name: "A" });
    // Agent B selects its own space — agent A's default must NOT follow.
    map.for(agentB).selected("B-goal");
    expect(map.for(agentA).current()).toBe(1);
    expect(map.for(agentB).current()).toBe("B-goal");
  });

  it("a close by one agent does not break another agent's routing", () => {
    const map = createActiveSpaceTracker("dsh-agent");
    map.for(agentA).opened({ name: "A" }, { ok: true, id: 1, name: "A" });
    map.for(agentB).opened({ name: "B" }, { ok: true, id: 2, name: "B" });
    map.for(agentB).closed(2, true);
    // A still routes to its own space (the old shared tracker reported
    // 'no active task space' here because B's close reset the singleton).
    expect(map.for(agentA).current()).toBe(1);
    expect(map.for(agentB).current()).toBe("dsh-agent");
  });

  it("returns the same tracker instance per agent (state persists across calls)", () => {
    const map = createActiveSpaceTracker("dsh-agent");
    expect(map.for(agentA)).toBe(map.for(agentA));
    expect(map.for(agentB)).not.toBe(map.for(agentA));
  });

  it("falls back to the shared tracker when the call has no agent", () => {
    const map = createActiveSpaceTracker("dsh-agent");
    expect(map.for(undefined)).toBe(map.shared);
    expect(map.for(null)).toBe(map.shared);
    map.shared.opened({ name: "host" }, { ok: true, id: 9, name: "host" });
    expect(map.for(undefined).current()).toBe(9);
    // Agent trackers stay untouched by shared-state writes.
    expect(map.for(agentA).current()).toBe("dsh-agent");
  });
});

describe("search space semantics", () => {
  it("auto-closes any tool-owned web-search* space (per-agent names included)", () => {
    expect(resolveAutoClose("web-search", false)).toBe(true);
    expect(resolveAutoClose("web-search@1a2b3c", false)).toBe(true);
    expect(resolveAutoClose("web-search@1a2b3c", true)).toBe(false);
    expect(resolveAutoClose("my-goal", false)).toBe(false);
  });

  it("builds the script against the per-agent default space", () => {
    const useSpace = (name: string) => `/*use:${name}*/`;
    const script = buildAiSearchScript(
      { queries: ["test"] },
      useSpace,
      () => "",
      "web-search@1a2b3c",
    );
    expect(script).toContain("/*use:web-search@1a2b3c*/");
    // Explicit space still wins over the per-agent default.
    const explicit = buildAiSearchScript(
      { queries: ["test"], space: "my-goal" },
      useSpace,
      () => "",
      "web-search@1a2b3c",
    );
    expect(explicit).toContain("/*use:my-goal*/");
    // No defaultSpace argument → legacy shared name.
    const legacy = buildAiSearchScript({ queries: ["test"] }, useSpace, () => "");
    expect(legacy).toContain("/*use:web-search*/");
  });
});
