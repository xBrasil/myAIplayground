"""Web content fetching service for model tool calling.

Security measures:
- Only HTTP(S) protocols allowed
- Private/internal IP addresses blocked
- Max response size enforced
- Request timeout enforced
- HTML content stripped to plain text
"""

import ipaddress
import logging
import re
import socket
from html.parser import HTMLParser
from io import StringIO
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────

_MAX_RESPONSE_BYTES = 512_000  # 512 KB max download
_MAX_TEXT_CHARS = 64_000  # max chars of extracted text returned
_REQUEST_TIMEOUT = 15.0  # seconds
_ALLOWED_SCHEMES = {"http", "https"}

# ── HTML stripping ───────────────────────────────────────────────


class _HTMLTextExtractor(HTMLParser):
    """Simple HTML-to-text converter using stdlib."""

    _SKIP_TAGS = {"script", "style", "noscript", "svg", "head"}

    def __init__(self) -> None:
        super().__init__()
        self._result = StringIO()
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag.lower() in self._SKIP_TAGS:
            self._skip_depth += 1
        if tag.lower() in ("br", "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr"):
            self._result.write("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self._SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        if tag.lower() in ("p", "div", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._result.write("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._result.write(data)

    def get_text(self) -> str:
        return self._result.getvalue()


def _strip_html(html: str) -> str:
    """Extract readable text from HTML."""
    extractor = _HTMLTextExtractor()
    try:
        extractor.feed(html)
    except Exception:
        # Fallback: simple regex strip
        return re.sub(r"<[^>]+>", " ", html)
    text = extractor.get_text()
    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ── Security: block private IPs ─────────────────────────────────


def _is_private_host(hostname: str) -> bool:
    """Check if hostname resolves to a private/internal IP address."""
    try:
        infos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for family, _, _, _, sockaddr in infos:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return True
    except (socket.gaierror, ValueError, OSError):
        return True  # Can't resolve → block
    return False


# ── Public API ───────────────────────────────────────────────────


def fetch_url(url: str) -> dict[str, str]:
    """Fetch URL content and return extracted text.

    Returns a dict with:
    - url: the original URL
    - title: page title if found
    - content: extracted text content
    - error: error message if fetch failed (content will be empty)
    """
    result = {"url": url, "title": "", "content": "", "error": ""}

    # Validate URL
    try:
        parsed = urlparse(url)
    except Exception:
        result["error"] = "URL inválida."
        return result

    if parsed.scheme not in _ALLOWED_SCHEMES:
        result["error"] = f"Protocolo não permitido: {parsed.scheme}. Use http ou https."
        return result

    if not parsed.hostname:
        result["error"] = "URL sem hostname."
        return result

    # Block private IPs (SSRF protection)
    if _is_private_host(parsed.hostname):
        result["error"] = "Acesso a endereços internos/privados não é permitido."
        return result

    # Fetch
    try:
        with httpx.Client(
            timeout=_REQUEST_TIMEOUT,
            follow_redirects=True,
            max_redirects=5,
        ) as client:
            response = client.get(
                url,
                headers={
                    "User-Agent": "MyAIPlayground/1.0 (Web Fetch Tool)",
                    "Accept": "text/html,application/xhtml+xml,text/plain,application/json,*/*;q=0.8",
                },
            )
            response.raise_for_status()

            # Enforce size limit
            content_bytes = response.content
            if len(content_bytes) > _MAX_RESPONSE_BYTES:
                content_bytes = content_bytes[:_MAX_RESPONSE_BYTES]

            content_type = response.headers.get("content-type", "")
            text = content_bytes.decode("utf-8", errors="ignore")

            if "html" in content_type.lower():
                # Try to extract title
                title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.IGNORECASE | re.DOTALL)
                if title_match:
                    result["title"] = title_match.group(1).strip()[:200]
                text = _strip_html(text)
            elif "json" in content_type.lower():
                # JSON: return as-is (trimmed)
                pass
            # else: plain text or other - return as-is

            result["content"] = text[:_MAX_TEXT_CHARS]

    except httpx.TimeoutException:
        result["error"] = f"Timeout ao acessar {url} (limite: {_REQUEST_TIMEOUT}s)."
    except httpx.HTTPStatusError as exc:
        result["error"] = f"Erro HTTP {exc.response.status_code} ao acessar {url}."
    except Exception as exc:
        result["error"] = f"Erro ao acessar {url}: {type(exc).__name__}: {exc}"

    return result


