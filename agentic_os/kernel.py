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

import os
import threading
import time
import uuid
from collections.abc import Callable, Iterable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from agentic_os.agents.base import DEFAULT_INSTRUCTIONS, Agent
from agentic_os.agents.goal import GoalAgent, GoalResult
from agentic_os.agents.multi import Crew
from agentic_os.config import Settings
from agentic_os.learning.feedback import FeedbackStore
from agentic_os.llm import LLMProvider, create_llm
from agentic_os.memory.long_term import LongTermMemory
from agentic_os.memory.short_term import ConversationBuffer
from agentic_os.observability import Metrics, Tracer
from agentic_os.prompts import PromptStrategy
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
        self.agents: dict[str, Agent] = {}
        self.processes: dict[str, Process] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="agentic-os")
        self.spawn("assistant")

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
    ) -> Agent:
        """Create and register an agent.

        ``tools=None`` and ``tool_tags=None`` give the agent the shared
        registry (it sees tools registered later too); otherwise it gets a
        fixed subset.
        """
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
        self.agents[name] = agent
        return agent

    def agent(self, name: str) -> Agent:
        try:
            return self.agents[name]
        except KeyError:
            raise AgenticOSError(f"No agent named {name!r}. Running: {sorted(self.agents)}") from None

    def kill(self, name: str) -> None:
        if name == "assistant":
            raise AgenticOSError("The default 'assistant' agent cannot be removed")
        self.agents.pop(name, None)

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
            return len(self.knowledge.add_document(content))
        if len(content) < 4096 and "\n" not in content and os.path.isfile(content):
            return len(self.knowledge.add_file(content))
        return len(self.knowledge.add_document(Document(content, metadata)))

    # ------------------------------------------------------------ processes
    def _new_process(self, agent: str, task: str) -> Process:
        self.agent(agent)
        proc = Process(pid=uuid.uuid4().hex[:10], agent=agent, task=task)
        with self._lock:
            self.processes[proc.pid] = proc
        return proc

    def _execute(self, proc: Process, context: str | None) -> Process:
        proc.status, proc.started_at = "running", time.time()
        try:
            result = self.agents[proc.agent].run(proc.task, context=context)
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

    # --------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for p in self.processes.values():
            counts[p.status] = counts.get(p.status, 0) + 1
        return {
            "provider": getattr(self.llm, "name", type(self.llm).__name__),
            "model": getattr(self.llm, "model", None),
            "agents": sorted(self.agents),
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
