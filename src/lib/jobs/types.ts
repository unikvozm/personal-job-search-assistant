import type { Ats } from "../config";

export type WorkMode = "remote" | "hybrid" | "onsite";

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string;
  period: "year" | "month" | "hour";
}

/** What a source adapter returns, before normalization. */
export interface RawJob {
  source: string;
  sourceId: string;
  company: string;
  title: string;
  location: string;
  /** ISO alpha-2 codes the job is open to; empty when unknown. */
  countries: string[];
  workMode: WorkMode | null;
  url: string;
  applyUrl?: string;
  /** HTML or plain text; normalized later. */
  description: string;
  postedAt: string | null;
  salary?: Salary | null;
  ats?: Ats | null;
  /** ATS-specific identifiers needed to fetch questions / fill forms. */
  atsRef?: Record<string, string>;
  /** True when the source is the employer's own ATS (always live). */
  firstParty?: boolean;
  /** Set when the source itself vouches the posting is open (e.g. an expiry date in the future). */
  verifiedLive?: boolean;
}

export type JobStatus =
  | "new"
  | "scored"
  | "below_threshold"
  | "ineligible"
  | "skipped"
  | "hidden"
  | "applying"
  | "applied";

export interface ScoreBreakdown {
  experience: number;
  skills: number;
  qualifications: number;
  responsibilities: number;
  eligibility: number;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  eligible: boolean;
  eligibilityNotes: string;
  matched: string[];
  gaps: string[];
  atsKeywords: string[];
  salary: Salary | null;
  summary: string;
}

export interface ApplicationQuestion {
  id: string;
  label: string;
  required: boolean;
  type: "text" | "textarea" | "select" | "multiselect" | "checkbox" | "file" | "unknown";
  options?: string[];
  /** Filled from configs.md profile without the LLM. */
  standardKey?: string;
  /** Set by classification. */
  answerable?: boolean;
  storyIds?: string[];
  reason?: string;
}

export interface Job extends Omit<RawJob, "salary" | "description"> {
  id: string;
  fingerprint: string;
  description: string;
  salary: Salary | null;
  salarySource: "posting" | "llm" | null;
  belowMinSalary: boolean;
  status: JobStatus;
  selected: boolean;
  score: number | null;
  scoreResult: ScoreResult | null;
  questions: ApplicationQuestion[] | null;
  autoFillable: boolean | null;
  firstSeenRun: string;
  firstSeenAt: string;
  live: boolean | null;
}
