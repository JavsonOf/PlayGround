"""The Agentic OS kernel.

Ties every roadmap layer into one runtime, like an operating system for
agents:

* **Agents** are the programs: spawned from a template and registered by name.
* **Processes**: every run gets a PID, a status and a result, and runs
  synchronously or on a worker pool.
* **Shared services**: a tool registry (system calls), long-term memory, a
  knowledge base (RAG), feedback, tracing and metrics.
"""

from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from collections.abc import Callable, Iterable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from agentic_os.agents.base import DEFAULT_INSTRUCTIONS, Agent
from agentic_os.agents.external import ExternalAgent, ExternalAgentConfig
from agentic_os.agents.goal import GoalAgent, GoalResult
from agentic_os.agents.multi import Crew
from agentic_os.config import Settings
from agentic_os.learning.feedback import FeedbackStore
from agentic_os.llm import LLMError, LLMProvider, create_llm
from agentic_os.memory.embeddings import cosine
from agentic_os.memory.long_term import LongTermMemory
from agentic_os.memory.short_term import ConversationBuffer
from agentic_os.observability import Metrics, Tracer
from agentic_os.prompts import PromptStrategy
from agentic_os.providers import ProviderRegistry
from agentic_os.rag.pipeline import Document, RAGPipeline
from agentic_os.tools.builtin import builtin_tools
from agentic_os.tools.registry import Tool, ToolRegistry, make_tool


class AgenticOSError(RuntimeError):
    pass


