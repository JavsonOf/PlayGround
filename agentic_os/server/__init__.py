"""HTTP API for deploying Agentic OS (roadmap stage 11).

Standard library only (``http.server``), so it deploys anywhere Python
runs. Put it behind a reverse proxy (TLS, rate limits) in production.

Endpoints (JSON in, JSON out):

=======  ================================  =========================================
GET      /health                           liveness probe
GET      /status                           OS summary
GET      /metrics                          counters and latency percentiles
GET      /agents                           registered agents
POST     /agents                           spawn ``{name, instructions?, tools?, tool_tags?, conversational?}``
POST     /run                              ``{task, agent?, context?, async?}`` -> process
GET      /processes                        process table
GET      /processes/{pid}                  one process, with its result
POST     /processes/{pid}/feedback         ``{reward, comment?}``, reward in [-1, 1]
POST     /knowledge                        ``{text, metadata?}`` or ``{documents: [...]}``
POST     /goal                             ``{goal, agents?}`` -> plan + result
GET      /traces/{trace_id}                spans for one agent run
=======  ================================  =========================================

Set ``AGENTIC_OS_API_KEY`` to require ``Authorization: Bearer <key>``.
"""

from __future__ import annotations

import hmac
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from agentic_os.kernel import AgenticOS, AgenticOSError
from agentic_os.rag.pipeline import Document

MAX_BODY = 2 * 1024 * 1024


class HTTPError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _require(body: dict[str, Any], key: str, kind: type = str) -> Any:
    value = body.get(key)
    if not isinstance(value, kind) or (kind is str and not value.strip()):
        raise HTTPError(400, f"'{key}' is required and must be a {kind.__name__}")
    return value


def make_handler(system: AgenticOS) -> type[BaseHTTPRequestHandler]:
    api_key = system.settings.api_key

    class Handler(BaseHTTPRequestHandler):
        server_version = "AgenticOS/0.1"

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter default logging
            system.metrics.incr("http.requests")

        # ----------------------------------------------------------- helpers
        def _send(self, status: int, payload: Any) -> None:
            data = json.dumps(payload, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise HTTPError(413, "Request body too large")
            if not length:
                return {}
            try:
                body = json.loads(self.rfile.read(length))
            except json.JSONDecodeError as exc:
                raise HTTPError(400, f"Invalid JSON: {exc}") from exc
            if not isinstance(body, dict):
                raise HTTPError(400, "JSON body must be an object")
            return body

        def _authorize(self) -> None:
            if not api_key or self.path == "/health":
                return
            header = self.headers.get("Authorization", "")
            token = header.removeprefix("Bearer ").strip()
            if not hmac.compare_digest(token.encode(), api_key.encode()):
                raise HTTPError(401, "Missing or invalid API key")

        def _dispatch(self, method: str) -> None:
            try:
                self._authorize()
                status, payload = self._route(method, self.path.split("?", 1)[0].rstrip("/") or "/")
                self._send(status, payload)
            except HTTPError as exc:
                self._send(exc.status, {"error": exc.message})
            except AgenticOSError as exc:
                self._send(404, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                system.metrics.incr("http.errors")
                self._send(500, {"error": f"{type(exc).__name__}: {exc}"})

        def do_GET(self) -> None:
            self._dispatch("GET")

        def do_POST(self) -> None:
            self._dispatch("POST")

        # ------------------------------------------------------------ routes
        def _route(self, method: str, path: str) -> tuple[int, Any]:
            if method == "GET":
                if path == "/health":
                    return 200, {"status": "ok"}
                if path == "/status":
                    return 200, system.status()
                if path == "/metrics":
                    return 200, system.metrics.snapshot()
                if path == "/agents":
                    return 200, {"agents": [
                        {"name": a.name, "tools": a.tools.names(), "conversational": a.memory is not None}
                        for a in system.agents.values()
                    ]}
                if path == "/processes":
                    return 200, {"processes": system.ps()}
                if m := re.fullmatch(r"/processes/(\w+)", path):
                    return 200, system.process(m.group(1)).to_dict()
                if m := re.fullmatch(r"/traces/(\w+)", path):
                    return 200, {"spans": system.tracer.trace(m.group(1))}
                raise HTTPError(404, f"No route for GET {path}")

            body = self._body()
            if path == "/run":
                task = _require(body, "task")
                agent = body.get("agent", "assistant")
                context = body.get("context")
                if body.get("async"):
                    return 202, system.submit(task, agent=agent, context=context).to_dict()
                proc = system.run(task, agent=agent, context=context)
                return (200 if proc.status == "completed" else 500), proc.to_dict()
            if path == "/agents":
                name = _require(body, "name")
                if not re.fullmatch(r"[a-zA-Z0-9_-]{1,40}", name):
                    raise HTTPError(400, "Agent name must match [a-zA-Z0-9_-]{1,40}")
                kwargs: dict[str, Any] = {
                    "tools": body.get("tools"),
                    "tool_tags": body.get("tool_tags"),
                    "conversational": bool(body.get("conversational", False)),
                }
                if body.get("instructions"):
                    kwargs["instructions"] = str(body["instructions"])
                agent = system.spawn(name, **kwargs)
                return 201, {"name": agent.name, "tools": agent.tools.names()}
            if m := re.fullmatch(r"/processes/(\w+)/feedback", path):
                reward = body.get("reward")
                if not isinstance(reward, (int, float)) or not -1 <= reward <= 1:
                    raise HTTPError(400, "'reward' must be a number in [-1, 1]")
                system.give_feedback(m.group(1), float(reward), str(body.get("comment", "")))
                return 200, {"ok": True}
            if path == "/knowledge":
                docs = body.get("documents") or ([body] if body.get("text") else [])
                if not docs:
                    raise HTTPError(400, "Provide 'text' or 'documents'")
                chunks = 0
                for d in docs:
                    if not isinstance(d, dict) or not isinstance(d.get("text"), str):
                        raise HTTPError(400, "Each document needs a 'text' string")
                    chunks += system.ingest(Document(d["text"], dict(d.get("metadata") or {})))
                return 201, {"documents": len(docs), "chunks": chunks}
            if path == "/goal":
                result = system.goal(_require(body, "goal"), agents=body.get("agents"))
                return 200, result.to_dict()
            raise HTTPError(404, f"No route for POST {path}")

    return Handler


def make_server(system: AgenticOS, host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(system))


def serve(system: AgenticOS, host: str = "127.0.0.1", port: int = 8000) -> None:  # pragma: no cover - blocking
    httpd = make_server(system, host, port)
    print(f"Agentic OS API listening on http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        system.shutdown(wait=False)
