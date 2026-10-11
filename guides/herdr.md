# Native Herdr tabs — hosted context

Herdr is available on PATH. Use its native CLI through bash; there is no process wrapper or job registry. Prefer a new tab for separate terminal work, not a split in the current tab. Use splits only when the user explicitly requests that layout.

## Create a task tab without changing focus

Resolve the caller's workspace, not the UI-focused tab:
```sh
herdr pane current --current
```

Use `.result.pane.workspace_id` from that response as the explicit workspace for the new tab:
```sh
herdr tab create --workspace <caller-workspace-id> --cwd {{CWD}} --label terminal --no-focus
```

Record the new tab ID (`.result.tab.tab_id`), its root terminal's pane ID (`.result.root_pane.pane_id`), and terminal identity. Give the tab a descriptive task label. Do not invent IDs or target another tab based on UI focus.

## Run and inspect the tab's terminal

The native CLI addresses terminal operations as `pane` commands; use the root ID returned by tab creation:
```sh
herdr pane run <pane-id> "your command"
herdr pane wait-output <pane-id> --match "ready text" --timeout 15000
herdr pane read <pane-id> --source recent-unwrapped --lines 200
herdr pane send-text <pane-id> "literal input"
herdr pane send-keys <pane-id> enter
herdr pane send-keys <pane-id> ctrl+c
```

`pane run` submits command text and Enter together. Inspect the foreground program before sending input. A quiet terminal is not proof of completion: arrange an exit marker or status file when needed. Redirect durable logs to a file.

When finished, close only the task tab after confirming it contains no work that must remain:
```sh
herdr tab close <owned-tab-id>
```

- Preserve user focus, cwd, and existing tabs. Control/close only tabs and terminals you created or were explicitly authorized to use. After moves, resolve live identities before targeting or closing anything.
- Record the workspace, tab label/ID, terminal IDs, and monitor instructions in task notes or a scratch file. Tell the user how to find the tab and what remains running; this extension does not track or clean up processes.
- Do not stop/delete the shared/default Herdr server. If the server is unreachable, report it; do not silently retarget another server.
- Do not blindly repeat timed-out mutations; inspect whether they succeeded first.
- Ordinary processes are not permission to spawn coding agents; respect the requested delegation workflow.
- Discover advanced syntax with the relevant CLI --help. If more native hosted guidance is needed, run herdr --skill on demand; do not preload it for routine short bash work.

These commands use inherited caller context. Do not copy that context to another process or fabricate HERDR_ENV.
