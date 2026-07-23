# DJ Harness Rewrite Postmortem

**Date:** 2026-07-23
**Outcome:** Reverted
**Branch restored:** `next` at `0c02eb5`

## Summary

The rewrite made automatic track switching mechanically possible, but it did not produce the DJ product we were trying to build.

The design moved musical control away from the LLM and into a deterministic planning pipeline. The model became a bounded selector over choices prepared by application code. That improved predictability, but predictability was not the primary goal. The intended product is an LLM performance: a non-deterministic DJ whose judgment, use of analysis, tool choices, and response to chat create the experience.

The implementation therefore optimized the wrong system. A successful switch proved transport and scheduling, not DJ performance.

## Intended Product

The requested direction had three linked requirements:

1. A DJ-capable MCP server that can be attached to different agent harnesses.
2. An LLM that remains the performer, not a labeler or tie-breaker inside a deterministic recommender.
3. A better harness that helps the model use track and segment analysis effectively while preserving non-deterministic musical judgment.

The rewrite did not satisfy the first requirement and weakened the second. It embedded orchestration in this application and reduced the model's authority to choosing from pre-ranked safe cards.

## What We Built

The reverted design introduced:

- a client-side DJ session controller;
- a dedicated `/api/dj/plan` endpoint;
- deterministic candidate discovery, filtering, and transition ranking;
- batch analysis loading;
- a bounded model call that selected among offered candidates;
- deterministic fallback when the model failed or timed out;
- automatic preload and transition-slot management;
- chat reduced to compiling persistent intent patches.

This architecture treated model failure as a loss of taste while deterministic code guaranteed continuity. That is a reasonable architecture for reliable background radio. It is not the intended architecture for an LLM DJ performance.

## What Happened Live

Initial implementation did not switch tracks.

Two concrete defects blocked the planning path:

- Playback and anonymous authentication raced. Planning could begin before authentication, receive `401`, consume its immediate retries, and stop.
- Planner output crossed the wire with values rejected by the client schema: an empty `artist` string and `genre: null`.

After those defects were fixed, a live run changed active tracks:

`2260180544` → `2156175450` → `2180991983`

That result was presented too confidently. It demonstrated that the machinery could fetch, preload, and switch. It did not demonstrate a good transition, coherent set development, useful chat interaction, or meaningful LLM authorship.

The same run also showed repeated planning calls when analysis produced no safe window. This exposed another mismatch: the system was chasing its own deterministic validity conditions instead of letting a DJ reason about an imperfect musical situation.

## Primary Failure

We substituted reliability architecture for performance architecture.

The central design decision was:

> deterministic code owns discovery, ranking, timing, and recovery; the model chooses among safe options.

That decision removed the behavior the product is meant to explore. Model variability was treated as a fault to contain rather than the source of the performance.

Track analysis became input to a scorer, not a medium through which the model could listen, compare, plan, and improvise. Chat became intent configuration, not interaction with the performing DJ. The MCP boundary was bypassed rather than strengthened into a portable capability layer.

## Why The Process Failed

### Wrong success criteria

Tests concentrated on schemas, ranking functions, stale-response rejection, timing guards, and fallback behavior. Those tests answered “can the pipeline produce and execute a valid slot?” They did not answer:

- Did the model understand the outgoing musical phrase?
- Did analysis materially affect its choice and explanation?
- Did the transition sound intentional?
- Did the set develop over multiple tracks?
- Did chat alter the performance naturally?
- Could the same DJ tools work from another harness?

### Architecture chosen before product contract was restated

The plan inferred that continuity must dominate model agency. That assumption should have been challenged before implementation. It determined nearly every later component.

### Mechanical proof mistaken for product proof

Once track IDs changed in logs and the visible card updated, the implementation was called successful. This was evidence of switching only. User had asked for DJ performance.

### Track analysis was over-processed

Rich analysis was collapsed into scores and “safe window” cards before reaching the model. This made deterministic code more informed while leaving the performer with less raw musical context and less room for interpretation.

### Portability moved in the wrong direction

Instead of defining MCP tools and resources that any harness could consume, orchestration moved into application-specific API routes, React state, and client transition slots.

### Debugging consumed attention without correcting direction

The authentication and response-schema bugs were real and worth diagnosing. Fixing them made the rejected architecture function, but did not make it suitable. More implementation effort increased sunk-cost confidence.

## What Was Useful

Several findings remain valid even though the rewrite was reverted:

- Authentication readiness must be explicit before authenticated planning or tool calls.
- Server and client need one shared wire schema, including normalization of third-party metadata.
- Live testing must inspect actual tool calls, stream fetches, audible transitions, and multi-track behavior.
- Track analysis needs efficient batch access and segment-level comparison.
- Missing analysis is normal and must be represented honestly to the model.
- Playback safety constraints should be enforced at the execution boundary.

These are constraints for a future design, not justification for rebuilding the reverted pipeline.

## Better Direction

Future work should begin with the MCP contract, not the application harness.

MCP should expose portable DJ capabilities such as:

- current deck, clock, transition, and played-history state;
- candidate discovery across likes and search;
- batch metadata and streamability checks;
- batch track-analysis summaries;
- targeted segment and transition-comparison queries;
- analysis scheduling;
- cue, preload, transition, and recovery actions;
- execution results and updated live state.

The MCP server should provide facts, capabilities, validation, and safety. It should not prescribe one model loop or silently perform the musical decision.

Harness should help LLM perform:

- preserve model ownership of track choice, set arc, and transition intent;
- expose analysis in compact progressive layers instead of a single giant payload;
- let model request deeper segment evidence when useful;
- maintain durable performance memory outside chat transcript;
- return real action results so model can observe and recover;
- use deadlines and emergency tools without replacing normal model judgment;
- permit different harness strategies over the same MCP server.

Deterministic code still has a role: reject unavailable media, prevent impossible schedules, cap unsafe tempo changes, protect audio continuity, and report failures. It should behave like decks and a mixer, not like the DJ.

## Required Evaluation Before Another Rewrite

Next design should not be called successful from unit tests or one visible switch. Minimum evaluation:

1. Run a recorded multi-track set long enough to show an arc.
2. Capture every model decision, analysis lookup, tool result, and executed transition.
3. Verify that selected analysis evidence changed decisions, rather than merely appearing in prompts.
4. Test chat interventions during active playback.
5. Test missing analysis, late decisions, unavailable streams, and recovery.
6. Run same MCP server from at least two harness configurations.
7. Review performance by listening, not only through logs and IDs.

Useful metrics include uninterrupted playback, repeated tracks, failed actions, decision latency, analysis utilization, transition timing, chat responsiveness, and human-rated musical coherence. No single metric should replace listening.

## Process Corrections

- Restate product thesis before architecture: **LLM is performer; MCP is instrument; harness supports performance.**
- Separate hard safety invariants from musical policy.
- Prototype MCP contract with one thin harness before changing player architecture.
- Validate one complete live transition early, then a multi-track set, before broad implementation.
- Report evidence narrowly. “Track switched” must never be reported as “DJ works.”
- Treat user rejection of musical quality as product evidence, even when technical tests pass.

## Rollback

All uncommitted files and edits from the analysis-driven deterministic harness attempt were removed. Workspace was restored to committed branch `next` at `0c02eb5`. This postmortem is the only new file retained from the attempt.
