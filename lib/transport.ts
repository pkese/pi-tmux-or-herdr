import net from "node:net";
import { randomUUID } from "node:crypto";

export type Rpc = (method: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;

export function socketRpc(endpoint: string, timeoutMs = 2000): Rpc {
  const address = process.platform === "win32" && !endpoint.startsWith("\\\\.\\pipe\\")
    ? `\\\\.\\pipe\\${endpoint.replace(/[\\/]/g, "-")}` : endpoint;
  return (method, params, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled"));
    const id = randomUUID();
    const socket = net.createConnection(address);
    socket.setEncoding("utf8"); // Preserve multibyte characters across socket chunks.
    let buffer = "", done = false;
    const finish = (error?: Error, result?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new Error("Cancelled"));
    const timer = setTimeout(() => finish(new Error(`Herdr ${method} timed out; mutation outcome may be unknown. Do not blindly retry creates.`)), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    socket.on("error", error => finish(error));
    socket.on("end", () => finish(new Error(`Herdr closed connection during ${method}`)));
    socket.on("connect", () => socket.write(JSON.stringify({ id, method, params }) + "\n"));
    socket.on("data", chunk => {
      buffer += chunk.toString();
      if (buffer.length > 2 * 1024 * 1024) return finish(new Error("Herdr response too large"));
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let response: any;
        try { response = JSON.parse(line); } catch { continue; }
        if (!response || typeof response !== "object" || Array.isArray(response) || response.id !== id) continue;
        if (response.error) finish(new Error(`Herdr ${method}: ${JSON.stringify(response.error)}`));
        else if ("result" in response) finish(undefined, response.result);
        else finish(new Error(`Invalid Herdr response for ${method}`));
      }
    });
  });
}

export const quote = (text: string) => "'" + text.replace(/'/g, "'\\''") + "'";
export const normalizeName = (name?: string) => (name ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
export function childSession(env: NodeJS.ProcessEnv): boolean {
  return ["PI_SUBAGENT_CHILD", "PI_SUBAGENTS_HERDR_BRIDGE", "PI_HERDR_AGENTS_SESSION", "PI_LOCAL_HERDR_CHILD"].some(key => !!env[key] && env[key] !== "0");
}
