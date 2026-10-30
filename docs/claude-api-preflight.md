# Claude API preflight checklist

Status: OFFLINE ONLY. No paid API requests authorized.

## Verified model

- Claude API model: `claude-sonnet-5-5`
- Official documentation:
  https://platform.claude.com/docs/en/models/sonnet-5-5/overview
- Published standard pricing: $2 per million input tokens and $10 per million output tokens.
- Recheck pricing before any paid request.

## Current configuration

- Intended request limit: 1
- Configured input-token limit: 4000
- Requested maximum output tokens: 1024
- Fixed prompt: Reply with exactly CONNECTION_OK.

## Remaining limitations

- The input-token limit is not yet enforced by token counting.
- The one-request helper protects only one Python instance.
- Workflow concurrency does not prevent later separate runs.
- A total spending limit is not enforced in code.
- The final API safety stop remains active.
- No HTTP request implementation is enabled.

## Approval requirements

- No paid API request without explicit approval.
- No automatic retries.
- No private audit content in API requests or public logs.
- No automatic code changes or merges.
- No unauthorized production deployments.
