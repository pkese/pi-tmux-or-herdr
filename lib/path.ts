import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, resolve } from "node:path";

/** Availability only: never execute a candidate or probe/start a server. */
export async function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<string | undefined> {
  const suffixes = process.platform === "win32"
    ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    for (const suffix of suffixes) {
      const candidate = resolve(cwd, directory || ".", name + suffix);
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch { /* Continue PATH lookup. */ }
    }
  }
  return undefined;
}
