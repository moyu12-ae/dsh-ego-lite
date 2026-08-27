import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveEngine, buildSpawnArgv, engineEnv, deriveSiteSkillsDir, type EngineIo } from "../src/engine.ts";

const HOME = "/home/tester";

/** Declarative in-memory filesystem the engine probes through EngineIo. */
function makeIo(files: Set<string>, dirs: Map<string, string[]>): EngineIo {
  return {
    exists: (p) => files.has(p),
    list: (p) => {
      const entries = dirs.get(p);
      if (entries === undefined) throw new Error(`ENOENT: ${p}`);
      return entries;
    },
  };
}

const NO_FILES = new Set<string>();
const NO_DIRS = new Map<string, string[]>();

/** Register a full framework-helper layout under an app-search root. */
function addFramework(root: string, opts: { current?: boolean; versions?: string[] }) {
  const files = new Set(NO_FILES);
  const dirs = new Map(NO_DIRS);
  const frameworksRoot = join(root, "ego lite.app", "Contents", "Frameworks");
  const fw = join(frameworksRoot, "EgoHelper");
  dirs.set(frameworksRoot, ["EgoHelper"]);
  if (opts.current) {
    files.add(join(fw, "Versions", "Current", "Helpers", "ego-browser"));
    dirs.set(join(fw), ["Versions"]);
  }
  if (opts.versions?.length) {
    dirs.set(join(fw, "Versions"), opts.versions);
    for (const v of opts.versions) files.add(join(fw, "Versions", v, "Helpers", "ego-browser"));
  }
  return makeIo(files, dirs);
}

describe("resolveEngine", () => {
  it("trusts an existing configured .mjs binary as the vendored flavor", () => {
    const io = makeIo(new Set(["/custom/ego.mjs"]), NO_DIRS);
    expect(resolveEngine({ home: HOME, platform: "darwin", configuredEgoBin: "/custom/ego.mjs", io }))
      .toMatchObject({ flavor: "vendored", binPath: "/custom/ego.mjs", jsRuntime: true, origin: "configured" });
  });

  it("treats an existing configured extension-less binary as the app flavor", () => {
    const io = makeIo(new Set(["/custom/ego-browser"]), NO_DIRS);
    expect(resolveEngine({ home: HOME, platform: "darwin", configuredEgoBin: "/custom/ego-browser", io }))
      .toMatchObject({ flavor: "app", jsRuntime: false, origin: "configured" });
  });

  it("ignores a configured path that does not exist and falls through", () => {
    expect(resolveEngine({ home: HOME, platform: "linux", configuredEgoBin: "/gone/ego-browser" }).flavor)
      .toBe("vendored");
  });

  it("prefers the ~/.local/bin onboarding symlink on darwin auto", () => {
    const link = join(HOME, ".local", "bin", "ego-browser");
    const r = resolveEngine({
      home: HOME, platform: "darwin",
      io: makeIo(new Set([link]), NO_DIRS),
    });
    expect(r).toMatchObject({ flavor: "app", binPath: link });
    expect(r.origin).toContain(".local/bin");
  });

  it("falls back to the Current framework helper under the injected home's Applications dir", () => {
    const r = resolveEngine({ home: HOME, platform: "darwin", io: addFramework(join(HOME, "Applications"), { current: true }) });
    expect(r.flavor).toBe("app");
    expect(r.binPath).toContain(join(HOME, "Applications"));
    expect(r.jsRuntime).toBe(false);
  });

  it("without Current, picks the highest numeric version directory", () => {
    const r = resolveEngine({ home: HOME, platform: "darwin", io: addFramework(join(HOME, "Applications"), { versions: ["0.4.7.2", "0.4.7.10"] }) });
    expect(r.flavor).toBe("app");
    expect(r.binPath).toContain("0.4.7.10");
  });

  it("honors engineMode=vendored even when the app is installed", () => {
    const link = join(HOME, ".local", "bin", "ego-browser");
    const r = resolveEngine({
      home: HOME, platform: "darwin", engineMode: "vendored",
      io: makeIo(new Set([link]), NO_DIRS),
    });
    expect(r).toMatchObject({ flavor: "vendored", jsRuntime: true });
    expect(r.origin).toContain("vendored");
  });

  it("returns the vendored runtime off-darwin", () => {
    const r = resolveEngine({ home: HOME, platform: "linux" });
    expect(r.flavor).toBe("vendored");
    expect(r.jsRuntime).toBe(true);
    expect(r.binPath.endsWith("ego-browser.mjs")).toBe(true);
  });
});

describe("buildSpawnArgv / engineEnv", () => {
  const native = { flavor: "app", binPath: "/apps/helper/ego-browser", jsRuntime: false, origin: "test" } as const;
  const js = { flavor: "vendored", binPath: "/x/ego-browser.mjs", jsRuntime: true, origin: "test" } as const;

  it("prefixes node only for JS-runtime flavors", () => {
    expect(buildSpawnArgv(native, [], "/usr/bin/node")).toEqual(["/apps/helper/ego-browser", "nodejs"]);
    expect(buildSpawnArgv(js, ["--sdk-path=/p"], "/usr/bin/node")).toEqual([
      "/usr/bin/node", "/x/ego-browser.mjs", "nodejs", "--sdk-path=/p",
    ]);
  });

  it("strips EGO_LINUX_* keys from the app flavor env only", () => {
    const base = { PATH: "/bin", EGO_LINUX_CHROME: "/chrome", EGO_LINUX_HEADLESS: "0", HOME: "/h" };
    const appEnv = engineEnv(native as never, base);
    expect(appEnv.EGO_LINUX_CHROME).toBeUndefined();
    expect(appEnv.PATH).toBe("/bin");
    expect(engineEnv(js as never, base).EGO_LINUX_CHROME).toBe("/chrome");
  });
});

describe('deriveSiteSkillsDir (official learnings packs)', () => {
  it('resolves Resources/ego-skills next to a bundle Helpers helper', () => {
    const root = mkdtempSync(join(tmpdir(), 'ego-engine-'))
    try {
      const helper = join(root, 'ego lite.app', 'Contents', 'Frameworks', 'ego Framework.framework', 'Versions', '0.4.7.3', 'Helpers', 'ego-browser')
      const skills = join(root, 'ego lite.app', 'Contents', 'Frameworks', 'ego Framework.framework', 'Versions', '0.4.7.3', 'Resources', 'ego-skills')
      mkdirSync(join(helper, '..'), { recursive: true })
      mkdirSync(join(skills, 'ego-browser', 'learnings'), { recursive: true })
      writeFileSync(helper, '#!/bin/sh\n')
      writeFileSync(join(skills, 'ego-browser', 'manifest.json'), '{}')
      // macOS resolves /var → /private/var under realpath; the first
      // candidate directory derives from the realpathed helper.
      expect(deriveSiteSkillsDir(helper)).toBe(realpathSync(skills))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('returns null for non-bundle paths (vendored/configured binaries)', () => {
    expect(deriveSiteSkillsDir('/usr/local/bin/ego-browser')).toBe(null)
    expect(deriveSiteSkillsDir('/definitely/not/here')).toBe(null)
  })
})
