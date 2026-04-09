"""Radar 推送流 CLI 入口 (薄 wrapper, 消费 push.run_push_stream)。

生产环境用 HTTP `POST /cron/push` 触发;这个 CLI 只是本地开发便利。
"""

from __future__ import annotations

import asyncio
import json

import click

from .push import run_push_stream


async def _run(limit: int, dry_run: bool) -> int:
    """消费 async generator,按事件类型打印进度。"""
    if dry_run:
        click.echo("[radar-push] --dry-run mode: will still hit LLM but not POST", err=True)

    result: dict = {"inserted": 0, "skipped": 0, "total": 0}
    async for ev in run_push_stream(limit=limit):
        t = ev.get("type")
        if t == "start":
            click.echo(
                f"[radar-push] start · limit={ev.get('limit')} mock={ev.get('mock')}"
            )
        elif t == "span":
            status = ev.get("status", "?")
            icon = {"running": "⋯", "done": "✓", "failed": "✗"}.get(status, "•")
            ms = ev.get("ms")
            ms_s = f" ({ms}ms)" if ms is not None else ""
            click.echo(f"  {icon} [{ev.get('kind'):6s}] {ev.get('title')}{ms_s}")
            if status == "done" and ev.get("detail"):
                # 紧凑打印 detail
                d = ev["detail"]
                for k, v in d.items():
                    if isinstance(v, list):
                        click.echo(f"       {k}: ({len(v)} items)")
                    else:
                        click.echo(f"       {k}: {v}")
        elif t == "result":
            result = ev
            click.echo(
                f"[radar-push] DONE · inserted={ev.get('inserted')} "
                f"skipped={ev.get('skipped')} total={ev.get('total')} "
                f"({ev.get('total_ms', '?')}ms)"
            )
            if ev.get("preview"):
                click.echo("[radar-push] picks:")
                for p in ev["preview"]:
                    click.echo(f"  · [{p['grade']}] {p['title']}")
        elif t == "error":
            click.echo(f"[radar-push] ERROR: {ev.get('message')}", err=True)
            return 1

    return 0 if result.get("inserted", 0) + result.get("skipped", 0) > 0 else 0


@click.command()
@click.option("--limit", default=30, help="HN top stories 拉取数量")
@click.option("--dry-run", is_flag=True, default=False, help="占位,暂无实际效果")
def main(limit: int, dry_run: bool) -> None:
    """radar-push CLI 入口。"""
    code = asyncio.run(_run(limit, dry_run))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
