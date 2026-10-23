# crewboard

A Claude Code mod: a progress band above the prompt and a **Workers** pane that lists everything working for the session: subagents, local `claude -p` runs, cloud workers and long CLI tasks.

## What it shows

- **Progress band**: the plan's title, phase, accepted tasks out of planned, and a button with the crew size that opens the pane. It appears once the orchestrator reports progress, or a worker subagent starts (an agent type ending in a tier: `-haiku`, `-sonnet`, `-opus`, `-opus-xhigh` or `-fable`).
- **Workers pane** (`/workers` toggles it; `/workers open` opens it or brings it forward without toggling): running, finished and planned rows with model, effort, task progress, context, estimated cost and time. Running rows say what they are doing now ("Tests: dues.itest.ts", "Editing a.ts").
  - **Subagents** from this chat, including `team-sonnet`, `team-opus` and `team-opus-xhigh`.
  - **Local workers**: `claude -p` processes started outside the chat, read from a status file.
  - **Cloud workers**: a cloud session that pushes the branch `cloud/<ID>`; the row is done once that branch exists on `origin`. A `RemoteTrigger` run from this chat adds its own row: the id is the `cloud/<ID>` its prompt says to push, with the run's session, model and trigger name.
  - **Tasks**: long CLI runs (a test suite, a build) with a progress bar counted from their log.
- Only the 15 newest finished rows are drawn; a **Show All (n)** / **Show Fewer** button lists the rest, so the pane stays light with many workers.
- Each crab wears its model: Haiku (racer), Sonnet (chef), Opus (engineer), Opus xhigh (detective), Fable (astronaut). A session worker wears its role instead (frontend, backend, design, qa). Animations stop under `prefers-reduced-motion`.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`, list prices as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate.

## The status file: workers.json

The orchestrator keeps one JSON file; the mod re-reads it every 30 seconds and on `/workers`. A missing or broken file lists nobody. Ids are letters, digits, `.`, `_` and `-` (up to 64). `startedAt` is an ISO time or epoch milliseconds; without it a row starts when the mod first sees it.

```json
{
  "local": [
    {
      "id": "FIX-HOOK",
      "label": "Setup race",
      "model": "opus",
      "effort": "high",
      "role": "backend",
      "worktree": "C:/work/repo/.claude/worktrees/fix-hook",
      "startedAt": "2026-10-19T12:00:00Z"
    }
  ],
  "cloud": [
    {
      "id": "UC2-20",
      "label": "Calendar settings",
      "model": "sonnet",
      "role": "frontend",
      "session": "cse_01AbCdEf"
    }
  ],
  "tasks": [
    {
      "id": "INT",
      "label": "Integration tests",
      "role": "qa",
      "log": "C:/work/logs/int.log",
      "count": "^\\[shard \\d+/\\d+\\] (✔|✖) ",
      "failed": "^\\[shard \\d+/\\d+\\] ✖ ",
      "expected": 120,
      "output": "C:/work/logs/int.out",
      "done": "^integration: exit"
    }
  ]
}
```

- **local**: a `claude -p` run. Start it with its output redirected to `<ID>.result.json` (`--output-format json`) in the **same folder as workers.json**; the file exists from launch and has content once the run ends, which is when the row turns done (or failed, if the result is an error). An optional `<ID>.prompt.txt` in that folder dates the start. While it runs, the row reads the run's newest transcript under `<.claude folder>/projects/` for live context, tokens, cost and the current step. `worktree` is the run's working folder; without it the mod looks at `<repo>/.claude/worktrees/<id in lower case>`. Finished runs take their figures from the result file and read no transcript.
- **cloud**: a cloud worker. `model`, `effort`, `label`, `role` and `startedAt` are optional. `session` (a `cse_...` id) is kept on the row data; the pane draws no link from it. Done when `origin` has `cloud/<ID>`. A `RemoteTrigger` `run` writes this entry itself when the trigger's prompt names the branch it pushes (the first `cloud/<ID>` after "push" on a line, else the last `cloud/<ID>` that is not a `cloud/<ID>:path`); an id already listed is left as it is.
- **tasks**: `log` is the file the run writes, `count` a regular expression matched against each line of it (one match is one finished step), `expected` the total for a progress bar (omit it to show a bare count), `failed` an optional regular expression for failed steps, and `output` with `done` the file and expression that say the run ended. Write non-ASCII marks as `\uXXXX` escapes if the file's encoding is uncertain.
- `role` is `frontend`, `backend`, `design` or `qa`; without it the row's role is guessed from its label.

To add or update rows from any session, put the entries in a JSON array and run `node scripts/add-workers.cjs <entries.json> [cloud|local|tasks]` (default `cloud`). It writes the default status file, or the one `CREWBOARD_FILE` names, and stamps `startedAt` on new entries.

## Options

Set them in `/config`, or in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "crewboard": { "options": { "workersFile": "~/.claude/crewboard/workers.json", "repo": "C:/work/repo" } } } }
```

| Option | Default | Meaning |
| --- | --- | --- |
| `language` | `auto` | `en`, `ru` or `he` (Hebrew is drawn right to left). `auto` follows Claude Code's `language` setting, then the system locale. |
| `autoOpen` | `plan` | `plan`: the pane opens by itself, once per session, when a plan is reported or a worker in the status file starts (workers already running when the session starts do not count). `any`: also when any subagent starts. |
| `workersFile` | empty | Path of workers.json. Empty means `crewboard/workers.json` under your `.claude` folder (`CLAUDE_CONFIG_DIR`, else your home folder). A leading `~` is your home folder. Result files are read from the same folder. |
| `repo` | empty | The git repository whose `origin` is checked for `cloud/<ID>` branches, and the base of the default worktree folders. Empty means the session's working directory. |

The transcripts folder is `projects/` under that same `.claude` folder.

Cloud checks are cheap on purpose: one `git ls-remote origin` for the branches of cloud ids not yet seen pushed, at most every two minutes, and none when every listed id is already pushed.

## Tools it adds

- `mcp__crewboard__progress`: the orchestrator reports the plan, phase and accepted tasks (`tier` is `fable`, `opus-xhigh`, `opus`, `sonnet` or `haiku`). Only the main session can: a call from a subagent is ignored.
- `mcp__crewboard__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey. Worker subagents get one line at the end of their brief asking for these reports.

## Install

```
/plugin install crewboard --marketplace oreoseenoevil/crewboard
```

Answer `y` to add the marketplace, then choose a scope. Do not keep the upstream mod (the one this is forked from, see Origin) installed beside it: this one replaces it, and it has its own names (pane `crewboard`, command `/workers`), so the two do not collide.

For development, run `claude --plugin-dir <this folder>`; check it with `claude plugin validate <folder>` and `claude plugin test <folder>`.

## Origin

crewboard is a fork of the progress-bar and agents-pane mod in [johnnyvizz/claude-kit](https://github.com/johnnyvizz/claude-kit) (its `plugins/` folder, version 1.2.1), which is MIT-licensed. This fork is maintained separately; the license, with the original copyright line, is in `LICENSE`.
