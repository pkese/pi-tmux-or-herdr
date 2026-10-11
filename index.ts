import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { socketRpc, childSession, quote } from "./lib/transport.ts";
import { findExecutable } from "./lib/path.ts";
import { NameSync } from "./lib/names.ts";
import reportHerdrAgentState from "./herdr-agent-state.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Herdr state reporting, lazy terminal guidance, and hosted-Pi name synchronization. */
export default function piTmuxOrHerdr(pi: ExtensionAPI) {
  // Register session identity reporting before name sync checks that identity.
  reportHerdrAgentState(pi);
  const env = process.env;
  const names = new NameSync(socketRpc(env.HERDR_SOCKET_PATH ?? ""), env);
  let session = "";
  let revealed: string | undefined;
  let privateName: string | undefined;
  const sessionFile = (ctx: ExtensionContext) => ctx.sessionManager.getSessionFile() ?? "";
  const hosted = (ctx: ExtensionContext) => ctx.mode === "tui" && !childSession(env)
    && env.HERDR_ENV === "1" && !!env.HERDR_PANE_ID && !!env.HERDR_SOCKET_PATH;

  async function reveal(ctx: ExtensionContext) {
    // Select by PATH, not inherited Herdr variables or live server availability.
    const herdr = await findExecutable("herdr", env, ctx.cwd);
    const executable = herdr ?? await findExecutable("tmux", env, ctx.cwd);
    if (!executable) throw new Error("Neither herdr nor tmux was found on PATH. No terminal instructions loaded.");
    const backend = herdr ? "herdr" : "tmux";
    const mode = herdr && hosted(ctx) ? "hosted" : "private";
    const file = herdr ? (mode === "hosted" ? "herdr.md" : "herdr-private.md") : "tmux.md";
    const template = await readFile(join(here, "guides", file), "utf8");
    const name = privateName ??= `pi-terminal-${randomUUID().slice(0, 12)}`;
    const substitutions: Record<string, string> = {
      CWD: quote(ctx.cwd), SESSION: quote(name),
    };
    const guidance = template.replace(/\{\{(CWD|SESSION)\}\}/g, (_match, key) => substitutions[key]);
    revealed = `${backend} (${mode})`;
    return { backend, mode, executable, guidance };
  }

  pi.registerTool({
    name: "terminal_enable", label: "Reveal terminal instructions", exposure: "model-only",
    description: "Reveal native instructions for a separate terminal. Does not start processes.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const data = await reveal(ctx);
      return { content: [{ type: "text", text: data.guidance }], details: data };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    session = sessionFile(ctx); revealed = undefined; privateName = undefined;
    names.reset(session);
    if (hosted(ctx)) await names.enqueue(pi.getSessionName(), session, ctx.mode);
  });
  pi.on("session_info_changed", async (_event, ctx) => {
    // Events can arrive out of order after earlier asynchronous extension handlers.
    await names.enqueue(pi.getSessionName(), sessionFile(ctx), ctx.mode);
  });
  pi.on("session_shutdown", () => {
    names.reset(); session = ""; revealed = undefined; privateName = undefined;
    // Guidance-only integration: no terminal lifecycle or process cleanup here.
  });
  pi.on("before_agent_start", event => {
    if (pi.getActiveTools().includes("terminal_enable")) {
      event.systemPromptOptions.sections.local_terminal = "For long-running or interactive work in a separate terminal, call terminal_enable.";
    }
  });

  pi.registerCommand("terminal", {
    description: "Reveal native Herdr/tmux instructions: /terminal [status]",
    handler: async (args, ctx) => {
      if (args.trim() === "status") {
        ctx.ui.notify(`Guidance: ${revealed ?? "not loaded"}. ${names.status}`, "info"); return;
      }
      if (args.trim()) { ctx.ui.notify("Usage: /terminal [status] (selects Herdr on PATH, otherwise tmux)", "warning"); return; }
      try {
        const data = await reveal(ctx);
        pi.sendMessage({ customType: "local-terminal", content: data.guidance, display: true }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(String(error), "warning"); }
    },
  });
  pi.registerCommand("terminal-name", {
    description: "Hosted Herdr tab name sync: /terminal-name [status|on|off|sync|sync-shared]",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "status") { ctx.ui.notify(`${names.enabled ? "Enabled" : "Disabled"}: ${names.status}`, "info"); return; }
      if (action === "off") { names.enabled = false; names.reset(session); ctx.ui.notify("Herdr name sync disabled for this runtime", "info"); return; }
      if (!["on", "sync", "sync-shared"].includes(action)) { ctx.ui.notify("Usage: /terminal-name [status|on|off|sync|sync-shared]", "warning"); return; }
      if (!hosted(ctx) || !session || sessionFile(ctx) !== session) {
        ctx.ui.notify("Name sync requires the owning interactive Pi pane inside Herdr", "warning"); return;
      }
      names.enabled = true;
      await names.enqueue(pi.getSessionName(), session, ctx.mode, action !== "on", action === "sync-shared");
      ctx.ui.notify(names.status, "info");
    },
  });
}
