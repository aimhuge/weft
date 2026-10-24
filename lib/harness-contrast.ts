// How candidate harness runs are compared, with no grader and no reference answer
// (docs/architecture/goose.md).
//
// Harness² picks a candidate by contrasting how the runs BEHAVED, not by checking their answers against
// a key: there is no key here, and there never will be. Two runs of the same task are compared on what
// they did — how many tool calls they made, how many of those failed, whether the turn finished with an
// answer, how many turns and tokens they burned — and the difference between them is the evidence.
//
// The scores below are deliberately one-directional: every measure is "more of this is better", so a
// candidate that finishes with fewer failed tool calls, uses fewer turns and still produces an answer
// wins. There is no term that rewards a longer run, because on a board a run that wanders is a run that
// costs the user time.
//
// Pure and deterministic: the same trajectories always give the same scores and the same diff.
//
// The scoring weights are the ones the contrast reasons about. They are exported so a card can be scored
// with a different emphasis without editing this file.

import type { HarnessSurface } from "./harness-policy";

/** One tool call a run made. */
export interface ToolCall {
  name: string;
  ok: boolean;
  // The turn the call was made in, counted from 1.
  turn: number;
}

/** What a candidate run did. Everything here is observed, never expected. */
export interface Trajectory {
  // A name for the candidate, so a diff can say which run was which.
  candidate: string;
  // The tool calls the run made, in order.
  toolCalls: ToolCall[];
  // How many messages the run produced (assistant turns).
  messages: number;
  // How many model turns the run took.
  turns: number;
  // How many times the run failed outright.
  errors: number;
  // The tokens the run used, input and output together.
  tokens: number;
  // Whether the run finished with an answer.
  completed: boolean;
  // The surfaces the candidate's harness changed, for the diff.
  changed?: HarnessSurface[];
}

/** The measures a run is scored on. Every one of them is "more is better". */
export interface Measures {
  // Whether the run produced an answer at all.
  completed: boolean;
  // How many tool calls succeeded.
  toolSuccesses: number;
  // How many tool calls failed. Fewer is better.
  toolFailures: number;
  // The share of tool calls that failed, 0..1. Fewer is better.
  failureRate: number;
  // How many turns the run took. Fewer is better, past a floor.
  turns: number;
  // How many tokens the run used. Fewer is better, past a floor.
  tokens: number;
  // How many messages the run produced. Fewer is better, past a floor.
  messages: number;
  // Whether the run failed outright. Fewer is better.
  errors: number;
}

/** The weights the score is computed with. */
export interface Weights {
  // What a finished answer is worth.
  completed: number;
  // What a successful tool call is worth.
  toolSuccess: number;
  // What a failed tool call costs.
  toolFailure: number;
  // What an outright error costs.
  error: number;
  // What an extra turn costs, per turn past the floor.
  turn: number;
  // What an extra thousand tokens cost, past the floor.
  token: number;
  // What an extra message costs, past the floor.
  message: number;
}

/** The default weights: a finished answer dominates, and wandering is what costs. */
export const DEFAULT_WEIGHTS: Weights = {
  completed: 10,
  toolSuccess: 1,
  toolFailure: -3,
  error: -5,
  turn: -0.5,
  token: -0.002,
  message: -0.1,
};

/** The turns a run gets for free: a run that does the work in a couple of turns isn't penalised. */
export const TURN_FLOOR = 3;

/** The messages a run gets for free, for the same reason. */
export const MESSAGE_FLOOR = 2;

/** The tokens a run gets for free: reading the folder and the first pass. */
export const TOKEN_FLOOR = 2_000;

/** The measures of a run, read off its trajectory. */
export function measures(trajectory: Trajectory): Measures {
  const toolSuccesses = trajectory.toolCalls.filter((call) => call.ok).length;
  const toolFailures = trajectory.toolCalls.length - toolSuccesses;
  return {
    completed: trajectory.completed,
    toolSuccesses,
    toolFailures,
    failureRate: trajectory.toolCalls.length ? toolFailures / trajectory.toolCalls.length : 0,
    turns: trajectory.turns,
    tokens: trajectory.tokens,
    messages: trajectory.messages,
    errors: trajectory.errors,
  };
}

/**
 * A run's score. Higher is better.
 *
 * The cost terms (turns, tokens, messages) only bite past their floor, so a run isn't punished for the
 * minimum work the task needs — only for the extra wandering on top of it.
 */
