import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { matchStandard, pickOption } from "./apply/fields";
import { parseConfig, type Config } from "./config";
import { resetDb } from "./db";
import { prefilter, titleMatches } from "./jobs/filter";
import { dedupe, fingerprint, htmlToText, toJob } from "./jobs/normalize";
import { isBelowMin, parseSalaryText } from "./jobs/salary";
import { groupJobs, postedWithin } from "./jobs/sort";
import type { Job, RawJob } from "./jobs/types";
import { BudgetError, assertBudget, recordSpend } from "./llm/cost";
import { searchWindow } from "./pipeline/find";
import { hookOf, hooksOf, newNumbers, resumeBody } from "./resume/render";
import { countriesFrom } from "./sources/geo";
import { nextStoryId, parseStories } from "./stories";
import { toIcs } from "./tracker/ics";

const config: Config = parseConfig(fs.readFileSync("configs.example.md", "utf8"));

const raw = (over: Partial<RawJob> = {}): RawJob => ({
  source: "test",
  sourceId: "1",
  company: "Example GmbH",
  title: "Senior Frontend Engineer (m/w/d)",
  location: "Berlin, Germany",
  countries: ["DE"],
  workMode: "hybrid",
  url: "https://example.com/jobs/1?utm_source=x",
  description: "<p>We use <b>React</b> and TypeScript.</p>",
  postedAt: "2026-11-10T00:00:00Z",
  ...over,
});

const job = (over: Partial<Job> = {}): Job => ({ ...toJob(raw(), "run", "2026-11-14T00:00:00Z"), status: "scored", score: 80, ...over });

describe("config", () => {
  it("parses the example config", () => {
    expect(config.search.countries).toContain("DE");
    expect(config.llm.mode).toBe("api");
    expect(config.scoring.threshold).toBe(70);
  });

  it("requires countries", () => {
    const md = fs.readFileSync("configs.example.md", "utf8").replace("countries: [DE, NL, US]", "countries: []");
    expect(() => parseConfig(md)).toThrow(/countries/);
  });
});

describe("normalize + dedupe", () => {
  it("ignores legal suffixes and gender markers in fingerprints", () => {
    expect(fingerprint(raw())).toBe(fingerprint(raw({ company: "Example", title: "Sr. Frontend Engineer" })));
  });

  it("strips tracking params and html", () => {
    const j = toJob(raw(), "r", "t");
    expect(j.url).toBe("https://example.com/jobs/1");
    expect(j.description).toBe("We use React and TypeScript.");
    expect(htmlToText("&lt;li&gt;One&lt;/li&gt;")).toBe("- One");
  });

  it("keeps the first-party copy when the same job appears twice", () => {
    const aggregator = toJob(raw({ source: "remotive" }), "r", "t");
    const ats = toJob(raw({ source: "greenhouse", firstParty: true, url: "https://boards.example/1" }), "r", "t");
    const out = dedupe([aggregator, ats]);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("greenhouse");
  });
});

describe("salary", () => {
  it("parses ranges in free text", () => {
    expect(parseSalaryText("Salary: €70,000 – €85,000 per year")).toEqual({ min: 70000, max: 85000, currency: "EUR", period: "year" });
    expect(parseSalaryText("$120k-$150k")).toMatchObject({ min: 120000, max: 150000, currency: "USD" });
    expect(parseSalaryText("no salary here")).toBeNull();
  });

  it("hides only clearly lower, comparable salaries", () => {
    const search = config.search;
    expect(isBelowMin({ min: 50000, max: 60000, currency: "EUR", period: "year" }, ["DE"], search)).toBe(true);
    expect(isBelowMin({ min: 70000, max: 90000, currency: "EUR", period: "year" }, ["DE"], search)).toBe(false);
    expect(isBelowMin({ min: 70000, max: 100000, currency: "USD", period: "year" }, ["DE"], search)).toBe(false);
    expect(isBelowMin({ min: 1, max: 2, currency: "XYZ", period: "year" }, ["DE"], search)).toBe(false);
    expect(isBelowMin(null, ["DE"], search)).toBe(false);
  });

  it("uses the floor of the job's country, converted through fx", () => {
    const search = {
      ...config.search,
      minSalary: { amount: 100000, currency: "EUR", period: "year" as const },
      minSalaryByCountry: { US: { amount: 150000, currency: "USD", period: "year" as const } },
      fxBase: "EUR",
      fx: { USD: 0.9 },
    };
    const usd140k = { min: 120000, max: 140000, currency: "USD", period: "year" as const };
    expect(isBelowMin(usd140k, ["US"], search)).toBe(true); // below $150k
    expect(isBelowMin(usd140k, [], search)).toBe(false); // worldwide: 126k EUR >= 100k EUR
    expect(isBelowMin({ min: 90000, max: 95000, currency: "EUR", period: "year" }, ["CZ"], search)).toBe(true);
  });
});

