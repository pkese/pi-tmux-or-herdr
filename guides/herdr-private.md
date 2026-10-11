# Native Herdr tabs — private headless session

Herdr is available on PATH, but this Pi is not the owning interactive terminal in a Herdr session. Use a NEW private named server, never the default/focused server. Do not fake HERDR_ENV. Native commands go through bash; this extension starts and owns nothing.

## Start only when a separate task tab is actually needed

Prefer new tabs for separate terminal work. Use splits only when the user explicitly requests that layout.

The proposed name below is unique for this guide load. Check ownership before reuse; a name alone is not proof that an existing session is yours. Run startup and readiness with the bash tool's `timeout: 15` (seconds); retry counts alone do not bound elapsed time.

```sh
SESSION={{SESSION}}
herdr session list
STATE=$(mktemp -d)
nohup herdr --session "$SESSION" server >"$STATE/server.log" 2>&1 </dev/null &
SERVER_PID=$!
printf 'SESSION=%s\nSTATE=%s\nSERVER_PID=%s\n' "$SESSION" "$STATE" "$SERVER_PID"
```

If that name already exists and is not known to be yours, choose a new unique name instead. Preserve the printed session name, log path, and creation responses in task notes/a scratch record for recovery. Shell variables do not persist between bash tool calls: reassign their recorded values in each later call.

Readiness must be bounded and must contact the actual server:
```sh
READY=0
for attempt in $(seq 1 50); do
  if herdr --session "$SESSION" api snapshot >"$STATE/snapshot.json" 2>"$STATE/readiness.err"; then
    READY=1
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.1
done
test "$READY" = 1 || { echo "Herdr server not ready; inspect $STATE/server.log"; exit 1; }
herdr --session "$SESSION" workspace create --cwd {{CWD}} --label terminal --no-focus
```

If startup or readiness times out, do not blindly retry or start another server. Inspect the recorded logs and named session using bounded calls, then stop/delete only your confirmed-owned session or report it as retained.

Bare herdr opens/attaches a TUI; ordinary CLI commands do not start a missing server. The detached server is a persistent process; do not leave a failed startup unattended.

## Use the initial task tab

Workspace creation bootstraps the private server with its first tab. Record the workspace and tab IDs, tab label, terminal identity, and `.result.root_pane.pane_id` from creation. Native terminal operations use `pane` commands; target this tab's returned root ID. Use the SAME explicit --session prefix for every command:

```sh
herdr --session "$SESSION" pane run <pane-id> "your command"
herdr --session "$SESSION" pane wait-output <pane-id> --match "ready text" --timeout 15000
herdr --session "$SESSION" pane read <pane-id> --source recent-unwrapped --lines 200
herdr --session "$SESSION" pane send-text <pane-id> "literal input"
herdr --session "$SESSION" pane send-keys <pane-id> enter
herdr --session "$SESSION" pane send-keys <pane-id> ctrl+c
```

For another task tab, reuse the recorded owned workspace instead of creating a split or another workspace:
```sh
herdr --session "$SESSION" tab create --workspace <owned-workspace-id> --cwd {{CWD}} --label terminal --no-focus
```
Record each new tab's ID and returned root terminal ID. Give tabs descriptive task labels. Never use --current or omit session targeting in this external mode.

Tell the user the workspace and task tab labels/IDs, plus exactly how to attach and find the tab:
```sh
herdr session attach "$SESSION"
```

## Cleanup and safety

Inspect output/readiness; snapshots do not prove completion or provide durable logs. Use an exit marker/status file when needed, and redirect logs to a file. Do not retry a timed-out mutation blindly.

To retire just one task tab, close only its recorded owned tab after confirming no work must remain in it:
```sh
herdr --session "$SESSION" tab close <owned-tab-id>
```

Stop/delete the entire private session only after confirming no work must remain in any of its tabs:
```sh
herdr session stop "$SESSION"
herdr session delete "$SESSION"
```

Stopping kills its processes; delete requires it to be stopped. Do not run generic server stop or delete another session. Remove only your own scratch records when safe. If jobs must persist, report the session, workspace/tab labels and IDs, logs and attach command instead. No automatic cleanup occurs on Pi exit/reload.

The bundled herdr --skill is restricted to hosted callers; it is not the external-session contract. Follow this explicit private-session guide instead. Native terminal work does not authorize starting coding agents or bypassing delegation rules.
