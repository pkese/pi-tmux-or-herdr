import test from "node:test";
import assert from "node:assert/strict";
import { NameSync } from "../lib/names.ts";
import { normalizeName, type Rpc } from "../lib/transport.ts";

function fixture() {
  const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: "/fake" };
  let pane = { tab_id: "w1:t1", terminal_id: "term1", agent_session: { kind: "path", value: "/session" } };
  const tabs: Record<string, any> = { "w1:t1": { label: "Original", pane_count: 1 }, "w1:t2": { label: "Moved", pane_count: 1 } };
  const writes: any[] = [];
  const rpc: Rpc = async (method, params) => {
    if (method === "pane.current") return { pane: { ...pane } };
    if (method === "tab.get") return { tab: { ...tabs[String(params.tab_id)] } };
    if (method === "tab.rename") { writes.push(params); tabs[String(params.tab_id)].label = params.label; return {}; }
    throw new Error(method);
  };
  const names = new NameSync(rpc, env); names.reset("/session");
  return { env, names, tabs, writes, rpc, move: () => { pane.tab_id = "w1:t2"; }, mismatch: () => { pane.agent_session.value = "/other"; } };
}

test("name changes use current tab, preserve manual overrides, blank names don't restore stale baselines", async () => {
  const f = fixture();
  await f.names.enqueue("Alpha", "/session", "tui");
  f.move(); await f.names.enqueue("Beta", "/session", "tui");
  assert.deepEqual(f.writes.map(v => v.tab_id), ["w1:t1", "w1:t2"]);
  f.tabs["w1:t2"].label = "Manual";
  await f.names.enqueue("Gamma", "/session", "tui");
  assert.equal(f.writes.length, 2);
  await f.names.enqueue("Gamma", "/session", "tui", true);
  assert.equal(f.tabs["w1:t2"].label, "Gamma");
  await f.names.enqueue(undefined, "/session", "tui");
  assert.equal(f.tabs["w1:t2"].label, "Gamma");
});

test("TUI/child/identity/shared-tab guards; force is not shared-tab permission", async () => {
  const f = fixture();
  await f.names.enqueue("No", "/session", "rpc");
  f.env.PI_SUBAGENT_CHILD = "1";
  await f.names.enqueue("No", "/session", "tui"); delete f.env.PI_SUBAGENT_CHILD;
  f.tabs["w1:t1"].pane_count = 2;
  await f.names.enqueue("No", "/session", "tui", true);
  assert.equal(f.writes.length, 0);
  await f.names.enqueue("Shared", "/session", "tui", true, true);
  assert.equal(f.writes.length, 1);
  f.mismatch(); await f.names.enqueue("No", "/session", "tui", true, true);
  assert.equal(f.writes.length, 1);
});

test("stale session updates are discarded, queued changes coalesce", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const names = new NameSync(async (method, params) => {
    if (first) { first = false; await gate; }
    return f.rpc(method, params);
  }, f.env);
  names.reset("/session");
  const a = names.enqueue("A", "/session", "tui");
  const b = names.enqueue("B", "/session", "tui");
  const c = names.enqueue("C", "/session", "tui");
  release(); await Promise.all([a, b, c]);
  assert.deepEqual(f.writes.map(v => v.label), ["C"]);
  names.reset("/other");
  await names.enqueue("Stale", "/session", "tui");
  assert.equal(f.writes.length, 1);
});

test("reset/disable while a lookup is pending prevents writes; failures nonfatal", async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const names = new NameSync(async (m, p) => { await gate; return f.rpc(m, p); }, f.env);
  names.reset("/session"); const pending = names.enqueue("A", "/session", "tui");
  names.reset("/other"); release(); await pending; assert.equal(f.writes.length, 0);
  const failed = new NameSync(async () => { throw new Error("Unavailable"); }, f.env);
  failed.reset("/session"); await failed.enqueue("A", "/session", "tui");
  assert.match(failed.status, /unavailable/i);
});

test("microtask enqueue at drain completion is not stranded", async () => {
  const f = fixture();
  const first = f.names.enqueue(undefined, "/session", "tui");
  let second!: Promise<void>;
  queueMicrotask(() => { second = f.names.enqueue("Named", "/session", "tui"); });
  await first; await second;
  assert.deepEqual(f.writes.map(value => value.label), ["Named"]);
});

test("manual policy is rechecked after the final pane lookup", async () => {
  const f = fixture(); let lookups = 0;
  const names = new NameSync(async (method, params) => {
    if (method === "pane.current" && ++lookups === 2) f.tabs["w1:t1"].label = "Manual";
    return f.rpc(method, params);
  }, f.env);
  names.reset("/session");
  await names.enqueue("Automatic", "/session", "tui");
  assert.equal(f.writes.length, 0);
  assert.equal(f.tabs["w1:t1"].label, "Manual");
});

test("final ownership check rejects path-to-id reference changes with the same value", async () => {
  const f = fixture(); let lookups = 0;
  const names = new NameSync(async (method, params) => {
    const result = await f.rpc(method, params);
    if (method === "pane.current" && ++lookups === 2) {
      return { pane: { ...result.pane, agent_session: { kind: "id", value: "/session" } } };
    }
    return result;
  }, f.env);
  names.reset("/session");
  await names.enqueue("Must not rename", "/session", "tui");
  assert.equal(f.writes.length, 0);
});

test("normalization strips control characters and caps names", () => {
  assert.equal(normalizeName("  hello\n\x1b world  "), "hello world");
  assert.equal(normalizeName("x".repeat(100)).length, 80);
});