describe("filters", () => {
  it("matches titles by tokens", () => {
    expect(titleMatches("Sr. Frontend Engineer, Payments", ["Senior Frontend Engineer"])).toBe(true);
    expect(titleMatches("Backend Engineer", ["Senior Frontend Engineer"])).toBe(false);
    expect(titleMatches("Senior Front-End Engineer", ["Senior Frontend Engineer"])).toBe(true);
    expect(titleMatches("Staff Engineer, Design System", ["Design Systems Engineer"])).toBe(true);
  });

  it("drops wrong countries but keeps unknown ones", () => {
    expect(prefilter(raw({ countries: ["FR"] }), config).keep).toBe(false);
    expect(prefilter(raw({ countries: [] }), config).keep).toBe(true);
    expect(prefilter(raw({ description: "Vue only" }), config)).toEqual({ keep: false, reason: "keywords" });
  });

  it("detects countries without reading DE as Delaware", () => {
    expect(countriesFrom("Berlin, DE")).toEqual(["DE"]);
    expect(countriesFrom("Austin, TX")).toEqual(["US"]);
    expect(countriesFrom("Remote - Worldwide")).toEqual([]);
  });
});

describe("list order", () => {
  it("puts salary first, then auto-fillable, then score", () => {
    const salary = { min: 80000, max: 90000, currency: "EUR", period: "year" as const };
    const jobs = [
      job({ id: "a", score: 90, salary: null, autoFillable: true }),
      job({ id: "b", score: 75, salary, autoFillable: false }),
      job({ id: "c", score: 72, salary, autoFillable: true }),
      job({ id: "d", score: 95, salary, autoFillable: true }),
      job({ id: "e", score: 60, salary, autoFillable: true }),
      job({ id: "f", score: 99, salary, autoFillable: true, belowMinSalary: true }),
    ];
    const [withSalary, without] = groupJobs(jobs, { threshold: 70 });
    expect(withSalary!.ready.map((j) => j.id)).toEqual(["d", "c"]);
    expect(withSalary!.needsInput.map((j) => j.id)).toEqual(["b"]);
    expect(without!.ready.map((j) => j.id)).toEqual(["a"]);
  });
});

describe("list filters", () => {
  it("shows low scores only when asked", () => {
    const jobs = [job({ id: "hi", score: 80, autoFillable: true }), job({ id: "lo", score: 40, autoFillable: false })];
    const ids = (show: boolean) => groupJobs(jobs, { threshold: 70, showLowScores: show }).flatMap((g) => [...g.ready, ...g.needsInput]).map((j) => j.id);
    expect(ids(false)).toEqual(["hi"]);
    expect(ids(true)).toEqual(["hi", "lo"]);
  });
  it("filters by posting date and keeps undated jobs", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const jobs = [job({ id: "new", postedAt: "2026-11-13T00:00:00Z" }), job({ id: "old", postedAt: "2026-10-01T00:00:00Z" }), job({ id: "undated", postedAt: null })];
    expect(postedWithin(jobs, 7, now).map((j) => j.id)).toEqual(["new", "undated"]);
    expect(postedWithin(jobs, null, now)).toHaveLength(3);
  });
});

