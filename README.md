# pi-tmux-or-herdr

A Pi extension combining Herdr agent-state reporting, lazy native Herdr/tmux terminal guidance, and Pi session-name → Herdr tab-label synchronization.

## Install

Clone this repository into Pi's extensions directory:

```sh
git clone <repository-url> ~/.pi/agent/extensions/pi-tmux-or-herdr
```

Pi loads `index.ts` automatically. No build, npm install, or settings change is needed. Run `/reload` in an existing Pi session. To update an existing clone, use `git pull --ff-only` inside it, then reload.

Use only one copy: remove/disable the old `local-herdr/` extension and standalone `~/.pi/agent/extensions/herdr-agent-state.ts`. The reporter is bundled here and loaded through the single entry point. Herdr integration updates may recreate the standalone file; do not leave both reporters enabled.

`pi-title.ts` is independent and is not included.

## Terminal guidance

`terminal_enable` has no parameters. It checks PATH without executing programs:

1. Herdr found → hosted-caller or private-headless Herdr instructions.
2. Otherwise tmux found → isolated native-tmux instructions.
3. Neither found → clear availability error.

`/terminal` reveals the same guide; `/terminal status` reports the loaded guide. Only one short routing sentence enters initial context; backend guidance is loaded on request. No standalone terminal skill is needed.

Herdr guidance prefers new task tabs over splits. Native terminal operations still use pane IDs.

Loading guidance does not start/probe servers, create tabs, manage jobs, or clean up processes. Native commands run through `bash`. Record session/socket/tab/terminal identities, explain how to monitor, establish completion evidence, and clean up only owned resources. Herdr wins when on PATH even if its server is down; there is no silent liveness-based fallback.

## Herdr state and name synchronization

The bundled Herdr reporter publishes Pi session identity and working/blocked/idle state for interactive Pi sessions inside Herdr. It is inactive outside Herdr.

Named root interactive sessions synchronize to their current Herdr tab independently of terminal guidance. Matching reporter identity is required. Shared tabs are skipped by default; blank names preserve labels, and subsequent manual label changes are respected. Names are normalized and capped at 80 code units.

- `/terminal-name status|on|off`: inspect/toggle for this runtime.
- `/terminal-name sync`: resume after a manual override.
- `/terminal-name sync-shared`: explicitly allow a shared tab for one invocation.
- `PI_LOCAL_HERDR_NAME_SYNC=0`: default off at startup.

Manual-label tracking/off state resets on reload. First named startup can replace a dedicated tab's existing label. Herdr has no atomic rename/ownership guard, so concurrent external changes can still race.

## Tests

With Node 22.7+ and a Node installation of Pi available:

```sh
npm test
```

Tests exercise Pi's loader/discovery, bundled reporting, native guidance, naming ownership, and socket handling. One tmux regression creates and cleans up a temporary private server; other tests use fake executables/mock sockets. No live Herdr UI is mutated.

Private implementation/motivation notes remain in local `NOTES.md`, excluded from Git and never loaded into model guidance.