@dataclass
class Process:
    pid: str
    agent: str
    task: str
    status: str = "queued"  # queued | running | completed | failed
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    _future: Future | None = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pid": self.pid,
            "agent": self.agent,
            "task": self.task,
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class AgenticOS:
    """Create one instance per application; it owns all agents and services."""

    def __init__(self, settings: Settings | None = None, llm: LLMProvider | None = None, max_workers: int = 4) -> None:
        self.settings = settings or Settings()
        self.llm = llm or create_llm(self.settings)
        self.tracer = Tracer()
        self.metrics = Metrics()
        data_dir = self.settings.data_dir
        self.memory = LongTermMemory(path=os.path.join(data_dir, "memory.json") if data_dir else None)
        self.feedback = FeedbackStore(os.path.join(data_dir, "feedback.jsonl") if data_dir else None)
        self.knowledge = RAGPipeline()
        self.tools = ToolRegistry(builtin_tools())
        self.tools.register(self.knowledge.as_tool())
        for t in self.memory.as_tools():
            self.tools.register(t)
        self.providers = ProviderRegistry(self._path("providers.json"))
        self.agents: dict[str, Agent | ExternalAgent] = {}
        self.processes: dict[str, Process] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="agentic-os")
        self._specs: dict[str, dict[str, Any]] = {}
        self._sessions: dict[tuple[str, str], ConversationBuffer] = {}
        self._restoring = False
        self.prefs: dict[str, Any] = self._load_json("settings.json", {})
        if llm is None and self.prefs.get("default_provider"):
            try:
                self.llm = self.providers.build(self.prefs["default_provider"], self.prefs.get("default_model"))
            except LLMError:
                pass  # keep the environment-configured model if the stored one is unusable
        saved_specs = self._load_json("agents.json", [])  # read before spawning overwrites it
        self._restoring = True
        self.spawn("assistant")
        self._restore(saved_specs)

    # --------------------------------------------------------- persistence
    def _path(self, name: str) -> str | None:
        return os.path.join(self.settings.data_dir, name) if self.settings.data_dir else None

    def _load_json(self, name: str, default: Any) -> Any:
        path = self._path(name)
        if not path or not os.path.exists(path):
            return default
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def _save_json(self, name: str, data: Any) -> None:
        path = self._path(name)
        if not path:
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)  # may hold API keys
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def _restore(self, saved_specs: list[dict[str, Any]]) -> None:
        """Re-create saved agents and re-ingest saved knowledge after a restart."""
        self._restoring = True
        try:
            for spec in saved_specs:
                spec = dict(spec)
                try:
                    if spec.pop("type", "native") == "external":
                        self.register_external(ExternalAgentConfig(**spec))
                    else:
                        self.spawn(spec.pop("name"), **spec)
                except (LLMError, ValueError, TypeError):
                    continue  # skip a spec that no longer works rather than failing startup
            path = self._path("knowledge.jsonl")
            if path and os.path.exists(path):
                with open(path, encoding="utf-8") as fh:
                    for line in fh:
                        if line.strip():
                            item = json.loads(line)
                            self.knowledge.add_document(Document(item["text"], item.get("metadata", {}), id=item["id"]))
        finally:
            self._restoring = False

    def _save_specs(self) -> None:
        if not self._restoring:
            self._save_json("agents.json", list(self._specs.values()))

    # --------------------------------------------------------------- agents
    def spawn(
        self,
        name: str,
        instructions: str = DEFAULT_INSTRUCTIONS,
        *,
        tools: Iterable[str] | None = None,
        tool_tags: Iterable[str] | None = None,
        strategy: PromptStrategy | None = None,
        use_knowledge: bool = True,
        use_memory: bool = True,
        conversational: bool = False,
        max_steps: int | None = None,
        llm: LLMProvider | None = None,
        provider: str | None = None,
        model: str | None = None,
    ) -> Agent:
        """Create and register an agent.

        ``tools=None`` and ``tool_tags=None`` give the agent the shared
        registry (it sees tools registered later too); otherwise it gets a
        fixed subset. ``provider``/``model`` pick a configured provider (see
        :attr:`providers`); otherwise the OS default model is used.
        """
        if provider:
            llm = self.providers.build(provider, model)
        if tools is None and tool_tags is None:
            registry = self.tools
        else:
            registry = self.tools.subset(tools, tool_tags)
        agent = Agent(
            name,
            llm or self.llm,
            instructions=instructions,
            tools=registry,
            memory=ConversationBuffer() if conversational else None,
            long_term=self.memory if use_memory else None,
            knowledge=self.knowledge if use_knowledge else None,
            strategy=strategy,
            max_steps=max_steps or self.settings.max_steps,
            tracer=self.tracer,
            metrics=self.metrics,
        )
        agent.provider_id = provider
        agent.model_name = model or getattr(agent.llm, "model", None)
        self.agents[name] = agent
        if strategy is None:  # prompt strategies are code objects and are not persisted
            self._specs[name] = {
                "type": "native", "name": name, "instructions": instructions,
                "tools": list(tools) if tools is not None else None,
                "tool_tags": list(tool_tags) if tool_tags is not None else None,
                "use_knowledge": use_knowledge, "use_memory": use_memory, "conversational": conversational,
                "max_steps": max_steps, "provider": provider, "model": model,
            }
            self._save_specs()
        return agent

    def register_external(self, config: ExternalAgentConfig) -> ExternalAgent:
        """Plug in an agent that runs elsewhere (OpenAI-compatible, A2A or webhook)."""
        if not config.name or not all(c.isalnum() or c in "_-" for c in config.name):
            raise ValueError("Agent name must match [a-zA-Z0-9_-]")
        agent = ExternalAgent(config)
        self.agents[config.name] = agent
        self._specs[config.name] = {"type": "external", **config.__dict__}
        self._save_specs()
        return agent

    def set_default_model(self, provider: str, model: str | None = None) -> None:
        """Make a configured provider the OS default (used by agents without their own provider)."""
        llm = self.providers.build(provider, model)
        self.llm = llm
        for agent in self.agents.values():
            if isinstance(agent, Agent) and not getattr(agent, "provider_id", None):
                agent.llm = llm
                agent.model_name = getattr(llm, "model", None)
        self.prefs.update(default_provider=provider, default_model=model)
        self._save_json("settings.json", self.prefs)

    def describe(self, name: str) -> dict[str, Any]:
        agent = self.agent(name)
        if isinstance(agent, ExternalAgent):
            return {"name": name, "kind": "external", "protocol": agent.config.protocol, "url": agent.config.url,
                    "model": agent.config.model, "description": agent.instructions, "tools": []}
        return {
            "name": name, "kind": "native", "provider": getattr(agent, "provider_id", None) or "default",
            "model": getattr(agent, "model_name", None) or getattr(agent.llm, "model", None),
            "tools": agent.tools.names(), "conversational": agent.memory is not None,
            "description": agent.instructions[:300],
        }

    def agent(self, name: str) -> Agent:
        try:
            return self.agents[name]
        except KeyError:
            raise AgenticOSError(f"No agent named {name!r}. Running: {sorted(self.agents)}") from None

    def kill(self, name: str) -> None:
        if name == "assistant":
            raise AgenticOSError("The default 'assistant' agent cannot be removed")
        self.agents.pop(name, None)
        if self._specs.pop(name, None) is not None:
            self._save_specs()
        for key in [k for k in self._sessions if k[0] == name]:
            del self._sessions[key]

    # ---------------------------------------------------------------- tools
    def tool(self, func: Callable[..., Any] | None = None, **kwargs: Any):
        """Register a function as a system-wide tool (usable as a decorator)."""

        def wrap(f: Callable[..., Any]) -> Tool:
            return self.tools.register(f if isinstance(f, Tool) else make_tool(f, **kwargs))

        return wrap(func) if func is not None else wrap

    # ------------------------------------------------------------ knowledge
    def ingest(self, content: str | Document, **metadata: Any) -> int:
        """Add a document (text, ``Document`` or file path) to the knowledge base. Returns chunk count."""
        if isinstance(content, Document):
            doc = content
        elif len(content) < 4096 and "\n" not in content and os.path.isfile(content):
            with open(content, encoding="utf-8") as fh:
                doc = Document(fh.read(), {"source": os.path.basename(content), **metadata})
        else:
            doc = Document(content, metadata)
        chunks = len(self.knowledge.add_document(doc))
        path = self._path("knowledge.jsonl")
        if path:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"id": doc.id, "text": doc.text, "metadata": doc.metadata}) + "\n")
        return chunks

    # ------------------------------------------------------------ processes
    def _new_process(self, agent: str, task: str) -> Process:
        self.agent(agent)
        proc = Process(pid=uuid.uuid4().hex[:10], agent=agent, task=task)
        with self._lock:
            self.processes[proc.pid] = proc
        return proc

    def _execute(self, proc: Process, context: str | None, runner: Any = None) -> Process:
        proc.status, proc.started_at = "running", time.time()
        try:
            result = (runner or self.agents[proc.agent]).run(proc.task, context=context)
            proc.result = result.to_dict()
            proc.status = "completed"
            self.metrics.incr("os.processes.completed")
        except Exception as exc:  # noqa: BLE001 - recorded on the process
            proc.status, proc.error = "failed", f"{type(exc).__name__}: {exc}"
            self.metrics.incr("os.processes.failed")
        finally:
            proc.finished_at = time.time()
        return proc

    def run(self, task: str, agent: str = "assistant", context: str | None = None) -> Process:
        """Run a task to completion in the calling thread."""
        return self._execute(self._new_process(agent, task), context)

    def submit(self, task: str, agent: str = "assistant", context: str | None = None) -> Process:
        """Queue a task on the worker pool; poll :meth:`ps` or call :meth:`wait`."""
        proc = self._new_process(agent, task)
        proc._future = self._executor.submit(self._execute, proc, context)
        return proc

    def chat(self, message: str, agent: str = "assistant", session: str = "default", wait: bool = True) -> Process:
        """Multi-turn chat: each (agent, session) pair keeps its own conversation memory."""
        target = self.agent(agent)
        proc = self._new_process(agent, message)
        runner = target
        if isinstance(target, Agent):
            buffer = self._sessions.setdefault((agent, session), ConversationBuffer())
            runner = copy.copy(target)  # same tools/memory/knowledge, per-session conversation
            runner.memory = buffer
        if wait:
            return self._execute(proc, None, runner)
        proc._future = self._executor.submit(self._execute, proc, None, runner)
        return proc

    def reset_chat(self, agent: str = "assistant", session: str = "default") -> None:
        self._sessions.pop((agent, session), None)

    def wait(self, pid: str, timeout: float | None = None) -> Process:
        proc = self.process(pid)
        if proc._future is not None:
            proc._future.result(timeout=timeout)
        return proc

    def process(self, pid: str) -> Process:
        try:
            return self.processes[pid]
        except KeyError:
            raise AgenticOSError(f"No process {pid!r}") from None

    def ps(self) -> list[dict[str, Any]]:
        return [
            {k: v for k, v in p.to_dict().items() if k != "result"}
            for p in sorted(self.processes.values(), key=lambda p: p.created_at)
        ]

    def give_feedback(self, pid: str, reward: float, comment: str = "") -> None:
        """Record a reward in [-1, 1] for a finished process (human feedback)."""
        proc = self.process(pid)
        self.feedback.add(pid, reward, arm=proc.agent, comment=comment)
        if reward >= 0.5 and proc.result:
            self.memory.remember(
                f"A well-rated answer to '{proc.task[:200]}': {proc.result['output'][:400]}",
                kind="lesson",
                agent=proc.agent,
            )

    # ------------------------------------------------- higher-level runtimes
    def goal(self, goal: str, agents: Iterable[str] | None = None) -> GoalResult:
        names = list(agents) if agents else ["assistant"]
        return GoalAgent(self.llm, {n: self.agent(n) for n in names}).run(goal)

    def crew(self, agents: Iterable[str], process: str = "manager", router: Any = None) -> Crew:
        return Crew({n: self.agent(n) for n in agents}, self.llm, process=process, router=router)

    def submit_crew(self, task: str, agents: Iterable[str], process: str = "manager") -> Process:
        """Run a crew on the worker pool as a process (shows up in :meth:`ps`)."""
        crew = self.crew(agents, process=process)

        class _CrewRunner:
            def run(self, task: str, context: str | None = None):
                return crew.run(f"{context}\n\n{task}" if context else task)

        proc = Process(pid=uuid.uuid4().hex[:10], agent=f"crew:{process}", task=task)
        with self._lock:
            self.processes[proc.pid] = proc
        proc._future = self._executor.submit(self._execute, proc, None, _CrewRunner())
        return proc

    # ---------------------------------------------------------------- brain
    def graph(self, limit: int = 150, threshold: float = 0.3, per_node: int = 3) -> dict[str, Any]:
        """Knowledge graph of documents, chunks and memories linked by semantic similarity."""
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        vectors: list[tuple[str, list[float]]] = []
        docs: dict[str, str] = {}
        for rec in self.knowledge.vectors.all()[:limit]:
            doc_id = str(rec.metadata.get("doc_id", ""))
            if doc_id and doc_id not in docs:
                docs[doc_id] = str(rec.metadata.get("source") or rec.metadata.get("title") or f"dokument {doc_id[:6]}")
                nodes.append({"id": f"doc:{doc_id}", "label": docs[doc_id], "kind": "document", "text": ""})
            nodes.append({"id": rec.id, "label": rec.text[:40], "kind": "chunk", "text": rec.text[:500]})
            if doc_id:
                edges.append({"source": f"doc:{doc_id}", "target": rec.id, "weight": 1.0, "kind": "part"})
            vectors.append((rec.id, rec.vector))
        for rec in self.memory.store.all()[: max(0, limit - len(vectors))]:
            kind = rec.metadata.get("kind", "fact")
            nodes.append({"id": rec.id, "label": rec.text[:40], "kind": kind, "text": rec.text[:500]})
            vectors.append((rec.id, rec.vector))
        for i, (a_id, a_vec) in enumerate(vectors):
            scored = sorted(
                ((cosine(a_vec, b_vec), b_id) for j, (b_id, b_vec) in enumerate(vectors) if j > i),
                reverse=True,
            )
            for score, b_id in scored[:per_node]:
                if score >= threshold:
                    edges.append({"source": a_id, "target": b_id, "weight": round(score, 3), "kind": "similar"})
        return {"nodes": nodes, "edges": edges}

    # --------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for p in self.processes.values():
            counts[p.status] = counts.get(p.status, 0) + 1
        return {
            "provider": getattr(self.llm, "name", type(self.llm).__name__),
            "model": getattr(self.llm, "model", None),
            "agents": sorted(self.agents),
            "default_provider": self.prefs.get("default_provider") or "env",
            "tools": self.tools.names(),
            "knowledge_chunks": len(self.knowledge),
            "memories": len(self.memory),
            "processes": counts,
            "feedback": len(self.feedback),
        }

    def shutdown(self, wait: bool = True) -> None:
        self._executor.shutdown(wait=wait)

    def __enter__(self):
        return self

    def __exit__(self, *exc: object) -> None:
        self.shutdown()
