#!/usr/bin/env python3
"""一次性历史数据迁移:OpenClaw Radar → agent-lab D1。

数据源:
1. ~/.openclaw/workspace-radar/radar-board.html 的 const DATA 数组 (~253 条)
2. ~/.openclaw/workspace-radar/push-history.md (~4 条最新,补 board 之后)

目标:POST 到 http://127.0.0.1:8788/api/items/batch (本地) 或 PLATFORM_API_BASE (线上)。
external_id 设计:
- board DATA: f"hist-board-{p_id}"  (p001, p002...)
- push-history.md: f"hist-md-{date}-{idx}"

幂等:服务端 INSERT OR IGNORE,重跑安全。

用法:
    python scripts/migrate-push-history.py [--dry-run] [--limit N]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

RADAR_DIR = Path.home() / ".openclaw" / "workspace-radar"
BOARD_HTML = RADAR_DIR / "radar-board.html"
PUSH_MD = RADAR_DIR / "push-history.md"

API_BASE = os.getenv("PLATFORM_API_BASE", "http://127.0.0.1:8788")
TOKEN = os.getenv("RADAR_WRITE_TOKEN", "dev-radar-token-change-me")
BATCH_SIZE = 50

GRADE_MAP = {"🔥": "fire", "⚡": "bolt", "⚡️": "bolt", "💡": "bulb"}
URL_RE = re.compile(r"https?://[^\s,)]+")


# ─── 1. 解析 radar-board.html 的 DATA 数组 ─────────────────────────────────

def extract_board_data(html: str) -> list[dict]:
    """提取 const DATA = [ ... ]; 数组,逐项解析为 dict。

    每行格式:
      {id:"p000",date:"2026-04-03",round:0,grade:"⚡",title:"...",desc:"...",
       why:"...",url:"...",tags:["..."],extra:[]},
    """
    start = html.find("const DATA = [")
    if start < 0:
        return []
    bracket_start = html.index("[", start)
    depth = 0
    end = -1
    for i in range(bracket_start, len(html)):
        c = html[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end < 0:
        return []
    body = html[bracket_start + 1 : end]

    items: list[dict] = []
    # 每条以 `,\n  {id:"pXXX"` 之类开头,简单 split 不安全(字符串内可能有 {),
    # 改用逐行 + 行首 {id:" 检测 + 配对 } 方案
    lines = body.split("\n")
    buf = ""
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if s.startswith("{id:"):
            if buf:
                items.append(_parse_item_line(buf))
            buf = s
        else:
            buf += " " + s
    if buf:
        items.append(_parse_item_line(buf))
    return [it for it in items if it]


def _parse_item_line(line: str) -> dict | None:
    """把 JS 对象字面量转 Python dict。

    依赖 JS 字面量足够 JSON-like:用正则把 key 加引号。但字符串里有转义,用更稳的方式:
    手工逐字段提取。
    """
    line = line.strip().rstrip(",")
    if line.endswith("},"):
        line = line[:-1]
    if not (line.startswith("{") and line.endswith("}")):
        return None

    # 字段提取:每个字段都是 key:"value" 或 key:[...] 或 key:N
    # 用 char-by-char 解析最稳
    fields = _extract_js_fields(line[1:-1])
    if not fields.get("id") or not fields.get("title"):
        return None

    return {
        "id": fields.get("id", ""),
        "date": fields.get("date", ""),
        "grade": fields.get("grade", "⚡"),
        "title": fields.get("title", ""),
        "desc": fields.get("desc", ""),
        "why": fields.get("why", ""),
        "url": fields.get("url", ""),
        "tags": fields.get("tags", []),
    }


def _extract_js_fields(body: str) -> dict:
    """逐字段扫描 JS 对象字面量内部 (无外层括号),返回 {key: value}。

    支持的 value 类型:string ("..."),array (["..."]),number。
    字符串内的转义:\", \\, \n。
    """
    out: dict = {}
    i = 0
    n = len(body)
    while i < n:
        # 跳空白和逗号
        while i < n and body[i] in " \t,\n":
            i += 1
        if i >= n:
            break
        # key
        key_start = i
        while i < n and body[i] not in ":":
            i += 1
        if i >= n:
            break
        key = body[key_start:i].strip()
        i += 1  # 跳过 ':'
        while i < n and body[i] in " \t":
            i += 1
        if i >= n:
            break

        # value
        if body[i] == '"':
            # 字符串
            i += 1
            val_chars: list[str] = []
            while i < n:
                c = body[i]
                if c == "\\" and i + 1 < n:
                    nxt = body[i + 1]
                    if nxt == "n":
                        val_chars.append("\n")
                    elif nxt == "t":
                        val_chars.append("\t")
                    else:
                        val_chars.append(nxt)
                    i += 2
                elif c == '"':
                    i += 1
                    break
                else:
                    val_chars.append(c)
                    i += 1
            out[key] = "".join(val_chars)
        elif body[i] == "[":
            # 数组 (string array only)
            i += 1
            arr: list[str] = []
            while i < n and body[i] != "]":
                while i < n and body[i] in " \t,":
                    i += 1
                if i < n and body[i] == '"':
                    i += 1
                    s_chars: list[str] = []
                    while i < n:
                        c = body[i]
                        if c == "\\" and i + 1 < n:
                            s_chars.append(body[i + 1])
                            i += 2
                        elif c == '"':
                            i += 1
                            break
                        else:
                            s_chars.append(c)
                            i += 1
                    arr.append("".join(s_chars))
                else:
                    i += 1
            if i < n and body[i] == "]":
                i += 1
            out[key] = arr
        else:
            # number 或裸 token
            v_start = i
            while i < n and body[i] not in ",":
                i += 1
            out[key] = body[v_start:i].strip()
    return out


def board_item_to_inputs(item: dict) -> list[dict]:
    """board DATA dict → 一组 ItemInput。

    旧 sync-board.js 把一行 ` · ` 分隔的多条推荐塞进同一个 desc。
    这里把它们拆开,每条独立成 ItemInput:
    - 第 1 条:继承 row 的 title/grade/why/tags/url (这些 sync-board.js 当年只对第一条生效)
    - 第 2..N 条:从 desc 后续 chunk 解析,grade 从 emoji 提取
    """
    date_str = item.get("date", "")
    try:
        round_at = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        round_at = datetime.now(timezone.utc)
    round_at_iso = round_at.isoformat()

    desc_full = item.get("desc", "").strip()
    chunks = re.split(r"\s+·\s+", desc_full) if desc_full else [""]
    legacy_id = item["id"]

    out: list[dict] = []
    for idx, chunk in enumerate(chunks):
        chunk = chunk.strip()
        if idx == 0:
            # 第一条:用 row 的 title,从 chunk 里抽 URL (因为 row.url 常是最后一条的)
            first_url = ""
            m = URL_RE.search(chunk)
            if m:
                first_url = m.group(0)
                # desc 去掉末尾 url
                first_desc = chunk[: m.start()].rstrip(" →,").strip()
            else:
                first_desc = chunk
            entry = {
                "external_id": f"hist-board-{legacy_id}-00",
                "agent_id": "radar",
                "item_type": "recommendation",
                "grade": GRADE_MAP.get(item["grade"], "bolt"),
                "title": item.get("title", "").strip()[:500] or "(untitled)",
                "summary": first_desc[:1000],
                "why": item.get("why", "").strip() or None,
                "url": first_url or item.get("url") or None,
                "source": _detect_source(first_url or item.get("url", "")),
                "tags": item.get("tags", [])[:10],
                "payload": {
                    "legacy_id": legacy_id,
                    "chunk_idx": 0,
                    "from": "radar-board.html",
                },
                "round_at": round_at_iso,
            }
            out.append(entry)
        else:
            parsed = _parse_md_chunk(chunk)
            if not parsed:
                continue
            parsed["external_id"] = f"hist-board-{legacy_id}-{idx:02d}"
            parsed["round_at"] = round_at_iso
            parsed["payload"] = {
                "legacy_id": legacy_id,
                "chunk_idx": idx,
                "from": "radar-board.html",
            }
            out.append(parsed)
    return out


def _detect_source(url: str) -> str | None:
    if not url:
        return None
    if "github.com" in url:
        return "github"
    if "news.ycombinator.com" in url or "ycombinator" in url:
        return "hacker-news"
    if "v2ex.com" in url:
        return "v2ex"
    if "x.com" in url or "twitter.com" in url:
        return "x"
    if "reddit.com" in url:
        return "reddit"
    if "linux.do" in url:
        return "linux-do"
    return "web"


# ─── 2. 解析 push-history.md 的 4 行 ────────────────────────────────────────

def parse_push_md(md: str) -> list[dict]:
    """解析 markdown 表格行,一行可能含多条推荐 (用 ' · ' 分隔),全部拆开。"""
    out: list[dict] = []
    for line in md.split("\n"):
        if not line.startswith("|"):
            continue
        cols = [c.strip() for c in line.split("|") if c.strip()]
        if len(cols) < 3:
            continue
        if cols[0] == "日期" or set(cols[0]) <= {"-", " "}:
            continue
        date_col, items_col = cols[0], cols[1]
        feedback = cols[2] if len(cols) > 2 else ""
        analysis = cols[3] if len(cols) > 3 else ""

        date_str = re.sub(r"\s*\(.*?\)\s*$", "", date_col).strip()
        try:
            round_at = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
        except ValueError:
            round_at = datetime.now(timezone.utc)

        # 拆 ' · ' 分隔的多条
        chunks = re.split(r"\s+·\s+", items_col)
        for idx, chunk in enumerate(chunks):
            parsed = _parse_md_chunk(chunk)
            if not parsed:
                continue
            parsed["external_id"] = f"hist-md-{date_str}-{idx:02d}"
            parsed["round_at"] = round_at.isoformat()
            parsed["payload"] = {
                "from": "push-history.md",
                "feedback": feedback,
                "analysis": analysis[:500],
            }
            out.append(parsed)
    return out


def _parse_md_chunk(chunk: str) -> dict | None:
    """单条推荐:'🔥 Title → URL' 或 '⚡ Title — desc → URL'。"""
    chunk = chunk.strip()
    # grade emoji
    grade = "bolt"
    for emoji, g in GRADE_MAP.items():
        if chunk.startswith(emoji):
            grade = g
            chunk = chunk[len(emoji) :].strip()
            break
        # 复合 emoji 如 🛡️💡
        if emoji in chunk[:5]:
            grade = g
    # 去掉🆕 / 🛡️ 等装饰 emoji
    chunk = re.sub(r"[🆕🛡️]", "", chunk).strip()

    # url
    url_match = URL_RE.search(chunk)
    url = url_match.group(0) if url_match else ""
    if url_match:
        chunk = chunk[: url_match.start()].rstrip(" →,").strip()

    # title — desc
    title, desc = chunk, ""
    for sep in [" — ", " - ", "—"]:
        if sep in chunk:
            title, desc = chunk.split(sep, 1)
            title = title.strip()
            desc = desc.strip()
            break

    if not title:
        return None
    return {
        "agent_id": "radar",
        "item_type": "recommendation",
        "grade": grade,
        "title": title[:500],
        "summary": desc,
        "why": None,
        "url": url or None,
        "source": _detect_source(url),
        "tags": [],
    }


# ─── 3. 主流程 ────────────────────────────────────────────────────────────

def post_batch(items: list[dict], dry_run: bool) -> tuple[int, int]:
    if dry_run:
        return len(items), 0
    if not items:
        return 0, 0
    payload = {
        "round_at": datetime.now(timezone.utc).isoformat(),
        "items": items,
    }
    r = httpx.post(
        f"{API_BASE}/api/items/batch",
        json=payload,
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=30.0,
        trust_env=False,
    )
    r.raise_for_status()
    data = r.json()
    return data.get("inserted", 0), data.get("skipped", 0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印,不 POST")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 条")
    args = ap.parse_args()

    print(f"[migrate] reading {BOARD_HTML}")
    board_html = BOARD_HTML.read_text(encoding="utf-8")
    board_items = extract_board_data(board_html)
    print(f"[migrate] board DATA: {len(board_items)} items")

    print(f"[migrate] reading {PUSH_MD}")
    md = PUSH_MD.read_text(encoding="utf-8")
    md_items_raw = parse_push_md(md)
    print(f"[migrate] push-history.md: {len(md_items_raw)} items (split from rows)")

    # 转换:board 每行可能拆出多条
    inputs: list[dict] = []
    for it in board_items:
        inputs.extend(board_item_to_inputs(it))
    inputs.extend(md_items_raw)

    if args.limit:
        inputs = inputs[: args.limit]

    print(f"[migrate] total {len(inputs)} ItemInputs")
    if args.dry_run:
        print("[migrate] dry-run sample:")
        print(json.dumps(inputs[:2], ensure_ascii=False, indent=2))

    # 分批 POST
    inserted_total = 0
    skipped_total = 0
    for i in range(0, len(inputs), BATCH_SIZE):
        batch = inputs[i : i + BATCH_SIZE]
        try:
            ins, skp = post_batch(batch, args.dry_run)
            inserted_total += ins
            skipped_total += skp
            print(
                f"[migrate] batch {i // BATCH_SIZE + 1}: "
                f"inserted={ins} skipped={skp}"
            )
        except Exception as e:  # noqa: BLE001
            print(f"[migrate] batch {i // BATCH_SIZE + 1} FAILED: {e}", file=sys.stderr)
            sys.exit(1)

    print(
        f"[migrate] DONE — total inserted={inserted_total} skipped={skipped_total}"
    )


if __name__ == "__main__":
    main()
