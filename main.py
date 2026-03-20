import builtins
import io
import linecache
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import asdict, dataclass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


@dataclass
class TraceStep:
    index: int
    event: str
    lineno: int
    func_name: str
    source: str
    depth: int
    locals_snapshot: dict[str, str]


class TraceRequest(BaseModel):
    code: str


class TraceResponse(BaseModel):
    steps: list[dict]
    stdout: str
    stderr: str
    exception_text: str


def safe_repr(value, limit=120):
    try:
        text = repr(value)
    except Exception as exc:  # pragma: no cover
        text = f"<repr error: {exc}>"
    if len(text) > limit:
        return text[:limit] + "..."
    return text


class ExecutionTracer:
    def __init__(self, source_code: str):
        self.source_code = source_code
        self.steps: list[TraceStep] = []
        self.stdout = ""
        self.stderr = ""
        self.exception_text = ""
        self._previous_trace = None

    def _trace(self, frame, event, _arg):
        if event not in {"line", "call", "return"}:
            return self._trace

        if frame.f_code.co_filename != "<user_code>":
            return self._trace

        depth = 0
        parent = frame.f_back
        while parent:
            if parent.f_code.co_filename == "<user_code>":
                depth += 1
            parent = parent.f_back

        lineno = frame.f_lineno
        source = linecache.getline("<user_code>", lineno).rstrip("\n")

        locals_snapshot = {
            key: safe_repr(val)
            for key, val in frame.f_locals.items()
            if not key.startswith("__")
        }

        self.steps.append(
            TraceStep(
                index=len(self.steps),
                event=event,
                lineno=lineno,
                func_name=frame.f_code.co_name,
                source=source,
                depth=depth,
                locals_snapshot=locals_snapshot,
            )
        )
        return self._trace

    def run(self):
        self.steps = []
        self.stdout = ""
        self.stderr = ""
        self.exception_text = ""

        linecache.cache["<user_code>"] = (
            len(self.source_code),
            None,
            [line + "\n" for line in self.source_code.splitlines()],
            "<user_code>",
        )

        globals_dict = {
            "__name__": "__main__",
            "__builtins__": builtins.__dict__,
        }

        out = io.StringIO()
        err = io.StringIO()

        try:
            code_obj = compile(self.source_code, "<user_code>", "exec")
            self._previous_trace = sys.gettrace()
            sys.settrace(self._trace)
            with redirect_stdout(out), redirect_stderr(err):
                exec(code_obj, globals_dict, globals_dict)
        except Exception:
            self.exception_text = traceback.format_exc()
        finally:
            sys.settrace(self._previous_trace)
            self.stdout = out.getvalue()
            self.stderr = err.getvalue()


app = FastAPI(title="Python Under-the-Hood API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/trace", response_model=TraceResponse)
def trace_python(payload: TraceRequest):
    tracer = ExecutionTracer(payload.code)
    tracer.run()
    return TraceResponse(
        steps=[asdict(step) for step in tracer.steps],
        stdout=tracer.stdout,
        stderr=tracer.stderr,
        exception_text=tracer.exception_text,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
