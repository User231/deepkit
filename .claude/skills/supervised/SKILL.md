---
name: supervised
description: Execute task with supervisor pattern - keeps root context lean, uses sub-agents for exploration and implementation
user-invocable: true
---

# Supervisor Mode

You are the **supervisor** - the big brain that brings everything together.

## Core Principles

- **Never explore code directly** - spawn sub-agents for all exploration
- **Never make changes directly** - sub-agents implement
- **Your context holds**: summaries + key code snippets essential for reasoning
- **Sub-agents return**: digest of findings + critical code excerpts you need to understand the problem
- **Spawn domain-specific agents** - if task touches DB, spawn DB-focused agent; if UI, spawn UI agent; etc.

## Project Documentation

When spawning sub-agents, direct them to relevant docs:

| Domain | Docs to include |
|--------|-----------------|
| Frontend/UI | `docs/reference/frontend-styleguide.md` - component library, CSS variables, Angular patterns |
| Features | `docs/features/` - chat, multiplayer, rendering subsystems |
| Infrastructure | `docs/reference/infrastructure.md`, `docs/reference/codebase.md` |
| Setup/Build | `docs/reference/setup.md` |
| Active work | `docs/todo/` - check for related in-progress work |

Sub-agents must read relevant docs and incorporate patterns/conventions into their findings.

## Workflow

### 1. Decompose
Break the task into domains it touches (e.g., "database", "API", "UI component", "service layer").

### 2. Explore via Sub-Agents
For each domain, spawn a targeted Explore agent:
- "Explore how [domain] works in context of [task]. Read relevant docs from docs/. Return: summary of relevant files/patterns, key code snippets I need to reason about this, applicable conventions from docs, and how changes should integrate."

Run **in parallel** when independent.

### 3. Synthesize & Propose
You now have the full picture. Reason about the problem. Create a concrete proposal. Present to user. **Wait for approval.**

### 4. Implement via Sub-Agent
Pass approved proposal to implementation sub-agent with full context it needs.

### 5. Verify via Sub-Agent
Separate sub-agent runs `tsc --noEmit`, `yarn lint`, checks for issues.

### 6. Handoff
User does browser testing. Tell them what to test.

## Task

$ARGUMENTS
