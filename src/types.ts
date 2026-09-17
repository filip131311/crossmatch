/** A platform crossmatch can drive. A run compares exactly two of them (the config's `platforms`). */
export type Side = "ios" | "android" | "web";
export const SIDES: Side[] = ["ios", "android", "web"];
export const SIDE_NAME: Record<Side, string> = { ios: "iOS", android: "Android", web: "Web" };
/** The two platforms a project compares, in panel order (left, right). */
export type Pair = [Side, Side];
export const DEFAULT_PAIR: Pair = ["ios", "android"];
export type NativeSide = Exclude<Side, "web">;

export interface SideConfig {
  /** Path to the .app directory (iOS) or .apk file (Android). Relative to the config file. */
  app: string;
  /** Bundle id (iOS) / applicationId (Android). */
  bundleId: string;
  /** Simulator UDID / name, or Android serial / AVD name. Optional: a booted device is picked. */
  device?: string;
}

export interface WebConfig {
  /** The page a `launch:` step opens (the web app's entry point). */
  url: string;
  /** Chrome DevTools port. Argent always discovers 9222; any other port is registered with Argent. */
  port: number;
  /** CSS viewport of the browser crossmatch starts: a phone-sized window by default. */
  viewport: { width: number; height: number; deviceScaleFactor: number };
  /** Run Chrome without a window (exact viewport). A windowed Chrome's viewport is only approximate. */
  headless: boolean;
  /** Chrome/Chromium executable. Default: CROSSMATCH_CHROME, then the usual install locations. */
  browser?: string;
  /** User agent override, e.g. a mobile Safari or Chrome string for sites that sniff it. */
  userAgent?: string;
}

export interface Limits {
  /** Distinct screens the exploration may register before `crossmatch` asks the agent to stop. */
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

export interface CrossmatchConfig {
  /** The two platforms to compare. Default: ["ios", "android"]. */
  platforms: Pair;
  ios: SideConfig;
  android: SideConfig;
  web: WebConfig;
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

export interface Selector {
  id?: string;
  text?: string;
  role?: string;
  /** Regular expression on the text (case-sensitive, like Argent). */
  matches?: string;
  /** A bare-string selector: try `id` first, then `text` (Argent's loose semantics). */
  loose?: boolean;
}

export type Directive =
  /** `bundleId` is the app to (re)start; on web it is the URL to open. */
  | { kind: "launch"; bundleId?: string; perPlatform?: Partial<Record<Side, string>> }
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
  | { type: "text"; selector: Selector; expected: string; match: "contains" | "equals" | "matches" }
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
  /** Fraction of pixels (0..1) that changed between the previous step's screenshot and this one. */
  screenChange?: number;
  /** Set when the tree or screenshot after this step could not be captured. */
  captureError?: string;
}

/** One step on both sides of the run's pair (only those two keys are present). */
export type StepResult = {
  index: number;
  directive: Directive;
  label: string;
} & Partial<Record<Side, StepSideResult>>;

export interface VideoInfo { file: string; durationMs: number; width: number; height: number }

export interface RunRecord {
  flow: { name: string; path: string; title?: string; description?: string };
  /** The compared platforms. Absent in runs recorded before web support: those are ios/android. */
  sides?: Pair;
  startedAt: string;
  finishedAt: string;
  devices: Partial<Record<Side, { id: string; name: string }>>;
  video: Partial<Record<Side, VideoInfo>>;
  steps: StepResult[];
  ok: boolean;
  captureErrors?: string[];
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
  /** Flow-independent identity of what differs (e.g. `only-android:#super-like-button`). */
  signature: string;
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

/** The platforms a stored run compared. */
export function runPair(run: RunRecord): Pair {
  return run.sides ?? DEFAULT_PAIR;
}

/** The other side of the pair. */
export function otherSide(pair: Pair, side: Side): Side {
  return side === pair[0] ? pair[1] : pair[0];
}

/** A step's result on one side of its run's pair. */
export function sideOf(step: StepResult, side: Side): StepSideResult {
  const r = step[side];
  if (!r) throw new Error(`step ${step.index + 1} has no ${SIDE_NAME[side]} result`);
  return r;
}

export interface RunOutput {
  run: RunRecord;
  candidates: Candidate[];
  verdicts?: Verdict[];
}
