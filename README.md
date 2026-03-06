# Cognition Demo — Devin + GitHub Issues Automation

This is a fork of [OpenClaw](https://github.com/openclaw/openclaw) used to showcase **Devin's ability to diagnose issues and create tickets automatically**. The repo serves as a real-world codebase for demonstrating an end-to-end GitHub Issues integration powered by AI agents.

## The Prompt

> **GitHub Issues Integration:** Build an automation that integrates Devin with GitHub Issues:
>
> - Some way to see a list of issues (could be dashboard or CLI tool)
> - Trigger a Devin session to scope the issue and assign a confidence score
> - Trigger a session to take the action plan and complete the ticket

## What We Built

A three-stage pipeline that goes from raw GitHub issue to completed pull request:

### 1. Issue Classification (Lightweight LLM)

A frontend dashboard where a lightweight LLM automatically classifies incoming tickets with:

- **Category** (bug, feature, refactor, etc.)
- **Complexity estimate** (low / medium / high)
- Basic metadata extraction from the issue body

### 2. Scoping & Confidence (Devin Session)

A Devin session is triggered per issue to:

- Analyze the codebase in the context of the issue
- Produce a detailed **action plan**
- Assign a **confidence score** indicating how likely the fix can be fully automated

### 3. Execution (Devin Session)

Developers can review the action plan and kick off a Devin agent to:

- Execute the plan
- Open a PR against the repo
- Link the PR back to the original issue

## Sessions (Snapshots)

We used Devin's **session snapshots** to demonstrate how an enterprise could spin up **multiple agents in parallel** — each working on a different issue simultaneously. This models a real-world scenario where a team triages a backlog and fans out automated work across many tickets at once.

## Architecture Overview

```
GitHub Issues
     |
     v
Frontend Dashboard (lightweight LLM classification)
     |
     v
Devin Session: Scope + Confidence Score + Action Plan
     |
     v
Developer Review
     |
     v
Devin Session: Execute Plan -> Open PR
```

## About the Base Repo

The underlying codebase is [OpenClaw](https://github.com/openclaw/openclaw), an open-source AI gateway and agent platform. We chose it as a non-trivial, real-world TypeScript project to make the demo realistic — the issues Devin works on are actual bugs and features against a production codebase.
