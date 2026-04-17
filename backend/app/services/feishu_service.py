"""Feishu/Lark document fetching service.
Uses lark-cli to fetch document content from Feishu wiki/doc URLs.
Falls back to Feishu Open API for unsupported document types (sheets, bitable)."""

import asyncio
import re
import json
import logging
import httpx

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


async def _resolve_wiki_node(token: str) -> dict | None:
    """Resolve a wiki node token to get the actual document type and token via Feishu Open API."""
    try:
        from app.config import settings

        # Get tenant access token
        async with httpx.AsyncClient(timeout=10) as client:
            token_resp = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": settings.feishu_app_id, "app_secret": settings.feishu_app_secret},
            )
            access_token = token_resp.json().get("tenant_access_token")
            if not access_token:
                logger.warning("[feishu] Failed to get tenant access token")
                return None

            # Get wiki node info
            node_resp = await client.get(
                f"https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node",
                params={"token": token},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            data = node_resp.json()
            if data.get("code") != 0:
                logger.warning("[feishu] get_node error: %s", data.get("msg"))
                return None
            return data.get("data", {}).get("node")
    except Exception as e:
        logger.warning("[feishu] Failed to resolve wiki node: %s", e)
        return None


async def _fetch_sheet_content(token: str) -> dict:
    """Fetch sheet content using lark-cli sheets command."""
    result = await _run_lark_cli(
        "sheets", "+read", "--spreadsheet-token", token, "--as", "bot"
    )
    if result.get("error"):
        return {"error": f"Cannot read sheet: {result['error']}"}

    # lark-cli wraps response in {ok, data, ...}
    data = result.get("data", result)
    value_range = data.get("valueRange", {}) if isinstance(data, dict) else {}
    values = value_range.get("values", [])

    if not values:
        return {"error": "Sheet is empty or could not be read."}

    # Convert rows to readable text
    content_parts = []
    for row in values:
        if isinstance(row, (list, tuple)):
            cells = []
            for c in row:
                if c is None:
                    cells.append("")
                elif isinstance(c, (dict, list)):
                    # Rich text cells — extract plain text
                    cells.append(_extract_rich_text(c))
                else:
                    cells.append(str(c))
            if any(cell.strip() for cell in cells):
                content_parts.append(" | ".join(cells))

    return {
        "title": "Feishu Sheet",
        "content": "\n".join(content_parts),
    }


def _extract_rich_text(val) -> str:
    """Extract plain text from Feishu rich text cell value."""
    if isinstance(val, str):
        return val
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, list):
        # List of segments: [{"text": "...", ...}, ...]
        parts = []
        for seg in val:
            if isinstance(seg, dict):
                text = seg.get("text", "")
                if text:
                    parts.append(text)
                elif seg.get("category") == "at-user-block":
                    parts.append(seg.get("text", "@user"))
            elif isinstance(seg, str):
                parts.append(seg)
        return "".join(parts)
    if isinstance(val, dict):
        # Single segment or at-user-block
        if val.get("text"):
            return val["text"]
        if val.get("category") == "at-user-block":
            return "@user"
        return json.dumps(val, ensure_ascii=False)
    return str(val) if val else ""


async def fetch_feishu_content(url: str) -> dict:
    """Fetch document content from a Feishu URL using lark-cli.
    Returns {"title": str, "content": str, "url": str}."""

    parsed = parse_feishu_url(url)
    if not parsed["token"]:
        return {"error": "Could not parse Feishu URL. Supported: wiki, docx, sheet links."}

    try:
        # For wiki links, first resolve the node to find actual document type
        if parsed["type"] == "wiki":
            node = await _resolve_wiki_node(parsed["token"])
            if node and node.get("obj_type") in ("sheet", "bitable"):
                logger.info("[feishu] Wiki node %s is actually a %s (obj_token=%s)",
                            parsed["token"], node["obj_type"], node.get("obj_token"))
                if node["obj_type"] == "sheet":
                    result = await _fetch_sheet_content(node["obj_token"])
                    if result.get("error"):
                        return {"error": result["error"], "url": url}
                    return {
                        "title": node.get("title", result.get("title", "Feishu Sheet")),
                        "content": result.get("content", ""),
                        "url": url,
                    }
                # bitable — not yet supported
                return {"error": f"This is a Feishu Base (bitable), which is not yet supported for import. Please export it as Excel first.", "url": url}

        # Default: use lark-cli docs +fetch for docx/wiki-docx
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
            # Extract user-friendly error message
            try:
                err_data = json.loads(err_msg or output)
                inner = err_data.get("error", {})
                friendly = inner.get("message", "") if isinstance(inner, dict) else str(inner)
                if "not found" in friendly.lower():
                    return {"error": "Document not found or bot has no access. Check that the document is shared with the Feishu bot."}
                return {"error": friendly or f"lark-cli error: {err_msg or output}"}
            except json.JSONDecodeError:
                pass
            return {"error": f"lark-cli error (exit {proc.returncode}): {err_msg or output}"}

        # Try to parse as JSON
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return {"data": output}

    except asyncio.TimeoutError:
        return {"error": "lark-cli timed out after 30s"}
    except FileNotFoundError:
        return {"error": "lark-cli not found. Install it with: npm install -g @larksuite/cli"}
