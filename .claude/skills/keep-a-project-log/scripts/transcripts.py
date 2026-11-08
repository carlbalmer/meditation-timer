#!/usr/bin/env python3
"""Read this project's Claude Code chat transcripts in an LLM-friendly form.

  transcripts.py list                         chats (and their subagents) with basic stats
  transcripts.py read CHAT [--from X] [--to X] the conversation, tool calls shortened
  transcripts.py show CHAT ID                 full tool input/output of one message

CHAT is a chat id or unique prefix; a subagent is CHAT/AGENT (e.g. 7c14f930/a5ae32ec).
--from/--to take a message id (as printed by read) or a local time like 2026-10-15T07:23.
Times are printed in the server's local timezone.

This is the only harness-specific part of the skill: to support another harness, add a
parser that yields the same Message records.
"""
import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

SHORT = 300  # chars kept of a tool call's input and result in `read`

# Transcript entry types that never carry conversation.
BOOKKEEPING = {"queue-operation", "atis-latch", "last-prompt", "ai-title", "cost-state", "api-request-shape",
               "api-request-blob", "api-request", "mode", "isolation-latch", "summary", "system"}


@dataclass
class Message:
    id: str          # transcript entry uuid
    time: datetime
    role: str        # USER, ASSISTANT, REASONING, TOOL CALL, TOOL RESULT, NOTIFICATION
    text: str        # full text
    tool: str = ""   # tool name for calls/results
    tool_use_id: str = ""


# ---- locating transcripts ----------------------------------------------------------------

def transcripts_dir() -> Path:
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    slug = root.stdout.strip().replace("/", "-").replace(".", "-")
    d = Path.home() / ".claude" / "projects" / slug
    if not d.is_dir():
        sys.exit(f"no transcripts at {d}")
    return d


def chat_path(chat: str) -> Path:
    main, _, agent = chat.partition("/")
    hits = [p for p in transcripts_dir().glob("*.jsonl") if p.stem.startswith(main)]
    if len(hits) != 1:
        sys.exit(f"chat {main!r}: {len(hits)} matches")
    if not agent:
        return hits[0]
    sub = [p for p in (hits[0].parent / hits[0].stem / "subagents").glob("agent-*.jsonl")
           if p.stem.removeprefix("agent-").startswith(agent)]
    if len(sub) != 1:
        sys.exit(f"subagent {agent!r}: {len(sub)} matches")
    return sub[0]


# ---- parsing --------------------------------------------------------------------------------

def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone()


def strip_reminders(text):
    return re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S).strip()


def flatten(content):
    if isinstance(content, str):
        return content
    parts = []
    for b in content or []:
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(b.get("text", ""))
        elif isinstance(b, dict) and b.get("type") == "image":
            parts.append("[image]")
    return "\n".join(parts)


def notification(text):
    """Background task notification: its summary, plus a subagent's full answer."""
    summary = re.search(r"<summary>(.*?)</summary>", text, re.S)
    result = re.search(r"<result>(.*?)</result>", text, re.S)
    out = summary.group(1).strip() if summary else text.strip()
    return f"{out}\n\n{result.group(1).strip()}" if result else out


def parse(path: Path):
    """Messages of one transcript in order, plus the chat title and unknown entry types."""
    messages, title, unknown, tool_names = [], None, Counter(), {}
    for line in path.read_text().splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            unknown["<invalid json>"] += 1
            continue
        t, uid, ts = d.get("type"), d.get("uuid"), d.get("timestamp")
        if t == "ai-title":
            title = d.get("aiTitle") or title
        elif t == "assistant" and uid and ts:
            for b in (d.get("message") or {}).get("content") or []:
                bt = b.get("type")
                if bt == "text" and b.get("text", "").strip():
                    messages.append(Message(uid, parse_time(ts), "ASSISTANT", b["text"].strip()))
                elif bt == "thinking" and b.get("thinking", "").strip():
                    messages.append(Message(uid, parse_time(ts), "REASONING", b["thinking"].strip()))
                elif bt == "tool_use":
                    tool_names[b.get("id")] = b.get("name", "?")
                    messages.append(Message(uid, parse_time(ts), "TOOL CALL",
                                            json.dumps(b.get("input"), ensure_ascii=False, indent=1),
                                            b.get("name", "?"), b.get("id", "")))
        elif t == "user" and uid and ts and not d.get("isMeta"):
            content = (d.get("message") or {}).get("content")
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            for b in content or []:
                if b.get("type") == "text":
                    text = strip_reminders(b.get("text", ""))
                    if text.startswith("<task-notification>"):
                        messages.append(Message(uid, parse_time(ts), "NOTIFICATION", notification(text)))
                    elif text:
                        messages.append(Message(uid, parse_time(ts), "USER", text))
                elif b.get("type") == "tool_result":
                    tid = b.get("tool_use_id", "")
                    messages.append(Message(uid, parse_time(ts), "TOOL RESULT",
                                            strip_reminders(flatten(b.get("content"))), tool_names.get(tid, "?"), tid))
        elif t == "attachment" and uid and ts:
            a = d.get("attachment") or {}
            if a.get("type") == "queued_command":  # messages that arrived while the agent was working
                text = strip_reminders(flatten(a.get("prompt")))
                role = "NOTIFICATION" if a.get("commandMode") == "task-notification" else "USER"
                if text:
                    messages.append(Message(uid, parse_time(ts), role,
                                            notification(text) if role == "NOTIFICATION" else text))
        elif t not in BOOKKEEPING and t not in ("user", "assistant", "attachment"):
            unknown[t] += 1
    return messages, title, unknown