describe("search window", () => {
  const at = new Date("2026-11-14T12:00:00Z");
  it("looks back maxAgeDays on the first run", () => {
    expect(searchWindow(config, null, at).toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });
  it("continues from the previous run", () => {
    expect(searchWindow(config, "2026-11-13T08:00:00Z", at).toISOString()).toBe("2026-11-13T08:00:00.000Z");
  });
  it("never goes further back than maxAgeDays", () => {
    expect(searchWindow(config, "2026-08-01T00:00:00Z", at).toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });
});

describe("stories and fields", () => {
  const stories = parseStories(fs.readFileSync("interviewBankStories.example.md", "utf8"));
  it("parses the story bank", () => {
    expect(stories.map((s) => s.id)).toEqual(["S01", "S02"]);
    expect(stories[0]!.tags).toContain("leadership");
    expect(nextStoryId(stories)).toBe("S03");
  });

  it("maps standard form fields", () => {
    expect(matchStandard("First Name")).toBe("firstName");
    expect(matchStandard("Will you now or in the future require visa sponsorship?")).toBe("sponsorship");
    expect(matchStandard("Tell us about an open source project you contributed to")).toBeNull();
    expect(matchStandard("Please select the country where you currently reside.")).toBe("country");
    expect(matchStandard("If this role offers the option to work from a remote location, do you plan to?")).toBeNull();
    expect(matchStandard("Location")).toBe("location");
    expect(matchStandard("Full name")).toBe("fullName");
    expect(matchStandard("Name Pronunciation | How do you pronounce your name?")).toBeNull();
    expect(matchStandard("Please tell us how you heard about this opportunity.")).toBe("howDidYouHear");
    expect(matchStandard("Will you require relocation assistance?")).toBe("relocationSupport");
    expect(matchStandard("Are you willing to relocate to Austin, TX?")).toBe("relocation");
    expect(pickOption(["Yes", "No"], "No")).toBe("No");
    expect(pickOption(["Male", "Female", "I don't wish to answer"], "__DECLINE__")).toBe("I don't wish to answer");
  });
});

describe("resume checks", () => {
  const cv = fs.readFileSync("CV.example.md", "utf8");
  it("finds the hook and its variants", () => {
    expect(hookOf(cv)).toMatch(/^I turn slow/);
    expect(hooksOf(cv).map((h) => h.variant)).toEqual(["frontend-platform", "design-systems"]);
  });
  it("renders the template structure", () => {
    const html = resumeBody(cv);
    expect(html).toContain('<strong class="hook">I turn slow');
    expect(html).not.toContain("design systems that 30+"); // extra hook variants are dropped
    expect(html).toContain('<span class="org">Example Payments GmbH</span> — <span class="title">Senior Frontend Engineer</span><span class="when">2021 – present · Berlin</span>');
    expect(html).toContain('<section class="sec-skills">');
    expect(html).toContain("<strong>Languages</strong>"); // colon removed in skill labels
    expect(html).toContain('<div class="header">');
  });
  it("flags numbers that are not in the CV", () => {
    expect(newNumbers(cv, "Cut load time by 45% and grew revenue 300%")).toEqual(["300%"]);
  });
});

describe("budget", () => {
  beforeEach(() => resetDb(":memory:"));
  it("blocks runs over the daily budget unless allowed", () => {
    recordSpend("score", "claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 300_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, false);
    expect(() => assertBudget(0.5, 5)).toThrow(BudgetError);
    expect(() => assertBudget(0.5, 5, true)).not.toThrow();
  });
});

describe("ics", () => {
  it("writes all-day follow-ups", () => {
    const ics = toIcs([{ uid: "f1", start: "2026-11-20T00:00:00.000Z", allDay: true, title: "Follow up, Example" }]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261120");
    expect(ics).toContain("SUMMARY:Follow up\\, Example");
  });
});

describe("regressions from the first live run", () => {
  it("doesn't read US territories or regions as the US", () => {
    expect(countriesFrom("American Samoa; Australia")).toEqual(["AU"]);
    expect(countriesFrom("United States Minor Outlying Islands")).toEqual([]);
  });
  it("drops remote jobs restricted to other countries even with REMOTE", () => {
    const remote = { ...config, search: { ...config.search, countries: [...config.search.countries, "REMOTE"] } };
    expect(prefilter(raw({ countries: ["IN"], workMode: "remote" }), remote).keep).toBe(false);
  });
  it("joins list items wrapped in paragraphs", () => {
    expect(htmlToText("<ul><li><p>React</p></li></ul>")).toBe("- React");
  });
});

describe("run bookkeeping", () => {
  beforeEach(() => resetDb(":memory:"));
  it("marks runs whose process is gone as interrupted", async () => {
    const { runsRepo, db } = await import("./db");
    const live = runsRepo.start("find");
    const dead = runsRepo.start("score");
    db().prepare("UPDATE runs SET pid = 999999 WHERE id = ?").run(dead.id); // no such process
    const runs = runsRepo.recent();
    expect(runs.find((r) => r.id === live.id)!.status).toBe("running"); // this test process is alive
    expect(runs.find((r) => r.id === dead.id)!.status).toBe("failed");
  });
  it("stops a run", async () => {
    const { runsRepo, db } = await import("./db");
    const run = runsRepo.start("find");
    db().prepare("UPDATE runs SET pid = NULL WHERE id = ?").run(run.id); // don't signal the test process
    runsRepo.stop(run.id);
    expect(runsRepo.recent()[0]!.error).toMatch(/Interrupted|Stopped/);
  });
});

describe("adding jobs yourself", () => {
  it("recognizes ATS links", async () => {
    const { parseAtsLink } = await import("./sources/ats");
    expect(parseAtsLink("https://job-boards.greenhouse.io/stripe/jobs/123?gh_src=x")).toEqual({ ats: "greenhouse", slug: "stripe", id: "123" });
    expect(parseAtsLink("https://boards.greenhouse.io/gitlab/jobs/456")).toMatchObject({ ats: "greenhouse", slug: "gitlab" });
    expect(parseAtsLink("https://jobs.eu.lever.co/acme/abc-def/apply")).toEqual({ ats: "lever", slug: "acme", id: "abc-def" });
    expect(parseAtsLink("https://jobs.ashbyhq.com/notion/uuid-1/application")).toEqual({ ats: "ashby", slug: "notion", id: "uuid-1" });
    expect(parseAtsLink("https://jobs.smartrecruiters.com/BoschGroup/744000-senior-engineer")).toEqual({ ats: "smartrecruiters", slug: "BoschGroup", id: "744000" });
    expect(parseAtsLink("https://careers.example.com/job/1")).toBeNull();
  });

  it("reads a JobPosting from JSON-LD, including @graph", async () => {
    const { jobPostingFromHtml } = await import("./sources/manual");
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"JobPosting","title":"Staff Frontend Engineer","hiringOrganization":{"name":"Acme"},"jobLocation":{"address":{"addressLocality":"Austin","addressRegion":"TX","addressCountry":"US"}}}]}</script>`;
    expect(jobPostingFromHtml(html)).toMatchObject({ title: "Staff Frontend Engineer", hiringOrganization: { name: "Acme" } });
    expect(jobPostingFromHtml("<html>no data</html>")).toBeNull();
  });

  it("parses pasted questions", async () => {
    const { parseQuestions } = await import("./sources/manual");
    const qs = parseQuestions("1. Why do you want to work here? *\n- Your LinkedIn profile\n\nDescribe a project you led (required)");
    expect(qs.map((q) => [q.label, q.required, q.standardKey ?? null])).toEqual([
      ["Why do you want to work here?", true, null],
      ["Your LinkedIn profile", false, "linkedin"],
      ["Describe a project you led", true, null],
    ]);
  });

  it("stores a pasted job with its questions and can record it as applied", async () => {
    resetDb(":memory:");
    const { addJobs } = await import("./pipeline/add");
    const { jobsRepo, applicationsRepo } = await import("./db");
    const pasted = { company: "Acme", title: "Design Systems Engineer", location: "Austin, TX", description: "x".repeat(200), questions: "Why Acme? *" };
    const [first] = await addJobs(config, { pasted });
    expect(first!.ok).toBe(true);
    expect(first!.existing).toBeFalsy();
    expect(jobsRepo.get(first!.jobId!)!.questions![0]!.label).toBe("Why Acme?");
    const [again] = await addJobs(config, { pasted, alreadyApplied: true });
    expect(again!.existing).toBe(true);
    expect(jobsRepo.get(first!.jobId!)!.status).toBe("applied");
    expect(applicationsRepo.byJob(first!.jobId!)!.submittedAt).not.toBeNull();
  });
});

describe("editing prepared answers", () => {
  it("saves answers, resolves open questions, adds chosen ones to the story bank and moves on", async () => {
    const fsMod = await import("node:fs");
    const os = await import("node:os");
    const pathMod = await import("node:path");
    resetDb(":memory:");
    const { paths } = await import("./paths");
    const tmp = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), "jsa-"));
    const storiesFile = pathMod.join(tmp, "stories.md");
    fsMod.writeFileSync(storiesFile, "# Interview story bank\n\n## S01 — Existing\nTags: x\n**Situation:** s\n");
    (paths as { stories: string }).stories = storiesFile;

    const { addJobs } = await import("./pipeline/add");
    const { applicationsRepo, db } = await import("./db");
    const { saveAnswers } = await import("./pipeline/answersEdit");
    const [r] = await addJobs(config, {
      pasted: { company: "Acme", title: "DevEx Engineer", description: "y".repeat(200), questions: "Why Acme? *\nYour LinkedIn" },
    });
    const app = applicationsRepo.upsert(r!.jobId!, "needs_input");
    applicationsRepo.update(app.id, { resumeDir: tmp });
    db().prepare("INSERT INTO pending_stories (job_id, question, clarifying_question, created_at) VALUES (?,?,?,?)").run(r!.jobId!, "Why Acme?", "What draws you?", "t");

    const answer = "Because Acme builds developer tooling I use every day, and I want to make other engineers faster.";
    const res = saveAnswers(config, app.id, { answers: { q1: answer }, saveToBank: ["q1"] });

    expect(res.status).toBe("ready");
    expect(res.addedStories).toEqual(["S02"]);
    expect(fsMod.readFileSync(storiesFile, "utf8")).toContain(`**Answer:** ${answer}`);
    expect(fsMod.readFileSync(pathMod.join(tmp, "answers.md"), "utf8")).toContain(answer);
    expect(applicationsRepo.get(app.id)!.answers!.q1).toBe(answer);
    expect((db().prepare("SELECT status FROM pending_stories").get() as { status: string }).status).toBe("approved");
    // Saving the same answer again doesn't duplicate it in the bank.
    expect(saveAnswers(config, app.id, { answers: { q1: answer }, saveToBank: ["q1"] }).addedStories).toEqual([]);
  });
});

describe("cost-saving preparation", () => {
  it("picks the role family from the scorer, else from the job's words", async () => {
    const { familyFor } = await import("./resume/families");
    const families = ["frontend-platform", "developer-experience", "test-infrastructure"];
    const base = { title: "Senior Engineer", description: "", scoreResult: null };
    expect(familyFor({ ...base, scoreResult: { roleFamily: "test-infrastructure" } as never }, families)).toBe("test-infrastructure");
    expect(familyFor({ ...base, title: "Developer Experience Engineer" }, families)).toBe("developer-experience");
    expect(familyFor({ ...base, title: "Staff Engineer, Test Infrastructure" }, families)).toBe("test-infrastructure");
    expect(familyFor({ ...base, title: "Software Engineer" }, families)).toBe("frontend-platform");
    expect(familyFor(base, [])).toBeNull();
  });

  it("reuses saved answers only when they fit another company", async () => {
    const { reusableAnswer } = await import("./stories");
    const saved = [
      { id: "S10", question: "Why do you want to work at Acme?", answer: "Acme's mission matters to me.", company: "Acme" },
      { id: "S11", question: "Tell us about a project you're proud of.", answer: "The TypeScript migration across 15 repos.", company: "Acme" },
      { id: "S12", question: "Why do you want to work at Acme?", answer: "Because I love building developer tools.", company: "Acme" },
    ];
    expect(reusableAnswer("Tell us about a project you're proud of", "Globex", saved)?.id).toBe("S11");
    // S10 names Acme, so for Globex only the company-neutral S12 is reusable.
    expect(reusableAnswer("Why do you want to work at Globex?", "Globex", saved)?.id).toBe("S12");
    expect(reusableAnswer("Why do you want to work at Acme?", "Acme", saved)?.id).toBe("S10");
    expect(reusableAnswer("Describe a conflict with a colleague", "Globex", saved)).toBeNull();
  });

  it("plans family resumes once, per-job resumes for top scores, and answers only on demand", async () => {
    const fsMod = await import("node:fs");
    const os = await import("node:os");
    const pathMod = await import("node:path");
    resetDb(":memory:");
    const { paths } = await import("./paths");
    const tmp = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), "jsa-"));
    const p = paths as { cv: string; stories: string; resumes: string };
    p.cv = pathMod.resolve("CV.example.md");
    p.stories = pathMod.join(tmp, "stories.md");
    p.resumes = pathMod.join(tmp, "resumes");
    fsMod.writeFileSync(p.stories, "# Bank\n");
    const { prepareTasks } = await import("./pipeline/prepare");
    const qs = [{ id: "q1", label: "Why us?", required: true, type: "textarea" as const }];
    const top = job({ id: "top", fingerprint: "top", score: 92, questions: qs });
    const midA = job({ id: "midA", fingerprint: "midA", title: "Senior Frontend Engineer", score: 76, questions: qs });
    const midB = job({ id: "midB", fingerprint: "midB", title: "Frontend Platform Engineer", score: 78, questions: qs });
    const ids = (opts = {}) => prepareTasks([top, midA, midB], config, opts).map((t) => t.id).sort();
    expect(ids()).toEqual(["family-frontend-platform", "tailor-top"]);
    expect(ids({ writeAnswers: true })).toEqual(["answers-midA", "answers-midB", "answers-top", "family-frontend-platform", "tailor-top"]);
    expect(ids({ tailor: true })).toEqual(["tailor-midA", "tailor-midB", "tailor-top"]);
  });
});