export function score(trajectory: Trajectory, weights: Weights = DEFAULT_WEIGHTS): number {
  const m = measures(trajectory);
  let total = 0;
  if (m.completed) total += weights.completed;
  total += m.toolSuccesses * weights.toolSuccess;
  total += m.toolFailures * weights.toolFailure;
  total += m.errors * weights.error;
  total += Math.max(0, m.turns - TURN_FLOOR) * weights.turn;
  total += Math.max(0, m.tokens - TOKEN_FLOOR) * weights.token;
  total += Math.max(0, m.messages - MESSAGE_FLOOR) * weights.message;
  return round(total);
}

/** A score, rounded so a diff of two scores reads the same twice. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One difference between two runs. */
export interface BehaviorDiff {
  // The measure the difference is about.
  measure: keyof Measures;
  // The two runs' values.
  left: number;
  right: number;
  // Which run was better on it: "left" or "right". A measure the runs agree on is not a difference, so
  // there is no tie here.
  better: "left" | "right";
  // How much better, in the measure's own units.
  delta: number;
}

/** The measures where the two runs differ, in a fixed order. */
const MEASURE_ORDER: (keyof Measures)[] = [
  "completed",
  "toolSuccesses",
  "toolFailures",
  "failureRate",
  "turns",
  "tokens",
  "messages",
  "errors",
];

/**
 * The differences between two runs, on the measures where they differ.
 *
 * This is the whole of the evidence: no measure is compared against a target, only against the other
 * run. The order of the measures is fixed, so the diff is the same every time it is computed.
 */
export function diffTrajectories(left: Trajectory, right: Trajectory): BehaviorDiff[] {
  const a = measures(left);
  const b = measures(right);
  const diffs: BehaviorDiff[] = [];
  for (const measure of MEASURE_ORDER) {
    const lv = numeric(a[measure]);
    const rv = numeric(b[measure]);
    if (lv === rv) continue;
    diffs.push({ measure, left: lv, right: rv, better: betterOn(measure, lv, rv), delta: round(Math.abs(lv - rv)) });
  }
  return diffs;
}

/**
 * A measure as a number.
 *
 * `completed` is the one boolean measure, and it reads one way: it is 1 when the run produced an answer
 * and 0 when it didn't, so a diff on it is a diff of 1.
 */
function numeric(value: number | boolean): number {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

/**
 * Which run was better on a measure.
 *
 * Every measure reads one way: `completed` is a boolean where true is better, the failure measures are
 * counts and rates where fewer is better, and the rest are counts where more is better. Two runs that
 * differ on a measure can only be better on it one way, so there is never a tie here.
 */
function betterOn(measure: keyof Measures, left: number, right: number): "left" | "right" {
  const leftWins =
    measure === "completed" ? left > right
    : measure === "toolFailures" || measure === "failureRate" ? left < right
    : left > right;
  return leftWins ? "left" : "right";
}

/** A candidate's score next to the run behind it. */
export interface ScoredCandidate {
  candidate: string;
  score: number;
  measures: Measures;
  trajectory: Trajectory;
}

/** Every candidate, scored, best first. The order is stable: a tie keeps the order it came in. */
export function scoreCandidates(trajectories: Trajectory[], weights: Weights = DEFAULT_WEIGHTS): ScoredCandidate[] {
  return trajectories
    .map((trajectory) => ({ candidate: trajectory.candidate, score: score(trajectory, weights), measures: measures(trajectory), trajectory }))
    .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate));
}

/**
 * The evidence a lesson is built from: the candidates that were run, how they scored, and how the best
 * one behaved against the one it beat.
 */
export interface Contrast {
  // The candidates, best first.
  scored: ScoredCandidate[];
  // The best candidate's name, or "" when there were no candidates.
  winner: string;
  // The score gap between the winner and the runner-up.
  margin: number;
  // The best candidate's differences against the runner-up: the evidence the lesson cites.
  diffs: BehaviorDiff[];
  // Whether the winner is decisively better, i.e. the margin is worth acting on.
  decisive: boolean;
}

/** The score gap a winner needs before a lesson is worth keeping. */
export const DECISIVE_MARGIN = 1;

/**
 * The contrast between the candidates: who won, by how much, and where they differed.
 *
 * A run that isn't decisively better than the runner-up is not evidence of anything, so `decisive` is
 * false and no lesson should be written from it.
 */
export function contrast(trajectories: Trajectory[], weights: Weights = DEFAULT_WEIGHTS): Contrast {
  const scored = scoreCandidates(trajectories, weights);
  const winner = scored[0];
  if (!winner) return { scored, winner: "", margin: 0, diffs: [], decisive: false };
  const runnerUp = scored[1];
  const margin = runnerUp ? round(winner.score - runnerUp.score) : round(winner.score);
  const diffs = runnerUp ? diffTrajectories(winner.trajectory, runnerUp.trajectory) : [];
  return { scored, winner: winner.candidate, margin, diffs, decisive: margin >= DECISIVE_MARGIN };
}