# ---- rendering ------------------------------------------------------------------------------

def short(text, limit=SHORT):
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit] + f" … [{len(text) - limit} more chars]"


def fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M")


def render(m: Message):
    head = f"[{m.id[:8]}] {fmt(m.time)}"
    if m.role == "TOOL CALL":
        return f"{head} → {m.tool}: {short(m.text)}"
    if m.role == "TOOL RESULT":
        if m.tool == "Agent" and not m.text.startswith("Async agent launched"):
            # a subagent's answer is conversation, keep it whole (background agents answer via NOTIFICATION)
            return f"## {head} SUBAGENT ANSWER\n{m.text}\n"
        return f"{head} ← {short(m.text)}"
    return f"## {head} {m.role}\n{m.text}\n"


def resolve(bound, messages, default):
    """Index for --from/--to: a message id prefix or a local time."""
    if bound is None:
        return default
    if re.fullmatch(r"[0-9a-f]{6,}(-[0-9a-f-]*)?", bound):
        for i, m in enumerate(messages):
            if m.id.startswith(bound):
                return i
        sys.exit(f"message {bound!r} not found")
    t = datetime.fromisoformat(bound)
    t = t.astimezone() if t.tzinfo else t.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return t


def window(messages, frm, to):
    lo = resolve(frm, messages, 0)
    hi = resolve(to, messages, len(messages) - 1)
    if isinstance(lo, datetime):
        lo = next((i for i, m in enumerate(messages) if m.time >= lo), len(messages))
    if isinstance(hi, datetime):
        hi = max((i for i, m in enumerate(messages) if m.time <= hi), default=-1)
    else:  # include every block of the --to message
        while hi + 1 < len(messages) and messages[hi + 1].id == messages[hi].id:
            hi += 1
    return messages[lo:hi + 1]


# ---- commands -------------------------------------------------------------------------------

def cmd_list(_):
    now = datetime.now().astimezone()
    print(f"now {fmt(now)}")
    for path in sorted(transcripts_dir().glob("*.jsonl"), key=lambda p: p.stat().st_mtime):
        msgs, title, _ = parse(path)
        if not msgs:
            continue
        tokens = sum(len(render(m)) for m in msgs) // 4
        print(f"{path.stem}  {title or '(untitled)'}\n"
              f"  started {fmt(msgs[0].time)} · last message {fmt(msgs[-1].time)} · "
              f"{len(msgs)} messages · ~{tokens // 1000}k tokens")
        for sub in sorted((path.parent / path.stem / "subagents").glob("agent-*.jsonl")):
            meta = sub.with_suffix(".meta.json")
            desc = json.loads(meta.read_text()).get("description", "") if meta.exists() else ""
            smsgs, _, _ = parse(sub)
            if smsgs:
                print(f"  └ {path.stem[:8]}/{sub.stem.removeprefix('agent-')[:8]}  {desc} · "
                      f"{fmt(smsgs[0].time)} · ~{sum(len(render(m)) for m in smsgs) // 4000}k tokens")


def cmd_read(args):
    msgs, title, unknown = parse(chat_path(args.chat))
    print(f"# {args.chat}  {title or ''}  (now {fmt(datetime.now().astimezone())})\n")
    for m in window(msgs, args.frm, args.to):
        print(render(m))
    if unknown:
        print(f"\n(Unrecognised transcript entries skipped: {dict(unknown)}. If they look like conversation, "
              "the transcript format changed: tell the user.)")


def cmd_show(args):
    msgs, _, _ = parse(chat_path(args.chat))
    hits = [m for m in msgs if m.id.startswith(args.id)]
    if not hits:
        sys.exit(f"message {args.id!r} not found")
    ids = {m.tool_use_id for m in hits if m.tool_use_id}
    for m in msgs:  # the message itself plus the other half of its tool call
        if m in hits or (m.tool_use_id and m.tool_use_id in ids):
            print(f"## [{m.id[:8]}] {fmt(m.time)} {m.role} {m.tool}\n{m.text}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="chats with stats").set_defaults(func=cmd_list)
    r = sub.add_parser("read", help="print a chat, tool calls shortened")
    r.add_argument("chat", help="chat id or prefix; a subagent is CHAT/AGENT")
    r.add_argument("--from", dest="frm", help="first message: id or local time like 2026-10-15T07:23")
    r.add_argument("--to", help="last message: id or local time")
    r.set_defaults(func=cmd_read)
    s = sub.add_parser("show", help="full tool input/output of one message")
    s.add_argument("chat", help="chat id or prefix; a subagent is CHAT/AGENT")
    s.add_argument("id", help="message id as printed by read")
    s.set_defaults(func=cmd_show)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
