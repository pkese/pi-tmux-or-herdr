import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExecutable } from "../lib/path.ts";
import { quote } from "../lib/transport.ts";

const guideUrl = (name: string) => new URL(`../guides/${name}.md`, import.meta.url);

test("native tmux guide targets returned pane IDs with nonzero configured indexes", async t => {
  const tmux = await findExecutable("tmux");
  if (!tmux || process.platform !== "linux") { t.skip("Requires Linux tmux for isolated native regression"); return; }
  const root = await mkdtemp(join(tmpdir(), "native-tmux-guide-test-"));
  // A private socket and config: never connect to or change the user's server/config.
  const session = "guide-test", config = join(root, "tmux.conf"), bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(config, "set -g base-index 1\nsetw -g pane-base-index 1\nset -g default-shell /bin/sh\nset -g default-command /bin/sh\n");
  await writeFile(join(bin, "tmux"), `#!/bin/sh\nexec ${quote(tmux)} -f ${quote(config)} "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root };
  delete env.TMUX; delete env.TMUX_PANE;
  t.after(async () => {
    // Cleanup even when the old guide fails before returning a pane ID.
    for (const directory of await readdir(root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      try { execFileSync(tmux, ["-S", join(root, directory.name, "tmux.sock"), "kill-session", "-t", session], { timeout: 2000, stdio: "ignore" }); }
      catch { /* No owned session at this test-only socket. */ }
    }
    await rm(root, { recursive: true, force: true });
  });
  const guide = await readFile(guideUrl("tmux"), "utf8");
  const blocks = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.ok(!guide.includes(":0.0"));
  const script = blocks[0]
    .replaceAll("{{SESSION}}", quote(session)).replaceAll("{{CWD}}", quote(root))
    .replace("'your command'", "'printf \"TMUX_GUIDE_OK\\n\"'");
  const started = spawnSync("/bin/sh", ["-c", script], { cwd: root, env, encoding: "utf8", timeout: 10000 });
  assert.equal(started.status, 0, started.stderr || String(started.error));
  const socket = /^SOCKET=(.+)$/m.exec(started.stdout)?.[1];
  const pane = /^PANE=(%\d+)$/m.exec(started.stdout)?.[1];
  assert.ok(socket?.startsWith(root)); assert.ok(pane, "guide must return the native pane identity");
  const identity = execFileSync(tmux, ["-S", socket!, "display-message", "-p", "-t", pane!, "#{window_index}.#{pane_index}"], { encoding: "utf8", timeout: 2000 }).trim();
  assert.equal(identity, "1.1");
  let output = "";
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    output = execFileSync("/bin/sh", ["-c", blocks[1].split("\n")[0]], { cwd: root, env: { ...env, SOCKET: socket!, PANE: pane! }, encoding: "utf8", timeout: 2000 });
    if (/^TMUX_GUIDE_OK\r?$/m.test(output)) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.match(output, /^TMUX_GUIDE_OK\r?$/m);
  const stopped = spawnSync("/bin/sh", ["-c", blocks[3]], { cwd: root, env: { ...env, SOCKET: socket!, SESSION: session }, encoding: "utf8", timeout: 3000 });
  assert.equal(stopped.status, 0, stopped.stderr);
});

test("Herdr guides are tab-first, with explicit workspace targeting and splits only by request", async () => {
  for (const name of ["herdr", "herdr-private"]) {
    const guide = await readFile(guideUrl(name), "utf8");
    assert.match(guide, /Prefer (?:a )?new tabs?/);
    assert.match(guide, /Use splits only when the user explicitly requests/);
    assert.match(guide, /tab create --workspace <(?:caller|owned)-workspace-id>[^\n]*--no-focus/);
    assert.match(guide, /tab close <owned-tab-id>/);
    assert.match(guide, /\.result\.root_pane\.pane_id/);
    assert.ok(!guide.includes("herdr pane split"));
    const prose = guide.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    assert.ok((prose.match(/\btabs?\b/gi) ?? []).length > (prose.match(/\bpanes?\b/gi) ?? []).length,
      "user-facing prose should emphasize tabs rather than panes");
  }
});

test("private Herdr guide explicitly bounds readiness time and teaches uncertain-start recovery", async () => {
  const guide = await readFile(guideUrl("herdr-private"), "utf8");
  assert.match(guide, /bash[^\n]*`timeout: 15`/);
  assert.match(guide, /If (?:startup or readiness|it) times out/);
  assert.match(guide, /inspect[^\n]*logs[^\n]*session/i);
  assert.match(guide, /do not[^\n]*(?:blindly|another server|retry)/i);
});
