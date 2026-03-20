import { useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";

const API_BASE = "http://127.0.0.1:8000";

const EXAMPLE = `def factorial(n):
    if n == 1:
        return 1
    return n * factorial(n - 1)

value = 5
result = factorial(value)
print("factorial:", result)`;

function getEventLabel(event) {
  if (event === "call") {
    return "Enter";
  }
  if (event === "return") {
    return "Return";
  }
  return "Execute";
}

function getVariableChanges(previousStep, currentStep) {
  if (!currentStep) {
    return { added: [], changed: [], removed: [] };
  }

  const prev = previousStep?.locals_snapshot || {};
  const curr = currentStep.locals_snapshot || {};

  const added = [];
  const changed = [];
  const removed = [];

  Object.keys(curr).forEach((key) => {
    if (!(key in prev)) {
      added.push(key);
    } else if (prev[key] !== curr[key]) {
      changed.push(key);
    }
  });

  Object.keys(prev).forEach((key) => {
    if (!(key in curr)) {
      removed.push(key);
    }
  });

  return { added, changed, removed };
}

function explainStep(step, previousStep, stepNumber) {
  if (!step) {
    return "No step available yet.";
  }

  const changes = getVariableChanges(previousStep, step);
  const eventLabel = getEventLabel(step.event);
  const codeText = step.source || "blank line";
  const scopeText = step.func_name === "<module>" ? "main script" : `function ${step.func_name}()`;

  let actionText = "";
  if (step.event === "call") {
    actionText = `Python enters ${scopeText}.`;
  } else if (step.event === "return") {
    actionText = `Python returns from ${scopeText}.`;
  } else {
    actionText = `Python executes line ${step.lineno} in ${scopeText}.`;
  }

  const changeParts = [];
  if (changes.added.length) {
    changeParts.push(`new variable(s): ${changes.added.join(", ")}`);
  }
  if (changes.changed.length) {
    changeParts.push(`updated variable(s): ${changes.changed.join(", ")}`);
  }
  if (changes.removed.length) {
    changeParts.push(`removed variable(s): ${changes.removed.join(", ")}`);
  }

  const changesText =
    changeParts.length > 0
      ? ` Variable change: ${changeParts.join("; ")}.`
      : " Variable values stay the same at this step.";

  return `Step ${stepNumber} (${eventLabel}): ${actionText} Code: \"${codeText}\".${changesText}`;
}

function App() {
  const [code, setCode] = useState(EXAMPLE);
  const [steps, setSteps] = useState([]);
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [exceptionText, setExceptionText] = useState("");
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Paste Python code and click Run");

  const selected = useMemo(() => {
    if (!steps.length) {
      return null;
    }
    return steps[Math.max(0, Math.min(currentStep, steps.length - 1))];
  }, [steps, currentStep]);

  const editorExtensions = useMemo(
    () => [
      python(),
      indentUnit.of("    "),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          backgroundColor: "transparent",
          fontSize: "14px"
        },
        ".cm-content": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          padding: "10px 0"
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
          color: "#64748b"
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "rgba(11, 17, 26, 0.07)"
        },
        ".cm-selectionBackground, ::selection": {
          backgroundColor: "rgba(11, 17, 26, 0.18) !important"
        }
      })
    ],
    []
  );

  const explanations = useMemo(
    () => steps.map((step, index) => explainStep(step, steps[index - 1], index + 1)),
    [steps]
  );

  const currentExplanation = selected
    ? explainStep(selected, steps[Math.max(0, currentStep - 1)], currentStep + 1)
    : "Run the code to see a verbal explanation for each step.";

  const runTrace = async () => {
    if (!code.trim()) {
      setStatus("No code to run");
      setSteps([]);
      setCurrentStep(0);
      setStdout("");
      setStderr("");
      setExceptionText("");
      return;
    }

    setLoading(true);
    setStatus("Running...");

    try {
      const response = await fetch(`${API_BASE}/api/trace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = await response.json();
      setSteps(data.steps || []);
      setCurrentStep(0);
      setStdout(data.stdout || "");
      setStderr(data.stderr || "");
      setExceptionText(data.exception_text || "");

      if (data.exception_text) {
        setStatus("Execution finished with exception");
      } else {
        setStatus("Execution traced successfully");
      }
    } catch (error) {
      setStatus(`API error: ${error.message}`);
      setSteps([]);
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => setCurrentStep((value) => Math.min(value + 1, steps.length - 1));
  const prevStep = () => setCurrentStep((value) => Math.max(value - 1, 0));

  const codeLines = code.split("\n");

  return (
    <div className="page">
      <header className="header">
        <h1>Python Under-the-Hood</h1>
        <p>{status}</p>
      </header>

      <section className="controls">
        <button onClick={runTrace} disabled={loading}>{loading ? "Running..." : "Run"}</button>
        <button onClick={prevStep} disabled={!steps.length || currentStep === 0}>Previous</button>
        <button onClick={nextStep} disabled={!steps.length || currentStep >= steps.length - 1}>Next</button>
        <input
          type="range"
          min={0}
          max={Math.max(steps.length - 1, 0)}
          value={Math.min(currentStep, Math.max(steps.length - 1, 0))}
          onChange={(event) => setCurrentStep(Number(event.target.value))}
          disabled={!steps.length}
        />
        <span>{steps.length ? `Step ${currentStep + 1} / ${steps.length}` : "Step 0 / 0"}</span>
      </section>

      <main className="layout">
        <section className="panel">
          <h2>Code</h2>
          <div className="editorShell">
            <CodeMirror
              value={code}
              height="460px"
              extensions={editorExtensions}
              onChange={(value) => setCode(value)}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                autocompletion: true,
                bracketMatching: true,
                indentOnInput: true
              }}
            />
          </div>
        </section>

        <section className="panel">
          <h2>Current Line</h2>
          <div className="lineBox">
            {selected ? (
              <>
                <div><strong>Action:</strong> {getEventLabel(selected.event)}</div>
                <div><strong>Function:</strong> {selected.func_name}()</div>
                <div><strong>Line:</strong> {selected.lineno}</div>
                <div><strong>Code:</strong> {selected.source || "<blank line>"}</div>
              </>
            ) : (
              <div>No step selected</div>
            )}
          </div>

          <h2>Variables</h2>
          <pre className="preBlock">
{selected ? JSON.stringify(selected.locals_snapshot, null, 2) : "{}"}
          </pre>

          <h2>Timeline (Human-Friendly)</h2>
          <div className="timeline">
            {steps.length === 0 && <div className="timelineItem">No trace yet</div>}
            {steps.map((step, index) => (
              <button
                key={`${step.index}-${step.lineno}-${index}`}
                className={`timelineItem ${index === currentStep ? "active" : ""}`}
                onClick={() => setCurrentStep(index)}
              >
                <div className="timelineTitle">
                  Step {index + 1}: {getEventLabel(step.event)} {step.func_name === "<module>" ? "main script" : `${step.func_name}()`}
                </div>
                <div className="timelineDetail">Line {step.lineno}: {step.source || "<blank line>"}</div>
              </button>
            ))}
          </div>
        </section>
      </main>

      <section className="panel outputPanel">
        <h2>Output</h2>
        <pre className="preBlock"><strong>STDOUT</strong>{"\n"}{stdout || "<empty>"}</pre>
        <pre className="preBlock"><strong>STDERR</strong>{"\n"}{stderr || "<empty>"}</pre>
        {exceptionText && <pre className="preBlock"><strong>EXCEPTION</strong>{"\n"}{exceptionText}</pre>}
      </section>

      <section className="panel">
        <h2>Verbal Explanation</h2>
        <div className="lineBox">{currentExplanation}</div>
        <h2>Step-by-Step Explanation</h2>
        <ol className="explainList">
          {explanations.length === 0 && <li>No steps yet</li>}
          {explanations.map((text, index) => (
            <li key={`explain-${index}`} className={index === currentStep ? "active" : ""}>{text}</li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <h2>Code Preview</h2>
        <div className="codePreview">
          {codeLines.map((line, idx) => {
            const lineNumber = idx + 1;
            const active = selected && selected.lineno === lineNumber;
            return (
              <div key={`${lineNumber}-${line}`} className={`codeLine ${active ? "active" : ""}`}>
                <span className="lineNo">{lineNumber}</span>
                <span className="lineText">{line || " "}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default App;
