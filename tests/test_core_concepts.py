"""War Room access to the core concepts: thinking modes, delegation and tool approval."""

import json
import threading
import time
import urllib.request

import pytest

from agentic_os import AgenticOS, Settings
from agentic_os.llm import LLMResponse, ScriptedLLM
from agentic_os.llm.base import ToolCall
from agentic_os.server import make_server


def call(name, **arguments):
    return LLMResponse(text="", tool_calls=[ToolCall(id=f"c-{name}", name=name, arguments=arguments)], stop_reason="tool_use")


def make_os(tmp_path, script):
    return AgenticOS(Settings(provider="mock", data_dir=str(tmp_path)), llm=ScriptedLLM(script))


def test_reflective_agent_retries_and_keeps_best_attempt(tmp_path):
    system = make_os(tmp_path, [
        "Paris is in Germany.",                               # attempt 1
        '{"score": 2, "reason": "wrong country"}',            # judge
        "- Check the country.",                               # critique
        "Paris is the capital of France.",                    # attempt 2
        '{"score": 9, "reason": "correct"}',                  # judge
    ])
    system.spawn("critic", mode="reflective", conversational=True)
    proc = system.chat("Where is Paris?", agent="critic")
    assert proc.status == "completed", proc.error
    assert proc.result["output"] == "Paris is the capital of France."
    assert proc.result["reflection"]["best_score"] == 0.9
    assert len(proc.result["reflection"]["attempts"]) == 2
    assert any(r.metadata.get("kind") == "lesson" for r in system.memory.store.all())
    buffer = next(iter(system._sessions.values()))
    assert len([m for m in buffer.messages() if m.role == "user"]) == 1  # only the best attempt is kept


def test_adaptive_agent_learns_from_feedback_and_persists(tmp_path):
    system = make_os(tmp_path, ["one", "two"])
    system.spawn("learner", mode="adaptive")
    proc = system.run("Say something", agent="learner")
    assert proc.strategy in system.strategies and proc.result["strategy"] == proc.strategy
    system.give_feedback(proc.pid, 1.0)
    system.give_feedback(proc.pid, -1.0)  # changing the rating replaces it instead of counting twice
    stats = system._bandits["learner"].stats[proc.strategy]
    assert (stats.pulls, stats.total_reward) == (1, -1.0)
    learning = system.describe("learner")["learning"]
    assert learning["strategies"][proc.strategy]["pulls"] == 1

    reloaded = make_os(tmp_path, [])
    assert reloaded.describe("learner")["mode"] == "adaptive"
    assert reloaded._bandits["learner"].stats[proc.strategy].pulls == 1


def test_agent_delegates_to_another_agent(tmp_path):
    system = make_os(tmp_path, [
        call("ask_researcher", task="Find the answer"),       # boss delegates
        "42",                                                 # researcher answers
        "The researcher says 42.",                            # boss answers
    ])
    system.spawn("researcher", tools=[])
    system.spawn("boss", delegates=["researcher", "boss"])
    assert "ask_researcher" in system.agent("boss").tools
    assert "ask_boss" not in system.agent("boss").tools  # an agent cannot delegate to itself
    proc = system.run("What is the answer?", agent="boss")
    assert proc.result["output"] == "The researcher says 42."
    assert proc.result["tool_calls"][0]["result"] == "42"


def test_delegation_depth_is_limited(tmp_path):
    system = make_os(tmp_path, [call("ask_b", task="x"), call("ask_a", task="x"), call("ask_b", task="x"),
                                call("ask_a", task="x"), "b3", "a2", "b1", "a0"])
    system.spawn("a", delegates=["b"])
    system.spawn("b", delegates=["a"])
    proc = system.run("loop", agent="a")
    assert proc.status == "completed"
    assert proc.result["output"] == "a0"
    blocked = system.llm.calls[4]["messages"][-1]  # b at depth 3 is told to stop delegating
    assert "Delegation limit reached" in blocked.content


def _approval_os(tmp_path):
    system = make_os(tmp_path, [call("calculator", expression="2+2"), "The result is 4."])
    system.spawn("careful", approval=True)
    return system


def _wait_for_approval(system):
    for _ in range(200):
        if system.pending_approvals():
            return system.pending_approvals()[0]
        time.sleep(0.01)
    raise AssertionError("no approval request appeared")


@pytest.mark.parametrize("approve", [True, False])
def test_tool_calls_wait_for_operator(tmp_path, approve):
    system = _approval_os(tmp_path)
    proc = system.submit("What is 2+2?", agent="careful")
    pending = _wait_for_approval(system)
    assert pending["tool"] == "calculator" and pending["pid"] == proc.pid
    assert system.process(proc.pid).status == "waiting"
    system.decide_approval(pending["id"], approve)
    system.wait(proc.pid, timeout=5)
    result = system.process(proc.pid).result["tool_calls"][0]
    assert result["is_error"] is (not approve)
    assert ("4" in result["result"]) is approve
    assert system.pending_approvals() == []


def test_http_api_for_modes_and_approvals(tmp_path):
    system = _approval_os(tmp_path)
    server = make_server(system, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def req(method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(base + path, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    try:
        status, agent = req("POST", "/agents", {"name": "smart", "mode": "reflective", "approval": True, "delegates": ["careful"]})
        assert status == 201 and agent["mode"] == "reflective" and agent["approval"] and agent["delegates"] == ["careful"]
        assert req("POST", "/agents", {"name": "bad", "mode": "psychic"})[0] == 400
        status, proc = req("POST", "/chat", {"message": "2+2?", "agent": "careful"})
        pending = _wait_for_approval(system)
        assert req("GET", "/approvals")[1]["approvals"][0]["id"] == pending["id"]
        assert req("POST", f"/approvals/{pending['id']}", {"approve": "yes"})[0] == 400
        assert req("POST", f"/approvals/{pending['id']}", {"approve": True})[0] == 200
        system.wait(proc["pid"], timeout=5)
        assert req("POST", "/approvals/nope", {"approve": True})[0] == 404
    finally:
        server.shutdown()
        system.shutdown()
