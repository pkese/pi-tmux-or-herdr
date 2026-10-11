import { childSession, normalizeName, type Rpc } from "./transport.ts";

type Request = { name?: string; session: string; generation: number; force: boolean; shared: boolean };
/** No polling, command interception, OSC title writes, or lifecycle reporting. */
export class NameSync {
  enabled: boolean;
  status = "Not synchronized";
  private generation = 0;
  private currentSession = "";
  private pending?: Request;
  private running?: Promise<void>;
  private labels = new Map<string, { last: string; manual: boolean }>();

  constructor(private rpc: Rpc, private env: NodeJS.ProcessEnv) {
    this.enabled = env.PI_LOCAL_HERDR_NAME_SYNC !== "0";
  }

  reset(session = "") {
    this.generation++;
    this.currentSession = session;
    this.pending = undefined;
  }

  async enqueue(name: string | undefined, session: string, mode: string, force = false, shared = false) {
    if (!this.enabled || mode !== "tui" || childSession(this.env) || !session || session !== this.currentSession) return;
    if (this.env.HERDR_ENV !== "1" || !this.env.HERDR_PANE_ID || !this.env.HERDR_SOCKET_PATH) return;
    this.pending = { name, session, generation: this.generation, force, shared };
    if (!this.running) {
      this.running = this.drain();
    }
    await this.running;
  }

  private async drain() {
    try {
      while (this.pending) {
        const request = this.pending; this.pending = undefined;
        try { await this.sync(request); }
        catch (error) { this.status = `Name sync unavailable: ${String(error)}`; }
      }
    } finally {
      // Release ownership in the same continuation as the empty-queue check.
      // A later Promise.finally callback would leave an enqueue-without-worker window.
      this.running = undefined;
    }
  }

  private valid(request: Request) {
    return this.enabled && request.generation === this.generation && request.session === this.currentSession
      && (!this.pending || this.pending.name === request.name);
  }

  private async sync(request: Request) {
    const label = normalizeName(request.name);
    if (!label) { this.status = "Unnamed session: existing label preserved"; return; }
    const result = await this.rpc("pane.current", { caller_pane_id: this.env.HERDR_PANE_ID });
    const pane = result.pane;
    // Positive ownership: inherited HERDR_* alone is not authority to rename.
    if (!pane?.tab_id || pane.agent_session?.kind !== "path" || pane.agent_session.value !== request.session) {
      this.status = "Skipped: current pane does not report this Pi session"; return;
    }
    const { tab } = await this.rpc("tab.get", { tab_id: pane.tab_id });
    if (!tab || typeof tab.label !== "string") throw new Error("Invalid tab response");
    if (tab.pane_count !== 1 && !request.shared) {
      this.status = "Shared tab preserved; /terminal-name sync-shared explicitly claims its label"; return;
    }
    const key = `${this.env.HERDR_SOCKET_PATH}:${pane.terminal_id}:${pane.tab_id}`;
    const previous = this.labels.get(key);
    if (!request.force && previous && (previous.manual || tab.label !== previous.last)) {
      previous.manual = true;
      this.status = "Manual label preserved; /terminal-name sync explicitly resumes synchronization"; return;
    }
    if (!this.valid(request)) return;
    // Recheck location immediately before mutation. Herdr offers no atomic move/rename CAS.
    const current = (await this.rpc("pane.current", { caller_pane_id: this.env.HERDR_PANE_ID })).pane;
    if (!this.valid(request) || current?.tab_id !== pane.tab_id || current?.terminal_id !== pane.terminal_id
      || current?.agent_session?.kind !== "path" || current.agent_session.value !== request.session) return;
    const latestTab = (await this.rpc("tab.get", { tab_id: pane.tab_id })).tab;
    if (!this.valid(request) || !latestTab || typeof latestTab.label !== "string") return;
    if (latestTab.pane_count !== 1 && !request.shared) return;
    if (!request.force && (latestTab.label !== tab.label || (previous && latestTab.label !== previous.last))) {
      if (previous) previous.manual = true;
      this.status = "Manual label change preserved"; return;
    }
    if (latestTab.label !== label) await this.rpc("tab.rename", { tab_id: pane.tab_id, label });
    if (request.generation === this.generation) this.labels.set(key, { last: label, manual: false });
    this.status = `Tab ${pane.tab_id}: ${label}`;
  }
}
