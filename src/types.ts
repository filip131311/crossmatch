export type Side = "ios" | "android";
export const SIDES: Side[] = ["ios", "android"];

export interface SideConfig {
  /** Path to the .app directory (iOS) or .apk file (Android). Relative to the config file. */
  app: string;
  /** Bundle id (iOS) / applicationId (Android). */
  bundleId: string;
  /** Simulator UDID / name, or Android serial / AVD name. Optional: a booted device is picked. */
  device?: string;
}

export interface Limits {
  /** Distinct screens the exploration may register before `natively` asks the agent to stop. */
  maxScreens: number;
  /** Total flows the exploration may author. */
  maxFlows: number;
  /** Total lockstep steps executed across all compare runs. */
  maxSteps: number;
  /** Wall-clock budget for the whole exploration, in minutes. */
  maxMinutes: number;
}

export interface Brand {
  name: string;
  accent: string;
  ink: string;
  paper: string;
}

export interface NativelyConfig {
  ios: SideConfig;
  android: SideConfig;
  /** Output directory, relative to the config file. */
  out: string;
  /** Directory with flow YAML files, relative to the config file. */
  flows: string;
  limits: Limits;
  brand: Brand;
  recording: { showTouches: boolean; timeLimitSeconds: number };
  /** Extra plain-English rules for the judge (things that are never a difference for this app). */
  judgeRules: string[];
}

export interface Frame { x: number; y: number; width: number; height: number }

export type Role =
  | "button" | "text" | "textfield" | "image" | "switch" | "checkbox" | "slider" | "tab"
  | "link" | "heading" | "list" | "cell" | "container" | "alert" | "other";

/** A UI element normalised across platforms. */
export interface UiNode {
  role: Role;
  rawRole: string;
  /** Best human-visible text: label, else value. */
  text: string;
  label?: string;
  value?: string;
  id?: string;
  frame: Frame;
  flags: string[];
  depth: number;
}

export interface UiTree {
  source: string;
  nodes: UiNode[];
  raw: string;
}

export interface Selector { id?: string; text?: string; role?: string; matches?: string }

export type Directive =
  | { kind: "launch"; bundleId?: string }
  | { kind: "tap"; selector?: Selector; x?: number; y?: number; times?: number }
  | { kind: "long-press"; selector: Selector; duration?: number }
  | { kind: "swipe"; direction: "up" | "down" | "left" | "right"; from?: Selector; duration?: number }
  | { kind: "type"; into: Selector; text: string; submit?: boolean }
  | { kind: "scroll-to"; target: Selector; direction?: "up" | "down" | "left" | "right"; maxSwipes?: number }
  | { kind: "await"; condition: Condition; timeout?: number }
  | { kind: "assert"; condition: Condition }
  | { kind: "wait"; ms: number }
  | { kind: "echo"; message: string }
  | { kind: "button"; button: string }
  | { kind: "when"; platform: Side; steps: FlowStep[] }
  | { kind: "tool"; tool: string; args: Record<string, unknown> };

export type Condition =
  | { type: "visible"; selector: Selector }
  | { type: "exists"; selector: Selector }
  | { type: "hidden"; selector: Selector }
  | { type: "text"; selector: Selector; expected: string }
  | { type: "idle" };

export interface FlowStep { index: number; directive: Directive; raw: unknown }

export interface Flow {
  name: string;
  path: string;
  title?: string;
  description?: string;
  steps: FlowStep[];
}

export type StepStatus = "pass" | "fail" | "skip" | "error";

export interface StepSideResult {
  status: StepStatus;
  reason?: string;
  /** Milliseconds since this side's recording started. */
  startMs: number;
  endMs: number;
  /** Element that was targeted, if the directive resolved one. */
  target?: UiNode;
  /** Tree captured after the step settled. */
  tree?: UiTree;
  /** Screenshot after the step, relative to the run directory. */
  screenshot?: string;
}

export interface StepResult {
  index: number;
  directive: Directive;
  label: string;
  ios: StepSideResult;
  android: StepSideResult;
}

export interface RunRecord {
  flow: { name: string; path: string; title?: string; description?: string };
  startedAt: string;
  finishedAt: string;
  devices: Record<Side, { id: string; name: string }>;
  video: Record<Side, { file: string; durationMs: number; width: number; height: number }>;
  steps: StepResult[];
  ok: boolean;
}

export type Category =
  | "missing-feature"
  | "behaviour"
  | "validation"
  | "content"
  | "state"
  | "layout"
  | "navigation"
  | "platform-idiom"
  | "noise";

export type Severity = "high" | "medium" | "low" | "ignore";

export interface Pointer {
  side: Side | "both";
  stepIndex: number;
  /** Element to point at, matched against that step's tree on that side. */
  element?: Selector;
  /** Or a normalised frame. */
  frame?: Frame;
  label: string;
}

export interface Candidate {
  id: string;
  /** First step where the difference shows. */
  stepIndex: number;
  /** Every step where the same difference shows. */
  steps: number[];
  kind: "outcome" | "elements" | "flags" | "text";
  summary: string;
  detail: string;
  pointers: Pointer[];
}

export interface Verdict {
  candidateIds: string[];
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  /** First and last step to show in the side-by-side video. */
  stepRange: [number, number];
  pointers: Pointer[];
  judge: "rules" | "llm" | "human";
  /** Stable identity of the difference across flows, so the report can group repeats. */
  key?: string;
  /** Side-by-side video file inside the run directory, once rendered. */
  video?: string;
}

export interface RunOutput {
  run: RunRecord;
  candidates: Candidate[];
  verdicts?: Verdict[];
}
