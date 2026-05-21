---
sidebar_position: 4
title: Connection Nodes
---

## Connection State Rules

This document defines how workflow connections control execution order in workflows.

Workflows use a graph-driven execution model. Connections between nodes determine when child nodes are triggered, whether they run in parallel, and whether they depend on the parent node succeeding or failing.

---

## Core Principle

Each connection has a state.

The connection state defines:

- when the child node is eligible to run
- whether the parent node must finish first
- whether the parent node must succeed or fail
- whether the child node runs regardless of outcome

Each node must run at most once per workflow execution.

---

## Connection Types

### Concurrent

**When it runs:**  
The child node runs immediately when the parent node starts.

**Execution behaviour:**  
The parent and child run in parallel.

**Use when:**  
The child task can run alongside the parent and does not need to wait for the parent to complete.

**Example:**  
Start monitoring while the main process is running.

```text
A --concurrent--> B
```

Result:

- A starts.
- B starts immediately after A starts.
- A and B run in parallel.

---

### Sequential

**When it runs:**  
The child node runs after the parent node completes.

**Execution behaviour:**  

If the parent has no conditional connections, the sequential child runs after the parent finishes.

If the parent has any conditional connections, such as `success` or `failure`, the sequential child only runs if the parent completed successfully.

**Use when:**  
The child node represents the normal next step in the workflow.

**Example:**  
Run tests after a build completes.

```text
A --sequential--> B
```

Result:

- A runs first.
- B runs after A completes.

---

### On Success

**When it runs:**  
The child node runs only if the parent node completes successfully.

**Execution behaviour:**  
The child is skipped if the parent fails.

**Use when:**  
The next action must only happen after a successful parent result.

**Example:**  
Deploy to production only if tests pass.

```text
A --success--> B
```

Result:

- If A succeeds, B runs.
- If A fails, B does not run.

---

### On Failure

**When it runs:**  
The child node runs only if the parent node fails.

**Execution behaviour:**  
The child is skipped if the parent succeeds.

**Use when:**  
The child is used for error handling, notifications, rollback, or cleanup after failure.

**Example:**  
Send an alert if deployment fails.

```text
A --failure--> B
```

Result:

- If A fails, B runs.
- If A succeeds, B does not run.

---

### Independent

**When it runs:**  
The child node runs after the parent finishes, regardless of whether the parent succeeds or fails.

**Execution behaviour:**  
The child waits for the parent to finish, but does not depend on the parent outcome.

**Use when:**  
The child task must always happen after the parent completes.

**Example:**  
Archive logs whether the process succeeded or failed.

```text
A --independent--> B
```

Result:

- A runs first.
- B runs after A finishes.
- B runs whether A succeeds or fails.

---

## Important Rules

### 1. Sequential Suppression

If a parent node has any `success` or `failure` connections, plain sequential connections must not be treated as unconditional next steps.

In this case, sequential children should only run when the parent succeeds.

This prevents accidental execution of normal-path steps after a failed parent when explicit conditional branching exists.

```text
A --sequential--> B
A --failure--> C
```

Result:

- If A succeeds, B runs.
- If A fails, C runs.
- B does not run after failure.

---

### 2. Multiple Connections

A parent node may have multiple outgoing connections of different types.

Each connection is evaluated independently according to its own state.

```text
A --concurrent--> D
A --success--> B
A --failure--> C
A --independent--> E
```

Result:

- D starts when A starts.
- After A finishes:
  - B runs if A succeeds.
  - C runs if A fails.
  - E always runs.

---

### 3. Single Execution

Each node may run at most once in a workflow execution.

If multiple connections target the same node, the first valid trigger may start the node, but later triggers must not start it again.

```text
A --success--> C
B --success--> C
```

Result:

- C can only run once.
- If both A and B attempt to trigger C, duplicate execution must be prevented.

---

### 4. Implicit Connections

If a node has a `parentId`, and there is no explicit connection from that parent to the child, the workflow engine should treat it as an implicit sequential connection.

```text
B.parentId = A
```

Equivalent to:

```text
A --sequential--> B
```

This keeps simple parent-child workflows easy to define without requiring explicit connection objects for every basic sequence.

---

## Workflow Examples

### Simple Linear Flow

```text
A --sequential--> B
```

Execution:

1. A runs.
2. B runs after A completes.

---

### Conditional Branching

```text
A --success--> B
A --failure--> C
```

Execution:

1. A runs.
2. If A succeeds, B runs.
3. If A fails, C runs.
4. Only one branch runs.

---

### Parallel Processing

```text
A --concurrent--> D
A --independent--> E
```

Execution:

1. A starts.
2. D starts immediately and runs in parallel with A.
3. E runs after A finishes.
4. E runs regardless of whether A succeeds or fails.

---

### Complex Mixed Flow

```text
A --concurrent--> D
A --success--> B
A --failure--> C
A --independent--> E
```

Execution:

1. A starts.
2. D starts immediately and runs in parallel with A.
3. After A finishes:
   - B runs if A succeeds.
   - C runs if A fails.
   - E always runs.

---

## Agent Implementation Guidance

When implementing or modifying workflow execution logic, agents must follow these rules:

1. Evaluate connection state before triggering a child node.
2. Start `concurrent` children when the parent starts.
3. Evaluate `sequential`, `success`, `failure`, and `independent` children only after the parent finishes.
4. Prevent duplicate execution of any node.
5. Respect explicit connections before creating implicit `parentId` sequential connections.
6. Apply sequential suppression when conditional connections exist.
7. Treat `independent` as outcome-agnostic, not concurrent.
8. Keep the execution model deterministic and easy to reason about.

---

## Recommended Defaults

Use `sequential` by default.

Only use more advanced connection types when the workflow requires them:

- Use `concurrent` for monitoring, logging, or parallel tasks.
- Use `success` for normal conditional success paths.
- Use `failure` for error handling, rollback, or alerts.
- Use `independent` for cleanup or finalisation steps that must always run.

---

## Best Practices

- Keep workflows simple where possible.
- Start with sequential connections.
- Add branching only when the workflow genuinely needs success or failure handling.
- Use independent connections for cleanup, logging, and archiving.
- Avoid unnecessary mixed connection types unless the execution behaviour is clear.
- Make conditional branches explicit.
- Ensure workflow diagrams match the actual execution semantics.

---

## Summary Table

| Connection Type | Trigger Time | Requires Success | Requires Failure | Runs in Parallel | Runs After Parent |
| --- | --- | --- | --- | --- | --- |
| `concurrent` | Parent starts | No | No | Yes | No |
| `sequential` | Parent finishes | Usually yes when conditional connections exist | No | No | Yes |
| `success` | Parent finishes | Yes | No | No | Yes |
| `failure` | Parent finishes | No | Yes | No | Yes |
| `independent` | Parent finishes | No | No | No | Yes |

---

## Key Rule

A node should only run when a connection explicitly or implicitly allows it to run, and it must never run more than once in the same workflow execution.
