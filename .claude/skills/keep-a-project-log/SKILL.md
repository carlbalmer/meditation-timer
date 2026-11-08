---
name: keep-a-project-log
description: Turn finished conversation from this project's Claude Code chats into project log entries in docs/project_log/. Pass "flush" to also log topics that are still open.
disable-model-invocation: true
---

# Keep a project log

The project log in `docs/project_log/` is the project's history: what was researched, measured,
discussed, decided and built, and why. You write it after the fact from the chat transcripts, with
hindsight, so each entry tells a finished story.

Arguments: $ARGUMENTS

Two scripts in `scripts/` give you the raw material; run them from the repository root:

- `python3 .claude/skills/keep-a-project-log/scripts/transcripts.py list | read CHAT [--from X] [--to X] | show CHAT ID`
  lists the chats with their stats, prints a chat (tool calls shortened, subagent answers whole)
  and shows the full input/output of one message. Subagent chats are `CHAT/AGENT`.
- `python3 .claude/skills/keep-a-project-log/scripts/state.py show | record ...` holds, per chat,
  how far the log is caught up and which entries came from which stretch of the chat.

## Steps

1. **Survey.** Run `transcripts.py list` and `state.py show`. Every chat with messages after its
   `caught_up_through` (or with no state yet) is in scope. Subagent chats are not chats of their
   own here: their answers appear in the parent chat.

2. **Read** each chat in scope from its `caught_up_through` onwards; a long chat reads best
   written to a file and paged, or in `--from`/`--to` slices. Use `show` when a shortened tool
   call matters, and read a subagent's own chat when its answer is not enough. Rereading stretches
   that are already logged is expected: the state's entry descriptions and ranges tell you which
   they are; open the entry itself when unsure. Done when you have read every message in scope.

   With a lot of unread conversation, consider subagents. Topics can span chats, so split the
   work by topic rather than by chat, and keep updating the state and committing to yourself.

3. **Find the topics**: lines of work with one outcome each (a research question, a measurement,
   a design question, a piece of implementation, a change to the setup). Housekeeping, including
   runs of this skill, belongs to no topic. Work that resumes after a topic reached its end state
   is a new topic.

4. **Decide which topics are closed.** A topic is closed when its last message is older than
   6 hours and it either reached an end state (a confirmed decision, a commit that completes the
   work, a delivered result the conversation built on) or the conversation moved on to other
   topics. A chat that has gone quiet for days can be logged as it stands. The rest stay open for
   a later run. With `flush`, every topic counts as closed.

5. **Write** an entry for each closed topic not yet in the log (see **Entry format**). The log
   grows by new entries; edit an existing entry in place only for small fixes or completions,
   such as a correction or an open point that got resolved, keeping its file name and date, and
   record it again so its range widens.

6. **Record the state** per chat, using the full chat id from `list` and the ids and times of the
   `## [id] time` message headers in `read`:
   `state.py record CHAT --caught-up-through ID "TIME" --entry FILE FROM_ID "FROM_TIME" TO_ID "TO_TIME" "DESCRIPTION" ...`.
   `caught_up_through` is the last message before the earliest topic that is still open (or the
   last message read when nothing is open), so the next run rereads every open topic in full.
   The description says in up to ~50 words what the entry covers, so a later run can recognise it.
   Ranges may overlap; an entry drawing on several chats is recorded under each of them.

7. **Commit and report.** Commit only the log (`git add docs/project_log && git commit -m
   "Project log: <summary>" -- docs/project_log`; nothing to commit when nothing changed) and tell
   the user which entries you wrote or edited and which topics you left open.

## Entry format

Write for a reader who never saw the chat: name the files, numbers, options and reasons, and say
who decided (user or agent). Record conclusions and the reasoning behind them rather than the
order of events. Refer to credentials by what they are ("the repo keystore password"); transcripts
contain values from terminal output and config dumps, and those stay out of the log.

**File name**: `YYYY-MM-DD-NN-type-title.md`, kebab-case. The date is the local date (server
timezone) the topic concluded; `NN` continues the sequence of that date (`ls docs/project_log`),
in the order the topics concluded, and in causal order when they concluded together.

**Header**:

```yaml
---
date: 2026-10-15
type: experiment
tags: [stt-models, performance]
related: [2026-10-14-01-research-some-topic]      # optional
supersedes: [2026-10-15-02-decision-earlier-choice] # optional, decisions only
---
```

`tags` come from `docs/project_log/tags.md`; add a tag there, with a one-line meaning, when none
fits. A decision that replaces an earlier one names it in `supersedes`.

**Type** is the strongest outcome of the topic; a research topic that ended in a choice is a
`decision`. A topic with two outcomes worth finding separately (measurements and the choice they
led to) can become two entries linked by `related`.

| Type | Outcome | Sections |
|---|---|---|
| `research` | Knowledge from outside sources | Question · Findings · Sources · Implications |
| `experiment` | Measurements on our own code or devices | Goal · Setup · Results · Interpretation |
| `discussion` | Options weighed, no conclusion yet | Question · Options · Where it stands · What would settle it |
| `decision` | A choice was made, with the discussion behind it | Context · Options · Decision · Consequences |
| `implementation` | Something was built and works | What and why · How it works · How it was verified · Limitations |
| `note` | A fact about the setup that later work depends on | Free form |

Attachments (raw data, screenshots) go to `docs/project_log/assets/<entry name>/`.
