"""Radar CLI 入口: ingest / evaluate 子命令。

生产环境用 HTTP 端点触发；CLI 只是本地开发便利。
"""

from __future__ import annotations

import asyncio

import click

from agent_lab_shared.db import PlatformClient
from agent_lab_shared.schema import SourceConfig


def _print_events(ev: dict) -> int | None:
    """统一打印 progress event，返回 exit code（仅 error 时返回 1）。"""
    t = ev.get("type")
    if t == "start":
        phase = ev.get("phase", "?")
        click.echo(f"[radar-{phase}] start · {ev}")
    elif t == "span":
        status = ev.get("status", "?")
        icon = {"running": "⋯", "done": "✓", "failed": "✗"}.get(status, "•")
        ms = ev.get("ms")
        ms_s = f" ({ms}ms)" if ms is not None else ""
        click.echo(f"  {icon} [{ev.get('kind'):6s}] {ev.get('title')}{ms_s}")
        if status == "done" and ev.get("detail"):
            d = ev["detail"]
            for k, v in d.items():
                if isinstance(v, list):
                    click.echo(f"       {k}: ({len(v)} items)")
                else:
                    click.echo(f"       {k}: {v}")
    elif t == "result":
        phase = ev.get("phase", "?")
        click.echo(f"[radar-{phase}] DONE · {ev.get('total_ms', '?')}ms")
        for k in ("fetched", "inserted", "skipped", "evaluated", "promoted", "rejected"):
            if k in ev:
                click.echo(f"  {k}: {ev[k]}")
        if ev.get("preview"):
            click.echo("[radar] picks:")
            for p in ev["preview"]:
                click.echo(f"  · [{p['grade']}] {p['title']}")
    elif t == "error":
        click.echo(f"[radar] ERROR: {ev.get('message')}", err=True)
        return 1
    return None


@click.group()
def cli() -> None:
    """Radar Agent CLI。"""


@cli.command()
def ingest() -> None:
    """执行一次 Ingestion（采集原始内容）。"""
    from .pipelines.ingest import run_ingest_stream

    async def _run() -> int:
        client = PlatformClient()
        resp = client.get_sources(agent_id="radar")
        sources = [
            SourceConfig(id=s["id"], source_type=s["source_type"], config=s.get("config", {}))
            for s in resp.get("sources", [])
            if s.get("enabled", True)
        ]
        if not sources:
            click.echo("[radar-ingest] no enabled sources found", err=True)
            return 1
        async for ev in run_ingest_stream(sources):
            code = _print_events(ev)
            if code is not None:
                return code
        return 0

    raise SystemExit(asyncio.run(_run()))


@cli.command()
def evaluate() -> None:
    """执行一次 Evaluate（LLM 评判筛选）。"""
    from .pipelines.evaluate import run_evaluate_stream

    async def _run() -> int:
        async for ev in run_evaluate_stream():
            code = _print_events(ev)
            if code is not None:
                return code
        return 0

    raise SystemExit(asyncio.run(_run()))


@cli.command()
def push() -> None:
    """执行完整流程: ingest + evaluate（向后兼容）。"""
    from .pipelines.evaluate import run_evaluate_stream
    from .pipelines.ingest import run_ingest_stream

    async def _run() -> int:
        client = PlatformClient()
        resp = client.get_sources(agent_id="radar")
        sources = [
            SourceConfig(id=s["id"], source_type=s["source_type"], config=s.get("config", {}))
            for s in resp.get("sources", [])
            if s.get("enabled", True)
        ]
        if not sources:
            click.echo("[radar-push] no enabled sources found", err=True)
            return 1

        click.echo("── Phase 1: Ingest ──")
        async for ev in run_ingest_stream(sources):
            code = _print_events(ev)
            if code is not None:
                return code

        click.echo("\n── Phase 2: Evaluate ──")
        async for ev in run_evaluate_stream():
            code = _print_events(ev)
            if code is not None:
                return code

        return 0

    raise SystemExit(asyncio.run(_run()))


def main() -> None:
    """radar-push 入口（向后兼容 pyproject.toml scripts）。"""
    cli()


if __name__ == "__main__":
    main()
