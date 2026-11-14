import { DatabaseSync } from "node:sqlite";
import { ensureDir, paths } from "./paths";
import type { ApplicationQuestion, Job, JobStatus, ScoreResult } from "./jobs/types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  countries TEXT NOT NULL,
  work_mode TEXT,
  url TEXT NOT NULL,
  apply_url TEXT,
  description TEXT NOT NULL,
  posted_at TEXT,
  salary TEXT,
  salary_source TEXT,
  below_min_salary INTEGER NOT NULL DEFAULT 0,
  ats TEXT,
  ats_ref TEXT,
  first_party INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  selected INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  score_result TEXT,
  questions TEXT,
  auto_fillable INTEGER,
  first_seen_run TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  live INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  window_from TEXT,
  stats TEXT,
  error TEXT,
  pid INTEGER
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  status TEXT NOT NULL,
  resume_dir TEXT,
  answers TEXT,
  missing_fields TEXT,
  screenshot TEXT,
  prefilled_at TEXT,
  approved_at TEXT,
  submitted_at TEXT,
  follow_up_at TEXT,
  interview_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  step TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  batch INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  question TEXT NOT NULL,
  clarifying_question TEXT NOT NULL,
  user_input TEXT,
  draft TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prep (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

let instance: DatabaseSync | null = null;

export function db(file = paths.db): DatabaseSync {
  if (instance) return instance;
  if (file !== ":memory:") ensureDir(paths.data);
  instance = new DatabaseSync(file);
  instance.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  instance.exec(SCHEMA);
  migrate(instance);
  return instance;
}

/** Additive migrations for databases created by older versions. */
function migrate(d: DatabaseSync) {
  const runColumns = (d.prepare("PRAGMA table_info(runs)").all() as Row[]).map((c) => c.name);
  if (!runColumns.includes("pid")) d.exec("ALTER TABLE runs ADD COLUMN pid INTEGER");
}

/** For tests: swap in a fresh in-memory database. */
export function resetDb(file = ":memory:"): DatabaseSync {
  instance?.close();
  instance = null;
  return db(file);
}

export const now = () => new Date().toISOString();
const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
const parse = <T>(v: unknown): T | null => (typeof v === "string" ? (JSON.parse(v) as T) : null);

type Row = Record<string, unknown>;

export function rowToJob(r: Row): Job {
  return {
    id: r.id as string,
    fingerprint: r.fingerprint as string,
    source: r.source as string,
    sourceId: r.source_id as string,
    company: r.company as string,
    title: r.title as string,
    location: r.location as string,
    countries: parse<string[]>(r.countries) ?? [],
    workMode: (r.work_mode as Job["workMode"]) ?? null,
    url: r.url as string,
    applyUrl: (r.apply_url as string) ?? undefined,
    description: r.description as string,
    postedAt: (r.posted_at as string) ?? null,
    salary: parse(r.salary),
    salarySource: (r.salary_source as Job["salarySource"]) ?? null,
    belowMinSalary: r.below_min_salary === 1,
    ats: (r.ats as Job["ats"]) ?? null,
    atsRef: parse(r.ats_ref) ?? undefined,
    firstParty: r.first_party === 1,
    status: r.status as JobStatus,
    selected: r.selected === 1,
    score: (r.score as number) ?? null,
    scoreResult: parse<ScoreResult>(r.score_result),
    questions: parse<ApplicationQuestion[]>(r.questions),
    autoFillable: r.auto_fillable == null ? null : r.auto_fillable === 1,
    firstSeenRun: r.first_seen_run as string,
    firstSeenAt: r.first_seen_at as string,
    live: r.live == null ? null : r.live === 1,
  };
}

export const jobsRepo = {
  insert(job: Job) {
    db()
      .prepare(
        `INSERT INTO jobs (id, fingerprint, source, source_id, company, title, location, countries, work_mode, url,
          apply_url, description, posted_at, salary, salary_source, ats, ats_ref, first_party, status,
          first_seen_run, first_seen_at, last_seen_at, live)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        job.id, job.fingerprint, job.source, job.sourceId, job.company, job.title, job.location,
        json(job.countries), job.workMode, job.url, job.applyUrl ?? null, job.description, job.postedAt,
        json(job.salary), job.salarySource, job.ats ?? null, json(job.atsRef), job.firstParty ? 1 : 0,
        job.status, job.firstSeenRun, job.firstSeenAt, job.firstSeenAt, job.live == null ? null : Number(job.live),
      );
  },
  touch(fingerprint: string) {
    db().prepare("UPDATE jobs SET last_seen_at = ? WHERE fingerprint = ?").run(now(), fingerprint);
  },
  knownFingerprints(): Set<string> {
    const rows = db().prepare("SELECT fingerprint FROM jobs").all() as Row[];
    return new Set(rows.map((r) => r.fingerprint as string));
  },
  get(id: string): Job | null {
    const r = db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToJob(r) : null;
  },
  byStatus(...statuses: JobStatus[]): Job[] {
    const marks = statuses.map(() => "?").join(",");
    return (db().prepare(`SELECT * FROM jobs WHERE status IN (${marks})`).all(...statuses) as Row[]).map(rowToJob);
  },
  byIds(ids: string[]): Job[] {
    if (!ids.length) return [];
    const marks = ids.map(() => "?").join(",");
    return (db().prepare(`SELECT * FROM jobs WHERE id IN (${marks})`).all(...ids) as Row[]).map(rowToJob);
  },
  saveScore(id: string, s: { status: JobStatus; score: number; result: ScoreResult; salary: Job["salary"]; salarySource: Job["salarySource"]; belowMinSalary: boolean }) {
    db()
      .prepare(
        "UPDATE jobs SET status = ?, score = ?, score_result = ?, salary = ?, salary_source = ?, below_min_salary = ? WHERE id = ?",
      )
      .run(s.status, s.score, json(s.result), json(s.salary), s.salarySource, s.belowMinSalary ? 1 : 0, id);
  },
  saveQuestions(id: string, questions: ApplicationQuestion[] | null, autoFillable: boolean) {
    db()
      .prepare("UPDATE jobs SET questions = ?, auto_fillable = ?, selected = ? WHERE id = ?")
      .run(json(questions), autoFillable ? 1 : 0, autoFillable ? 1 : 0, id);
  },
  setStatus(ids: string[], status: JobStatus) {
    const stmt = db().prepare("UPDATE jobs SET status = ? WHERE id = ?");
    for (const id of ids) stmt.run(status, id);
  },
  setSelected(ids: string[], selected: boolean) {
    const stmt = db().prepare("UPDATE jobs SET selected = ? WHERE id = ?");
    for (const id of ids) stmt.run(selected ? 1 : 0, id);
  },
};

export type RunKind = "find" | "score" | "prepare" | "prefill" | "submit" | "prep";

export interface Run {
  id: string;
  kind: RunKind;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  windowFrom: string | null;
  stats: Record<string, unknown> | null;
  error: string | null;
}

const rowToRun = (r: Row): Run => ({
  id: r.id as string,
  kind: r.kind as RunKind,
  status: r.status as Run["status"],
  startedAt: r.started_at as string,
  finishedAt: (r.finished_at as string) ?? null,
  windowFrom: (r.window_from as string) ?? null,
  stats: parse(r.stats),
  error: (r.error as string) ?? null,
});

export const runsRepo = {
  start(kind: RunKind, windowFrom: string | null = null): Run {
    const run: Run = {
      id: `${kind}-${now()}`,
      kind,
      status: "running",
      startedAt: now(),
      finishedAt: null,
      windowFrom,
      stats: null,
      error: null,
    };
    db()
      .prepare("INSERT INTO runs (id, kind, status, started_at, window_from, pid) VALUES (?,?,?,?,?,?)")
      .run(run.id, kind, run.status, run.startedAt, windowFrom, process.pid);
    return run;
  },
  /** Marks "running" runs whose process is gone (crash, killed, dev server restart) as interrupted. */
  reapStale() {
    const rows = db().prepare("SELECT id, pid FROM runs WHERE status = 'running'").all() as Row[];
    for (const r of rows) {
      if (r.pid == null || !isAlive(r.pid as number)) {
        this.fail(r.id as string, "Interrupted: the run's process ended before it finished. Start it again.");
      }
    }
  },
  /** Stops a running run: ends its process and marks it failed. */
  stop(id: string) {
    const r = db().prepare("SELECT pid, status FROM runs WHERE id = ?").get(id) as Row | undefined;
    if (!r || r.status !== "running") return;
    if (r.pid != null && isAlive(r.pid as number)) process.kill(r.pid as number, "SIGTERM");
    this.fail(id, "Stopped by you.");
  },
  finish(id: string, stats: Record<string, unknown>) {
    db().prepare("UPDATE runs SET status = 'done', finished_at = ?, stats = ? WHERE id = ?").run(now(), json(stats), id);
  },
  fail(id: string, error: string) {
    db().prepare("UPDATE runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(now(), error, id);
  },
  lastSuccessful(kind: RunKind): Run | null {
    const r = db()
      .prepare("SELECT * FROM runs WHERE kind = ? AND status = 'done' ORDER BY started_at DESC LIMIT 1")
      .get(kind) as Row | undefined;
    return r ? rowToRun(r) : null;
  },
  recent(limit = 10): Run[] {
    this.reapStale();
    return (db().prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?").all(limit) as Row[]).map(rowToRun);
  },
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 only checks that the process exists
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type ApplicationStatus =
  | "preparing"
  | "needs_input"
  | "ready"
  | "prefilled"
  | "needs_manual"
  | "approved"
  | "submitted"
  | "submit_unconfirmed"
  | "skipped"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export interface Application {
  id: number;
  jobId: string;
  status: ApplicationStatus;
  resumeDir: string | null;
  answers: Record<string, string> | null;
  missingFields: string[] | null;
  screenshot: string | null;
  prefilledAt: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  followUpAt: string | null;
  interviewAt: string | null;
  notes: string;
  updatedAt: string;
}

const rowToApplication = (r: Row): Application => ({
  id: r.id as number,
  jobId: r.job_id as string,
  status: r.status as ApplicationStatus,
  resumeDir: (r.resume_dir as string) ?? null,
  answers: parse(r.answers),
  missingFields: parse(r.missing_fields),
  screenshot: (r.screenshot as string) ?? null,
  prefilledAt: (r.prefilled_at as string) ?? null,
  approvedAt: (r.approved_at as string) ?? null,
  submittedAt: (r.submitted_at as string) ?? null,
  followUpAt: (r.follow_up_at as string) ?? null,
  interviewAt: (r.interview_at as string) ?? null,
  notes: (r.notes as string) ?? "",
  updatedAt: r.updated_at as string,
});

const APP_COLUMNS: Record<string, string> = {
  status: "status",
  resumeDir: "resume_dir",
  answers: "answers",
  missingFields: "missing_fields",
  screenshot: "screenshot",
  prefilledAt: "prefilled_at",
  approvedAt: "approved_at",
  submittedAt: "submitted_at",
  followUpAt: "follow_up_at",
  interviewAt: "interview_at",
  notes: "notes",
};

export const applicationsRepo = {
  upsert(jobId: string, status: ApplicationStatus): Application {
    db()
      .prepare(
        `INSERT INTO applications (job_id, status, updated_at) VALUES (?,?,?)
         ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(jobId, status, now());
    return this.byJob(jobId)!;
  },
  update(id: number, patch: Partial<Omit<Application, "id" | "jobId" | "updatedAt">>) {
    const entries = Object.entries(patch).filter(([k]) => k in APP_COLUMNS);
    if (!entries.length) return;
    const sets = entries.map(([k]) => `${APP_COLUMNS[k]} = ?`).join(", ");
    const values = entries.map(([, v]) => (v != null && typeof v === "object" ? JSON.stringify(v) : (v ?? null)));
    db()
      .prepare(`UPDATE applications SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...(values as (string | number | null)[]), now(), id);
  },
  byJob(jobId: string): Application | null {
    const r = db().prepare("SELECT * FROM applications WHERE job_id = ?").get(jobId) as Row | undefined;
    return r ? rowToApplication(r) : null;
  },
  get(id: number): Application | null {
    const r = db().prepare("SELECT * FROM applications WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToApplication(r) : null;
  },
  byStatus(...statuses: ApplicationStatus[]): Application[] {
    const marks = statuses.map(() => "?").join(",");
    return (
      db().prepare(`SELECT * FROM applications WHERE status IN (${marks}) ORDER BY updated_at`).all(...statuses) as Row[]
    ).map(rowToApplication);
  },
  all(): Application[] {
    return (db().prepare("SELECT * FROM applications ORDER BY updated_at DESC").all() as Row[]).map(rowToApplication);
  },
  /** Submitted applications for the same company + normalized title (duplicate guard). */
  submittedDuplicates(company: string, title: string, excludeJobId: string): Application[] {
    const rows = db()
      .prepare(
        `SELECT a.* FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE lower(j.company) = lower(?) AND lower(j.title) = lower(?) AND a.job_id != ?
           AND a.submitted_at IS NOT NULL`,
      )
      .all(company, title, excludeJobId) as Row[];
    return rows.map(rowToApplication);
  },
};

export const settingsRepo = {
  get(key: string): string | null {
    const r = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return (r?.value as string) ?? null;
  },
  set(key: string, value: string) {
    db()
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  },
};
