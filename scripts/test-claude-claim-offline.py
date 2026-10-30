"""Test the one-time Claude claim with a fake GitHub CLI, never GitHub."""

import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

claim_script = Path(__file__).with_name("claude-api-one-time-claim.sh")
sha = "a" * 40

with TemporaryDirectory() as folder:
    temp = Path(folder)
    calls = temp / "calls.txt"
    fake_tag = temp / "fake-tag"
    fake_gh = temp / "gh"
    fake_gh.write_text(
        '#!/bin/sh\n'
        'printf "%s\\n" "$*" >> "$FAKE_GH_CALLS"\n'
        '[ ! -e "$FAKE_GH_TAG" ] || exit 1\n'
        ': > "$FAKE_GH_TAG"\n',
        encoding="utf-8",
    )
    fake_gh.chmod(0o700)

    env = {
        "PATH": f"{temp}:{os.environ['PATH']}",
        "GH_TOKEN": "offline-fake-token",
        "CLAUDE_CONNECTIVITY_APPROVED": "true",
        "GITHUB_REPOSITORY": "shkriuss/shkriuss.app",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_RUN_ATTEMPT": "1",
        "GITHUB_SHA": sha,
        "FAKE_GH_CALLS": str(calls),
        "FAKE_GH_TAG": str(fake_tag),
    }

    def attempt(**overrides):
        return subprocess.run(
            ["bash", str(claim_script)],
            env={**env, **overrides},
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )

    for invalid in (
        {"CLAUDE_CONNECTIVITY_APPROVED": "false"},
        {"GITHUB_REPOSITORY": "other/repo"},
        {"GITHUB_REF": "refs/heads/feature"},
        {"GITHUB_RUN_ATTEMPT": "2"},
        {"GITHUB_SHA": "invalid"},
        {"GH_TOKEN": ""},
    ):
        result = attempt(**invalid)
        assert result.returncode != 0, f"Unsafe run succeeded: {invalid}"
        assert not calls.exists(), "Unsafe run invoked GitHub CLI"

    first = attempt()
    assert first.returncode == 0, first.stderr
    assert fake_tag.exists(), "First claim did not persist marker"

    expected = (
        "api -X POST repos/shkriuss/shkriuss.app/git/refs "
        "-f ref=refs/tags/claude-api-connectivity-once "
        f"-f sha={sha}"
    )
    assert calls.read_text(encoding="utf-8").splitlines() == [expected]

    second = attempt()
    assert second.returncode != 0, "Repeated claim was allowed"
    assert "claim refused" in second.stderr
    assert len(calls.read_text(encoding="utf-8").splitlines()) == 2

print("PASS: One-time Claude claim simulated offline. No GitHub tag created.")