# ── Tool definition for OpenAI-compatible API ────────────────────

FETCH_URL_TOOL = {
    "type": "function",
    "function": {
        "name": "fetch_url",
        "description": (
            "Fetch the content of a web page given its URL. "
            "Use this tool when you need to access current information from the internet, "
            "read an article, check documentation, or retrieve any web content. "
            "Returns the text content of the page."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The full URL to fetch (must start with http:// or https://)",
                }
            },
            "required": ["url"],
        },
    },
}

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web using a search engine and return a list of results with titles, URLs, and snippets. "
            "Use this when the user asks you to search for something, or when you need to find relevant web pages "
            "before fetching their content. You can then use fetch_url to read specific results."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to look up on the web",
                }
            },
            "required": ["query"],
        },
    },
}


# ── Web search implementation ────────────────────────────────────

_SEARCH_MAX_RESULTS = 8


def web_search(query: str) -> dict:
    """Search the web using DuckDuckGo HTML Lite.

    Returns a dict with:
    - query: the original query
    - results: list of {title, url, snippet}
    - error: error message if search failed
    """
    result = {"query": query, "results": [], "error": ""}

    if not query.strip():
        result["error"] = "Empty search query."
        return result

    try:
        with httpx.Client(
            timeout=_REQUEST_TIMEOUT,
            follow_redirects=True,
            max_redirects=5,
        ) as client:
            response = client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={
                    "User-Agent": "MyAIPlayground/1.0 (Web Search Tool)",
                    "Accept": "text/html",
                },
            )
            response.raise_for_status()
            html = response.text

        # Parse results from DuckDuckGo HTML Lite
        results = []
        # Each result is in a <a class="result__a" href="...">title</a>
        # followed by <a class="result__snippet">snippet</a>
        title_pattern = re.compile(
            r'<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>(.*?)</a>',
            re.DOTALL | re.IGNORECASE,
        )
        snippet_pattern = re.compile(
            r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
            re.DOTALL | re.IGNORECASE,
        )

        titles = title_pattern.findall(html)
        snippets = snippet_pattern.findall(html)

        for i, (url, title) in enumerate(titles[:_SEARCH_MAX_RESULTS]):
            snippet = _strip_html(snippets[i]) if i < len(snippets) else ""
            title_clean = _strip_html(title).strip()
            # DuckDuckGo wraps URLs in a redirect; extract the real URL
            real_url = url
            uddg_match = re.search(r'[?&]uddg=([^&]+)', url)
            if uddg_match:
                from urllib.parse import unquote
                real_url = unquote(uddg_match.group(1))
            results.append({
                "title": title_clean,
                "url": real_url,
                "snippet": snippet.strip(),
            })

        result["results"] = results
        if not results:
            result["error"] = "No results found."

    except httpx.TimeoutException:
        result["error"] = f"Search timed out (limit: {_REQUEST_TIMEOUT}s)."
    except httpx.HTTPStatusError as exc:
        result["error"] = f"HTTP error {exc.response.status_code} during search."
    except Exception as exc:
        result["error"] = f"Search error: {type(exc).__name__}: {exc}"

    return result


def execute_tool_call(name: str, arguments: dict) -> str:
    """Execute a tool call and return the result as a string."""
    if name == "fetch_url":
        url = arguments.get("url", "")
        if not url:
            return "Error: no URL provided."
        result = fetch_url(url)
        if result["error"]:
            return f"Error fetching {url}: {result['error']}"
        parts = []
        if result["title"]:
            parts.append(f"Title: {result['title']}")
        parts.append(f"URL: {result['url']}")
        parts.append(f"Content:\n{result['content']}")
        return "\n".join(parts)

    if name == "web_search":
        query = arguments.get("query", "")
        if not query:
            return "Error: no search query provided."
        result = web_search(query)
        if result["error"] and not result["results"]:
            return f"Search error: {result['error']}"
        parts = [f"Search results for: {result['query']}\n"]
        for i, r in enumerate(result["results"], 1):
            parts.append(f"{i}. {r['title']}")
            parts.append(f"   URL: {r['url']}")
            if r["snippet"]:
                parts.append(f"   {r['snippet']}")
            parts.append("")
        return "\n".join(parts)

    return f"Error: unknown tool '{name}'."
