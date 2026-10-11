import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { findExecutable } from "../lib/path.ts";

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), "terminal-path-test-"));
  const context = join(root, "context"), processDirectory = join(root, "process");
  await mkdir(join(context, "tools"), { recursive: true });
  await mkdir(join(processDirectory, "tools"), { recursive: true });
  for (const directory of [context, processDirectory]) {
    for (const name of ["herdr", "tools/herdr"]) {
      await writeFile(join(directory, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
  }
  const original = process.cwd();
  process.chdir(processDirectory);
  t.after(async () => { process.chdir(original); await rm(root, { recursive: true, force: true }); });
  return { context };
}

test("relative PATH lookup uses context cwd, not competing process cwd", async t => {
  const { context } = await fixture(t);
  assert.equal(await findExecutable("herdr", { PATH: "tools" }, context), join(context, "tools/herdr"));
});

test("empty PATH entries use context cwd", async t => {
  const { context } = await fixture(t);
  for (const PATH of ["", delimiter + "tools", "missing" + delimiter]) {
    assert.equal(await findExecutable("herdr", { PATH }, context), join(context, "herdr"));
  }
});
