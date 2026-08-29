import { describe, it, expect } from "vitest";
import { Config, resolveConfig, tokenizeArgs, filterArgs, EGO_CLI_BLOCKED, CHROME_BLOCKED } from "../src/config.ts";

describe("engine config", () => {
  it("returns canonical defaults", () => {
    expect(resolveConfig({})).toEqual({
      chromePath: "",
      egoCliArgs: "", chromeArgs: "",
      engineMode: "auto", execSession: "auto",
    });
  });

  it("ignores removed preview-era keys instead of crashing (persisted legacy values)", () => {
    const c = resolveConfig({ captureBackend: "ffmpeg", streamProfile: "high", cdpFps: 30, ffmpegBitrateKbps: 9000, castFpsCap: 60 } as any);
    expect(c).toEqual(resolveConfig({}));
  });

  it("falls back for invalid enums and keeps valid ones", () => {
    expect(resolveConfig({ engineMode: "bad" } as any).engineMode).toBe("auto");
    expect(resolveConfig({ engineMode: "app" }).engineMode).toBe("app");
    expect(resolveConfig({ execSession: "persistent" }).execSession).toBe("persistent");
    expect(resolveConfig({ execSession: "bad" } as any).execSession).toBe("auto");
  });
});

// ── user-defined extra CLI args (egoCliArgs / chromeArgs) ───────────────────

describe("user-defined extra CLI args", () => {
  it("resolveConfig defaults egoCliArgs / chromeArgs to empty strings", () => {
    const c = resolveConfig({});
    expect(c.egoCliArgs).toBe("");
    expect(c.chromeArgs).toBe("");
  });

  it("resolveConfig passes through non-string as empty string", () => {
    const c = resolveConfig({ egoCliArgs: 123, chromeArgs: null } as any);
    expect(c.egoCliArgs).toBe("");
    expect(c.chromeArgs).toBe("");
  });

  it("resolveConfig preserves the raw string (filtering happens at call site)", () => {
    const c = resolveConfig({ egoCliArgs: "--status --sdk-path /x", chromeArgs: "--headless --proxy-server=bad" });
    // Stored raw; blocklist is applied by filterArgs at spawn time so a saved
    // value is not silently mutated by a later blocklist change.
    expect(c.egoCliArgs).toBe("--status --sdk-path /x");
    expect(c.chromeArgs).toBe("--headless --proxy-server=bad");
  });
});

describe("tokenizeArgs", () => {
  it("returns [] for empty / whitespace-only input", () => {
    expect(tokenizeArgs("")).toEqual([]);
    expect(tokenizeArgs("   ")).toEqual([]);
    expect(tokenizeArgs("\t\n")).toEqual([]);
    expect(tokenizeArgs(undefined)).toEqual([]);
    expect(tokenizeArgs(null)).toEqual([]);
  });

  it("splits on bare whitespace", () => {
    expect(tokenizeArgs("--a --b c")).toEqual(["--a", "--b", "c"]);
  });

  it("preserves quoted tokens as single args", () => {
    expect(tokenizeArgs('"--a value" --b')).toEqual(["--a value", "--b"]);
    expect(tokenizeArgs("'path with spaces' --b")).toEqual(["path with spaces", "--b"]);
  });

  it("handles backslash escapes", () => {
    expect(tokenizeArgs('a\\ b c')).toEqual(["a b", "c"]);
    expect(tokenizeArgs('"a\\"b"')).toEqual(['a"b']);
  });

  it("keeps = attached to its flag", () => {
    expect(tokenizeArgs("--proxy-server=http://host:7890 --x")).toEqual(["--proxy-server=http://host:7890", "--x"]);
  });
});

describe("filterArgs", () => {
  it("drops blocked bare flags and their value when value is non-flag", () => {
    // --status is blocked and would exit before the heredoc; drop it.
    const out = filterArgs("--status --sdk-path /x", EGO_CLI_BLOCKED);
    expect(out).toEqual(["--sdk-path", "/x"]);
  });

  it("drops blocked =-form flags without consuming a value", () => {
    const out = filterArgs("--headless=new --keep-me", CHROME_BLOCKED);
    expect(out).toEqual(["--keep-me"]);
  });

  it("does not drop a value that happens to start with - after a blocked bare flag", () => {
    // --headless is blocked; next token starts with -, so it is NOT its value.
    const out = filterArgs("--headless --other", CHROME_BLOCKED);
    expect(out).toEqual(["--other"]);
  });

  it("drops --proxy-server and its value (use EGO_LINUX_PROXY instead)", () => {
    const out = filterArgs("--proxy-server=http://x --keep", CHROME_BLOCKED);
    expect(out).toEqual(["--keep"]);
  });

  it("drops a bare --proxy-server plus its separate value", () => {
    const out = filterArgs("--proxy-server http://x --keep", CHROME_BLOCKED);
    expect(out).toEqual(["--keep"]);
  });

  it("preserves allowed args verbatim (order + quoting collapsed by tokenizer)", () => {
    const out = filterArgs("--disable-features=Translate --window-size=800,600", CHROME_BLOCKED);
    expect(out).toEqual(["--disable-features=Translate", "--window-size=800,600"]);
  });

  it("returns [] when all args are blocked", () => {
    expect(filterArgs("--status --stop --help", EGO_CLI_BLOCKED)).toEqual([]);
  });
});

// ── Config schema (composition layer + settings namespace) ──────────────────
// Regression guard for the audit fix: the schema now DECLARES the plugin-level
// fields apply() actually consumes (defaultSpace/egoBin/maxOutputBytes/graceMs),
// so they are validated instead of silently passing through RawConfig.

describe("Config schema (composition layer)", () => {
  it("accepts the full plugin-level field set with correct types", () => {
    const c = Config({
      defaultSpace: "dsh-agent",
      egoBin: "/usr/local/bin/ego",
      maxOutputBytes: 1048576,
      graceMs: 20000,
      chromePath: "/Applications/Chrome",
    });
    expect(c.defaultSpace).toBe("dsh-agent");
    expect(c.egoBin).toBe("/usr/local/bin/ego");
    expect(c.maxOutputBytes).toBe(1048576);
    expect(c.graceMs).toBe(20000);
  });

  it("accepts a numeric defaultSpace (space id form)", () => {
    expect(Config({ defaultSpace: 7 }).defaultSpace).toBe(7);
  });

  it("rejects wrong types for the new numeric fields (runtime guard; TS already blocks at compile time)", () => {
    // User config comes from cordis.yml JSON, which bypasses TS — the runtime
    // schema must still reject a bad type.
    expect(() => Config({ maxOutputBytes: "8" } as any)).toThrow();
    expect(() => Config({ graceMs: "1000" } as any)).toThrow();
  });

  it("rejects a bad defaultSpace type (runtime guard)", () => {
    expect(() => Config({ defaultSpace: {} } as any)).toThrow();
  });

  it("keeps validating existing enums", () => {
    expect(Config({ engineMode: "app" }).engineMode).toBe("app");
    expect(() => Config({ engineMode: "bad" } as any)).toThrow();
  });
});
