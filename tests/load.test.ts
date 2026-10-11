import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, mkdir, rename, rm, writeFile, access, cp, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findExecutable } from "../lib/path.ts";

// Prefer an available Node package; otherwise locate the installed Node Pi CLI.
// No machine-specific /usr/lib installation path is required.
let piEntry: string;
try { piEntry = createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent"); }
catch {
  const cli = await findExecutable("pi");
  assert.ok(cli, "Loader tests require a Node installation of Pi, with pi on PATH");
  piEntry = await realpath(cli);
}
// Pi's Node CLI/SDK may be in dist/ or dist/bundle/.
let loaderPath: string | undefined;
for (const relative of ["core/extensions/loader.js", "../core/extensions/loader.js"]) {
  const candidate = join(dirname(piEntry), relative);
  try { await access(candidate); loaderPath = candidate; break; } catch {}
}
assert.ok(loaderPath, "Loader tests require Pi's Node distribution, including dist/core");
const { loadExtensions, discoverAndLoadExtensions } = await import(pathToFileURL(loaderPath).href);
const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const packageRoot = dirname(extensionPath);

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), "local-guide-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keys = ["PATH", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_SOCKET_PATH", "PI_SUBAGENT_CHILD", "PI_LOCAL_HERDR_CHILD", "PI_HERDR_AGENTS_SESSION", "PI_SUBAGENTS_HERDR_BRIDGE", "PI_LOCAL_HERDR_NAME_SYNC"];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } });
  for (const key of keys) delete process.env[key];
  process.env.PATH = root;
  // Executables are only stat/access checked. Running one would leave a sentinel.
  for (const binary of ["herdr", "tmux"]) {
    await writeFile(join(root, binary), `#!/bin/sh\necho executed > '${root}/executed'\n`, { mode: 0o755 });
  }
  const ctx: any = { mode: "tui", cwd: root, sessionManager: { getSessionFile: () => "/test-session" }, ui: { notify() {} } };
  return { root, ctx };
}

async function load(root: string) {
  const loaded = await loadExtensions([extensionPath], root);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  loaded.runtime.getSessionName = () => undefined;
  loaded.runtime.getActiveTools = () => ["bash", "read", "terminal_enable"];
  return { loaded, extension, tool: extension.tools.get("terminal_enable").definition };
}

async function emit(extension: any, event: any, ctx: any) {
  for (const handler of extension.handlers.get(event.type) ?? []) await handler(event, ctx);
}

