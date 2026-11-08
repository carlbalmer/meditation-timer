#!/usr/bin/env python3
"""Per-chat progress of the project log, in docs/project_log/.state.json.

  state.py show
  state.py record CHAT [--caught-up-through ID TIME]
                       [--entry FILE FROM_ID FROM_TIME TO_ID TO_TIME "DESCRIPTION"]...

For each chat the state holds `caught_up_through` (everything up to that message is logged or
irrelevant) and the entries written from it, each with a short description and the message range
it covers. Ids and times are stored as given (as printed by transcripts.py read); a time without a
timezone is taken as local time. Recording an entry whose file is already listed for the chat
updates it in place: the description is replaced and the range widened.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def state_path() -> Path:
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    return Path(root.stdout.strip()) / "docs" / "project_log" / ".state.json"


def load():
    p = state_path()
    return json.loads(p.read_text()) if p.exists() else {"chats": {}}


def when(text):
    try:
        t = datetime.fromisoformat(text.replace(" ", "T"))
    except ValueError:
        sys.exit(f"not a time: {text!r} (expected e.g. 2026-10-15 07:23)")
    return t if t.tzinfo else t.astimezone()


def point(msg_id, time):
    return {"id": msg_id, "time": when(time).isoformat(timespec="minutes")}


def cmd_show(_):
    print(json.dumps(load(), indent=2, ensure_ascii=False))


def cmd_record(args):
    state = load()
    # A short and a full id of the same chat refer to one record; keep the longer key.
    # ("a/b" ids of subagent chats only match exactly.)
    def same(k):
        return k == args.chat or ("/" not in k + args.chat and (k.startswith(args.chat) or args.chat.startswith(k)))
    key = next((k for k in state["chats"] if same(k)), args.chat)
    if len(args.chat) > len(key):
        state["chats"][args.chat] = state["chats"].pop(key)
        key = args.chat
    chat = state["chats"].setdefault(key, {"caught_up_through": None, "entries": []})
    log_dir = state_path().parent
    for file, from_id, from_time, to_id, to_time, desc in args.entry:
        name = Path(file).name
        if not (log_dir / name).exists():
            sys.exit(f"{name} does not exist in {log_dir}")
        start, end = point(from_id, from_time), point(to_id, to_time)
        if when(start["time"]) > when(end["time"]):
            sys.exit(f"{name}: range starts after it ends")
        existing = next((e for e in chat["entries"] if e["file"] == name), None)
        if existing:  # an edited entry: widen its range
            if when(start["time"]) < when(existing["from"]["time"]):
                existing["from"] = start
            if when(end["time"]) > when(existing["to"]["time"]):
                existing["to"] = end
            existing["description"] = desc
        else:
            chat["entries"].append({"file": name, "description": desc, "from": start, "to": end})
    if args.caught_up_through:
        chat["caught_up_through"] = point(*args.caught_up_through)
    state_path().write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n")
    print(f"recorded {len(args.entry)} entries; caught up through "
          f"{(chat['caught_up_through'] or {}).get('time', 'nothing yet')}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show").set_defaults(func=cmd_show)
    r = sub.add_parser("record")
    r.add_argument("chat", help="chat id as printed by transcripts.py list")
    r.add_argument("--caught-up-through", nargs=2, metavar=("ID", "TIME"))
    r.add_argument("--entry", nargs=6, action="append", default=[],
                   metavar=("FILE", "FROM_ID", "FROM_TIME", "TO_ID", "TO_TIME", "DESCRIPTION"))
    r.set_defaults(func=cmd_record)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
