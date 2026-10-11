# Native isolated tmux terminals

Herdr was not found on PATH. tmux is available; use native commands through bash. There is no process wrapper or job registry.

Use a private socket and a unique session for this task, not the user's tmux server:
```sh
STATE=$(mktemp -d)
SOCKET="$STATE/tmux.sock"
SESSION={{SESSION}}
PANE=$(tmux -S "$SOCKET" new-session -d -P -F '#{pane_id}' -s "$SESSION" -c {{CWD}}) || exit 1
printf 'SESSION=%s\nSOCKET=%s\nPANE=%s\n' "$SESSION" "$SOCKET" "$PANE"
tmux -S "$SOCKET" send-keys -t "$PANE" -l -- 'your command'
tmux -S "$SOCKET" send-keys -t "$PANE" Enter
```

Inspect and interact:
```sh
tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S -200
tmux -S "$SOCKET" send-keys -t "$PANE" -l -- 'literal input'
tmux -S "$SOCKET" send-keys -t "$PANE" Enter
tmux -S "$SOCKET" send-keys -t "$PANE" C-c
```

Give the user the actual socket/session values and monitor command:
```sh
tmux -S "$SOCKET" attach -t "$SESSION"
```

When finished, kill only the owned session:
```sh
tmux -S "$SOCKET" kill-session -t "$SESSION"
```

Record the printed socket, session, and pane ID for recovery. Target the returned pane ID; user configuration may change window/pane indexes. Shell variables do not persist between bash tool calls: reassign their recorded values in each later call. Use output/readiness evidence rather than blind sleeps, and an exit marker/status file to establish completion. Snapshots are bounded; redirect durable logs to a file. Inspect foreground programs before input. Do not blindly retry uncertain creation.

Do not control unrelated sessions or use kill-server against a user server. Pi exit/reload does not clean up these processes. Report intentionally retained work and its attach command. Ordinary processes do not authorize coding-agent spawning or replace delegation policy.
