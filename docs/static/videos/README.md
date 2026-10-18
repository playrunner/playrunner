# Playrunner README videos

Recorded and edited on 19 October 2026 with OBS Studio. Both MP4s use H.264
video and AAC audio at 1920 × 1080, 30 fps. Voiceover is synthetic speech,
generated locally with Kokoro's `bf_emma` voice. WebVTT captions accompany each video.

- **Product overview (61 seconds):** a rendered README tour with product screenshots
  and examples. This is an overview, not footage of a newly executed test.
- **Workflow and evidence (51 seconds):** a fresh recording of the local Playrunner
  editor, its saved inline Playwright script, and the actual report and screenshot
  from a local Docker execution against `https://playrunner.dev`.
  The two checks verified the homepage title/message and the Cursor/Grok headings.
  The report shows **2 passed, 0 failed, 0 flaky, 0 skipped**, with 3.8 seconds of
  test execution time. This is focused smoke coverage, not a full regression suite.

The workflow video tours the completed run; it does not show uninterrupted
execution or an agent calling MCP. Navigation pauses are edited out, browser
chrome is cropped, and chapter labels are added below the footage. Test results
and screenshot evidence have not been recreated or altered. No sign-in entry is included.

During setup, the first attempt failed because `BASE_URL` had not been injected
into the Playwright node. After adding that binding, both failed tests were rerun
with unchanged assertions and passed. The successful local execution ID is
`705840f5-32d8-4a55-9e31-32d73dcbdb71`; the original failure report was preserved.
The initial OBS take had a stale capture frame and was discarded from this edit;
the final take shows the saved workflow and the same successful run's evidence.

## Transcripts

### Product overview

Your coding agent says the change is done. What happens next? Playrunner gives your team, your C I, and your agent a reusable way to run browser checks and inspect the evidence.

Connect your tests, environments, and follow up actions on a visual canvas. This example routes failed tests into analysis and issue tracking, and sends successful runs to the next step.

Working with an AI agent? Connect a compatible M C P client. Ask it to run a saved workflow, wait for the results, and return the report links. Keep checking as you keep building.

As the suite grows, automatic sharding distributes the work across runners. Bring the results back into one report, with failures still visible. Choose managed cloud compute, local Docker, or self hosted execution.

Start with one journey that matters to you. Try Playrunner Cloud, or run it locally. Build with AI. Ship with evidence.

### Workflow and evidence

Your code is ready. Now give it a check you can run again. This is a real Playrunner workflow, executed locally in Docker against the public Playrunner website.

An environment supplies the website address. The Playwright node runs two browser checks: the homepage message, and the Cursor and Grok connections. These are the same checks we just executed successfully.

Open the report to see exactly what ran. Each test has its own result, timing, and steps. You can inspect the assertions, rather than relying on a summary alone.

Screenshots captured by the tests show the page they checked. Save the workflow and repeat it after your next change. Build with AI. Ship with evidence.