test("a directory installation discovers just index.ts, not the bundled reporter separately", async t => {
  const f = await fixture(t);
  const installed = join(f.root, "extensions", "pi-tmux-or-herdr");
  await cp(packageRoot, installed, {
    recursive: true,
    filter: source => ![".git", "node_modules", "NOTES.md"].includes(basename(source)),
  });
  const loaded = await discoverAndLoadExtensions([], f.root, f.root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.equal(loaded.extensions[0].resolvedPath, join(installed, "index.ts"));
  assert.deepEqual([...loaded.extensions[0].tools.keys()], ["terminal_enable"]);
  assert.equal(loaded.extensions[0].handlers.get("session_start")?.length, 1,
    "outside Herdr, the bundled reporter is inactive");
  await assert.rejects(access(join(f.root, "executed")), /ENOENT/);
});

test("loader prefers Herdr PATH availability without a server, then tmux, then clear failure", async t => {
  const f = await fixture(t); const { loaded, extension, tool } = await load(f.root);
  await emit(extension, { type: "session_start" }, f.ctx);
  assert.deepEqual([...extension.tools.keys()], ["terminal_enable"]);
  let result = await tool.execute("test", {}, undefined, undefined, f.ctx);
  assert.equal(result.details.backend, "herdr"); assert.equal(result.details.mode, "private");
  assert.match(result.content[0].text, /nohup herdr/);
  assert.ok(!result.content[0].text.includes("$HERDR"));
  assert.match(result.content[0].text, /--session/);
  assert.ok(!result.content[0].text.includes("terminal_process"));
  assert.ok(!result.content[0].text.includes("{{"));
  const options: any = { sections: {}, skills: [{ filePath: "/keep" }] };
  await emit(extension, { type: "before_agent_start", systemPromptOptions: options }, f.ctx);
  assert.equal(options.sections.local_terminal, "For long-running or interactive work in a separate terminal, call terminal_enable.");
  assert.ok(!JSON.stringify(options.sections).includes("nohup"), "deep instructions stay out of permanent prompt");
  assert.equal(options.skills.length, 1);
  assert.deepEqual(loaded.runtime.getActiveTools(), ["bash", "read", "terminal_enable"]);
  await rm(join(f.root, "herdr"));
  result = await tool.execute("test", {}, undefined, undefined, f.ctx);
  assert.equal(result.details.backend, "tmux");
  assert.match(result.content[0].text, /tmux -S/);
  assert.ok(!result.content[0].text.includes("$TMUX"));
  assert.ok(!result.content[0].text.includes("attic"));
  await rm(join(f.root, "tmux"));
  await assert.rejects(tool.execute("test", {}, undefined, undefined, f.ctx), /Neither herdr nor tmux/);
  await assert.rejects(access(join(f.root, "executed")), /ENOENT/);
});

for (const PATH of ["tools", ""]) {
  test(`loader resolves both backends from context cwd with PATH=${JSON.stringify(PATH)}`, async t => {
    const f = await fixture(t);
    const directory = PATH ? join(f.root, PATH) : f.root;
    if (PATH) {
      await mkdir(directory);
      for (const binary of ["herdr", "tmux"]) await rename(join(f.root, binary), join(directory, binary));
    }
    process.env.PATH = PATH;
    const { tool } = await load(f.root);
    let result = await tool.execute("test", {}, undefined, undefined, f.ctx);
    assert.equal(result.details.backend, "herdr");
    assert.equal(result.details.executable, join(directory, "herdr"));
    await rm(join(directory, "herdr"));
    result = await tool.execute("test", {}, undefined, undefined, f.ctx);
    assert.equal(result.details.backend, "tmux");
    assert.equal(result.details.executable, join(directory, "tmux"));
    await assert.rejects(access(join(f.root, "executed")), /ENOENT/);
  });
}

test("hosted guide is native and name events use authoritative metadata, not stale payload", async t => {
  const f = await fixture(t); const endpoint = join(f.root, "mock.sock");
  const methods: string[] = []; let label = "Original", reportedSession: string | undefined;
  const server = net.createServer(socket => {
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      const request = JSON.parse(buffer.trim()); methods.push(request.method);
      let result: any = {};
      if (request.method === "pane.report_agent_session") reportedSession = request.params.agent_session_path;
      if (request.method === "pane.current") result = { pane: { tab_id: "w1:t1", terminal_id: "term1", agent_session: reportedSession ? { kind: "path", value: reportedSession } : null } };
      if (request.method === "tab.get") result = { tab: { label, pane_count: 1 } };
      if (request.method === "tab.rename") label = request.params.label;
      socket.end(JSON.stringify({ id: request.id, result }) + "\n");
    });
  });
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  Object.assign(process.env, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: endpoint });
  const { loaded, extension, tool } = await load(f.root);
  let name = "Named"; loaded.runtime.getSessionName = () => name;
  await emit(extension, { type: "session_start" }, f.ctx); assert.equal(label, "Named");
  assert.equal(reportedSession, "/test-session", "bundled reporter establishes identity before name sync");
  assert.equal(methods.filter(method => method === "pane.report_agent_session").length, 1,
    "one session identity report, not two independently loaded reporters");
  assert.ok(methods.includes("pane.report_agent"), "agent state reporting remains active");
  assert.equal(extension.handlers.get("session_start")?.length, 2);
  assert.equal(extension.handlers.get("agent_start")?.length, 1);
  const before = methods.length;
  const guide = await tool.execute("test", {}, undefined, undefined, f.ctx);
  assert.equal(guide.details.mode, "hosted"); assert.match(guide.content[0].text, /herdr tab create --workspace <caller-workspace-id>/);
  assert.match(guide.content[0].text, /herdr tab close <owned-tab-id>/);
  assert.ok(!guide.content[0].text.includes("herdr pane split"));
  assert.ok(!guide.content[0].text.includes("$HERDR"));
  assert.equal(methods.length, before, "guide loading must not contact the server");
  name = "Latest"; await emit(extension, { type: "session_info_changed", name: "Stale" }, f.ctx);
  assert.equal(label, "Latest");
  await emit(extension, { type: "session_info_changed", name: "No headless write" }, { ...f.ctx, mode: "rpc" });
  assert.equal(label, "Latest");
  const headless = await tool.execute("test", {}, undefined, undefined, { ...f.ctx, mode: "rpc" });
  assert.equal(headless.details.mode, "private", "inherited markers do not grant caller-pane authority");
  assert.ok(!methods.includes("pane.split")); assert.ok(!methods.includes("pane.close"));
  assert.ok(!methods.includes("tab.create")); assert.ok(!methods.includes("tab.close"));
  await assert.rejects(access(join(f.root, "executed")), /ENOENT/);
});
