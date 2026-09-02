---
sidebar_position: 7
sidebar_label: Automatic sharding
title: Choose a Playwright shard count automatically
description: Stop hand-tuning shard counts and CI matrices. Auto sharding sizes the plan against your runner capacity and merges every shard into one report.
keywords:
  [
    'how many shards playwright',
    'playwright shard count',
    'optimal playwright shard count',
    'dynamic playwright sharding',
    'playwright sharding without matrix',
    'playwright test distribution',
  ]
---

# Choose a Playwright shard count automatically

Splitting a Playwright suite across machines is a solved problem. Playwright
ships `--shard` and `merge-reports`, and the
[sharding documentation](https://playwright.dev/docs/test-sharding) explains
both well.

What stays unsolved is the number. `--shard=1/4` means someone decided on four,
and that decision is usually made once, by hand, and then quietly outlives the
suite it was sized for. Add 300 tests and four shards is too few. Delete a
slow project and you are paying for runners that finish in twelve seconds.

Auto sharding makes the shard count an output of the suite rather than an
input from a config file.

## When this is worth it

Be honest about the threshold. If you need four fixed shards in GitHub Actions
and the suite is stable, a matrix plus `merge-reports` does the job, and this
page will not improve your life much.

It becomes worth it when:

- The suite grows or changes shape often enough that a fixed count drifts.
- You run the same suite in more than one place, and each place has different
  capacity.
- Shard count, runner size, artefact collection, and the merge job are
  duplicated across several repositories' pipeline files.

## What you need

- Playrunner running — see [Get started](/docs/start/).
- A repository with Playwright tests
  [connected through GitHub](/docs/tutorials/connect-github/).
- The TypeScript Playwright Test runtime. Sharding and blob-report merging
  currently require it.

## Build the workflow

```text
Environment ──sequential──▶ Playwright
```

That is the whole graph. Sharding is a setting on the Playwright node, not a
row of parallel nodes you wire up yourself — the fan-out happens beneath the
node at run time.

Open the node and set **Suite sharding** to one of three modes:

- **Off** runs the suite once, with no shard argument.
- **Manual** requests a specific shard count. Playrunner never creates more
  shards than the suite has shardable units, and rejects a request that exceeds
  the runner backend's capacity.
- **Auto** discovers the suite first, then treats your configured shard, CPU,
  memory, and worker values as _maximums_.

The rest of this page is about Auto.

## How the count gets chosen

### 1. Discovery

Auto starts a discovery runner and collects the suite without executing it:

```bash
playwright test --list --reporter=json
```

That records the test count, file count, project count, Playwright parallel
mode, and source revision.

### 2. Shardable units

How those tests can be divided depends on your own Playwright config:

- With `fullyParallel: true`, each **test** is a shardable unit.
- Otherwise, each **file and project combination** is a unit. Tests in the same
  file and project stay together.

This is the part most manual shard counts get wrong. A suite that is not fully
parallel cannot be split more finely than its files, so asking for 32 shards on
20 files buys you 20 shards and 12 idle runners.

### 3. The useful count

Auto allows roughly four shardable units per configured worker on a shard:

```text
ceil(shardable units / (maximum workers per shard * 4))
```

The actual shard count is then the smallest of three numbers:

1. **Maximum shards** configured on the node.
2. The useful count from discovery.
3. The capacity the runner backend can currently supply.

So 12 fully parallel tests with one worker per shard produce three useful
shards. Setting **Maximum shards** to eight still launches three:

```text
ceil(12 / (1 * 4)) = 3 useful shards
min(8 configured, 3 useful, available capacity) = 3 shards
```

Capacity covers concurrent-runner, shard-count, aggregate CPU, aggregate
memory, and aggregate worker limits. Local execution defaults to no more than
four concurrent shards, bounded further by the CPU and memory visible to the
local Orchestrator.

### 4. History, once there is any

When comparable previous runs exist, Playrunner reuses the previously allocated
memory rather than jumping back to the first-run maximum, and estimates
duration by scaling the median previous duration for suite size and effective
parallelism. Set **Target duration in minutes** and it selects the smallest CPU
shape estimated to meet that target.

## Reading the plan

Expand the runtime plan in the workflow editor. It shows the selected shard
count, workers and resources per shard, aggregate resources, discovery totals,
history sample count, estimated duration where available, and — most usefully
when the number surprises you — **which of the three constraints limited the
plan**: your configured maximum, the suite size, or runner capacity.

If you asked for eight and got three, that field tells you whether to raise the
maximum, restructure the suite, or add capacity.

## Execution and merging

Every shard runner launches concurrently with Playwright's native argument and
produces a blob report:

```bash
playwright test --shard=1/3 --reporter=blob
playwright test --shard=2/3 --reporter=blob
playwright test --shard=3/3 --reporter=blob
```

Playrunner records a checksum, size, Playwright version, source revision, and
shard index for every blob. Before aggregating it verifies that all shard
indexes are present, none is duplicated, every report came from the same
Playwright version, and each downloaded blob matches its recorded size and
checksum. A merged report built from a half-uploaded blob is worse than no
report, because it looks complete.

A final aggregation runner then merges the verified blobs:

```bash
playwright merge-reports --reporter=html,json
```

The merged output is what the rest of the workflow sees — one report, one
result, whatever the shard count was.

### When a shard fails

The Playwright node's outcome is an error, as it should be. But if every shard
still produced a valid blob, the merge runs anyway, so the combined failure
detail survives for diagnosis. Discovery, each numbered shard, and the merge
stay visible beneath the node on the canvas.

## What the pipeline keeps

One responsibility: start the workflow, react to the result. No shard matrix,
no runner provisioning step, no artefact-shuttling job, no separate merge job
to keep in sync with the shard count above it.

## Related

- [Playwright integration reference](/docs/integration-packages/playwright/#suite-sharding)
  — every sharding setting on the node.
- [Run Playwright tests on a schedule](/docs/use-cases/scheduled-playwright-test-runs/)
  — nightly regressions are usually the suite worth sharding.
- [Slack alerts for failed Playwright tests](/docs/use-cases/slack-alerts-for-failed-playwright-tests/)
  — route the merged result somewhere useful.
