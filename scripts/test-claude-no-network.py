"""Check that the Claude API gate stays offline."""

import ast
from pathlib import Path

script = Path(__file__).with_name("claude-api-gated.py")
tree = ast.parse(
    script.read_text(encoding="utf-8"),
    filename=str(script),
)

allowed_imports = {
    "json",
    "os",
    "claude_request_budget",
}
actual_imports = set()

for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        actual_imports.update(
            alias.name for alias in node.names
        )
    elif isinstance(node, ast.ImportFrom):
        actual_imports.add(node.module or "")
    elif (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in {"eval", "exec", "__import__"}
    ):
        raise SystemExit(
            "FAIL: Dynamic code execution detected."
        )

if actual_imports != allowed_imports:
    raise SystemExit(
        "FAIL: Claude API gate imports changed."
    )

last = tree.body[-1]

if not (
    isinstance(last, ast.Raise)
    and isinstance(last.exc, ast.Call)
    and isinstance(last.exc.func, ast.Name)
    and last.exc.func.id == "SystemExit"
    and len(last.exc.args) == 1
    and isinstance(last.exc.args[0], ast.Constant)
    and last.exc.args[0].value
    == "Claude API test not implemented. No request made."
):
    raise SystemExit(
        "FAIL: Final Claude API safety stop changed."
    )

print("PASS: Claude API offline safeguards intact.")
