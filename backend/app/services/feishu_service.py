"""Feishu/Lark document fetching service.
Uses lark-cli to fetch document content from Feishu wiki/doc URLs."""

import asyncio
import re
import json
import logging

logger = logging.getLogger(__name__)

# Patterns for extracting tokens from Feishu URLs
WIKI_PATTERN = re.compile(r"wiki/(\w+)")
DOCX_PATTERN = re.compile(r"docx/(\w+)")
BASE_PATTERN = re.compile(r"base/(\w+)")
SHEETS_PATTERN = re.compile(r"sheets/(\w+)")

# Fallback: generic token from last path segment
GENERIC_TOKEN = re.compile(r"/([A-Za-z0-9]{10,})(?:\?|$|/)")


def parse_feishu_url(url: str) -> dict:
    """Parse a Feishu URL and extract the document type and token."""
    url = url.strip()

    if match := WIKI_PATTERN.search(url):
        return {"type": "wiki", "token": match.group(1)}
    if match := DOCX_PATTERN.search(url):
        return {"type": "docx", "token": match.group(1)}
    if match := BASE_PATTERN.search(url):
        return {"type": "base", "token": match.group(1)}
    if match := SHEETS_PATTERN.search(url):
        return {"type": "sheets", "token": match.group(1)}
    if match := GENERIC_TOKEN.search(url):
        return {"type": "wiki", "token": match.group(1)}

    return {"type": None, "token": None}


async def fetch_feishu_content(url: str) -> dict:
    """Fetch document content from a Feishu URL using lark-cli.
    Returns {"title": str, "content": str, "url": str}."""

    parsed = parse_feishu_url(url)
    if not parsed["token"]:
        return {"error": "Could not parse Feishu URL. Supported: wiki, docx links."}

    try:
        # Use lark-cli docs +fetch which handles both wiki and docx URLs
        result = await _run_lark_cli(
            "docs", "+fetch", "--doc", url, "--format", "json"
        )
        if result.get("error"):
            return {"error": result["error"], "url": url}

        data = result.get("data", {})
        content = data.get("markdown", "") or data.get("content", "")
        if not content and isinstance(data, str):
            content = data
        title = data.get("title", "Feishu Document")

        return {"title": title, "content": content, "url": url}

    except Exception as e:
        logger.exception("Failed to fetch Feishu content")
        return {"error": str(e)}


async def _run_lark_cli(*args: str) -> dict:
    """Run a lark-cli command and return parsed output."""
    cmd = ["lark-cli"] + list(args)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        output = stdout.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="replace").strip()
            return {"error": f"lark-cli error (exit {proc.returncode}): {err_msg or output}"}

        # Try to parse as JSON
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return {"data": output}

    except asyncio.TimeoutError:
        return {"error": "lark-cli timed out after 30s"}
    except FileNotFoundError:
        return {"error": "lark-cli not found. Install it with: npm install -g @anthropic-ai/lark-cli"}
