import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { socketRpc } from "../lib/transport.ts";

test("socket transport matches IDs, accepts fragmented frames and empty success", async t => {
  const root = await mkdtemp(join(tmpdir(), "local-rpc-test-"));
  const endpoint = join(root, "test.sock");
  const server = net.createServer(socket => {
    socket.once("data", chunk => {
      const request = JSON.parse(String(chunk));
      const response = JSON.stringify({ id: request.id, result: {} }) + "\n";
      socket.write('noise\n{"id":"other","result":{}}\n' + response.slice(0, 10));
      socket.end(response.slice(10));
    });
  });
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  assert.deepEqual(await socketRpc(endpoint)("tab.rename", { tab_id: "fake", label: "test" }), {});
});

test("UTF-8 chunk boundaries and valid JSON noise preserve response text", async t => {
  const root = await mkdtemp(join(tmpdir(), "local-unicode-test-"));
  const endpoint = join(root, "test.sock");
  const expected = "café 🙂";
  const server = net.createServer(socket => {
    socket.once("data", chunk => {
      const request = JSON.parse(String(chunk));
      const bytes = Buffer.from(JSON.stringify({ id: request.id, result: { text: expected } }) + "\n");
      const accent = bytes.indexOf(Buffer.from("é")) + 1;
      const emoji = bytes.indexOf(Buffer.from("🙂")) + 2;
      socket.write("null\n[]\n42\n");
      socket.write(bytes.subarray(0, accent));
      setImmediate(() => {
        socket.write(bytes.subarray(accent, emoji));
        setImmediate(() => socket.end(bytes.subarray(emoji)));
      });
    });
  });
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  assert.deepEqual(await socketRpc(endpoint)("tab.get", {}), { text: expected });
});

test("socket request cancellation before connect and unavailable endpoint fail boundedly", async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(socketRpc("/nonexistent-local-test")("ping", {}, abort.signal), /Cancelled/);
  await assert.rejects(socketRpc("/nonexistent-local-test", 50)("ping", {}), /ENOENT/);
});
