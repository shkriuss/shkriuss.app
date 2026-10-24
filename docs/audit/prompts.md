# Audit prompts

How to run the audit in [README.md](README.md) with several AI tools. Every
tool gets the same short prompt, with a different area each time. The prompt
points the tool to the brief, so the brief is the only thing to keep up to
date.

## The prompt

Copy this, and replace the area line with one area from the table below.

```text
You are auditing the public GitHub repository shkriuss/shkriuss.app (https://github.com/shkriuss/shkriuss.app), branch main.

Your area: A. Keys, encryption and the account

First read docs/audit/README.md in the repository completely. It is your brief: the rules, the threat model, the intentional choices, what to check in your area, and the report format. Then read CLAUDE.md, every file your area lists, and the ADRs it mentions.

Do not change any files, and do not open a pull request, issue or comment: the repository is public, and findings must not be published before they are fixed. If you can run commands, use them only in your own workspace, to prove findings.

Work carefully rather than quickly. Follow data from where it comes in (a person, a file, the network, another device) to where it is stored, shown or sent. Think like an attacker, and like a person using the app on a phone. Report only findings with concrete evidence, and label anything unconfirmed as a suspicion. Reply with the report in the brief's format, including what you checked and found fine, and what you did not check.
```

## Which tool checks what

Claude checks every area, including the live settings (area I). It then
checks every finding from every report. The other tools give independent
second opinions on the areas where a mistake would matter most. Do them in
this order; each row is one task.

| Order | Area                                | Codex | Jules | Gemini |
| ----- | ----------------------------------- | :---: | :---: | :----: |
| 1     | A. Keys, encryption and the account |   ✓   |   ✓   |        |
| 2     | B. Servers                          |   ✓   |   ✓   |        |
| 3     | H. CI, deploys and the supply chain |   ✓   |       |        |
| 4     | C. Browser security on every site   |   ✓   |       |        |
| 5     | E. Data safety                      |   ✓   |   ✓   |        |
| 6     | D. Privacy                          |       |       |   ✓    |
| 7     | F1. Time and reminders              |       |   ✓   |        |
| 8     | F2. Numbers and money               |       |   ✓   |        |
| 9     | F3. The rest                        |       |   ✓   |        |
| 10    | G. Accessibility                    |       |       |   ✓    |
| 11    | J. Architecture, tests and docs     |       |       |   ✓    |
| 12    | Z. Anything else                    |   ✓   |       |   ✓    |

Why these tools:

- **Codex** (OpenAI) and **Jules** (Google) copy the repository and can run
  its tests, so they can prove what they find.
- **Gemini** can't run anything. It reads a lot at once, which suits questions
  about the whole repository: whether the privacy page matches the code,
  whether the docs are still right.

If you don't have one of these tools, skip its column: Claude covers every
area anyway.

## Which model and effort

Use each tool's most capable model, at the highest effort it offers for a
single task. Skip modes that split the work between helpers (Codex's
**Ultra**): an audit needs one reader who sees the whole area. Model names
change every few months, so ask Claude for the current names and settings
before you start; it checks each tool's own docs.

## Starting each tool

**Claude**, in Claude Code (the Claude app or claude.ai/code):

1. Start a new session on `shkriuss/shkriuss.app`, so it reads the code
   fresh. Before the audit, send two messages on their own: `/model` and the
   model's name, then `/effort max`. On some plans the biggest model is paid
   from usage credits instead of the plan's own limits, so check before
   choosing it.
2. Send: "Audit this repository with the brief in docs/audit/README.md, every
   area including I. Don't change files or post anything on GitHub. When you
   have finished, I'll send you the other tools' reports: check every finding
   as the brief's 'What happens to reports' says."
3. Send the other tools' reports to this same session.

**Codex**, in ChatGPT:

1. The first time only: at chatgpt.com (in the phone's browser is fine),
   choose **Work in** › **Cloud**, then **Select environment** › **Create
   environment**. Connect GitHub, choose `shkriuss/shkriuss.app`, and tap
   **Get started**. Codex installs what the project needs and runs its
   checks; then tap **Publish**. If it asks for a setup script, use
   `corepack enable && pnpm install --frozen-lockfile`. Leave its internet
   access off.
2. For each task, choose that environment (in the ChatGPT app: open
   **Codex**), the model and the effort, then paste the prompt. If you see
   **Ask** and **Code**, choose **Ask**.
3. Codex works on its own copy, and nothing reaches GitHub unless you tap
   **Commit**, **Push** or **Create pull request**: never tap those.

**Jules**, at jules.google.com (in the phone's browser is fine):

1. Connect GitHub, and choose `shkriuss/shkriuss.app`.
2. Paste the prompt.
3. Jules shows a plan first. If the plan changes code, reply "No code
   changes: report only." Never tap "Publish branch" or "Create PR".

**Gemini** can read the repository two ways:

- **On a computer**, at gemini.google.com: start a new chat, tap **+**, then
  **Import code**, paste `https://github.com/shkriuss/shkriuss.app`, then
  paste the prompt. (Importing code doesn't work in the phone app yet.)
- **On a phone or tablet**: ask Claude for the area's file. Claude makes one
  text file per area from `main`, with every file the area needs. In the
  Gemini app, start a new chat, tap **+**, then **Files**, choose it, and
  paste the prompt with this line added at the end:

  ```text
  The repository's files for this area are in the attached file, each starting with a line "===== FILE: <path> =====". Read files there instead of on GitHub. If you need a file that isn't in it, say so under "Not checked".
  ```

Use a new chat for each area. Don't use Deep Think: it reads less at once,
too little for these files.

## Sending reports back

Copy the whole report into the Claude chat, and say which tool and area it's
from. For a long report, save it as a file and attach it. Don't use public
share links, and don't post reports on GitHub.

## Checking a disputed finding

When tools disagree about a serious finding, Claude may ask you to give it to
another tool with this prompt:

```text
Another reviewer reported the finding below about the public repository shkriuss/shkriuss.app (https://github.com/shkriuss/shkriuss.app, branch main). Its audit brief is docs/audit/README.md.

Try hard to prove the finding wrong. Start from a real entry point (a person's action, a file, a network request) and trace the code step by step. Reply with REAL or NOT REAL, the path you traced, and your evidence. If it's real, give the smallest correct fix. Do not change any files or post anything on GitHub.

<paste the finding here>
```
