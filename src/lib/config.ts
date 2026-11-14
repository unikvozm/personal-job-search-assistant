import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { paths } from "./paths";

const AtsSchema = z.enum(["greenhouse", "lever", "ashby", "smartrecruiters"]);
export type Ats = z.infer<typeof AtsSchema>;

const SalarySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3).transform((s) => s.toUpperCase()),
  period: z.enum(["year", "month", "hour"]).default("year"),
});

export const ConfigSchema = z.object({
  profile: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      phone: z.string().default(""),
      city: z.string().default(""),
      country: z.string().default(""),
      linkedin: z.string().default(""),
      github: z.string().default(""),
      website: z.string().default(""),
      noticePeriod: z.string().default(""),
      earliestStart: z.coerce.string().default(""),
      salaryExpectation: z.string().default(""),
      howDidYouHear: z.string().default(""),
      willingToRelocate: z.boolean().optional(),
      needsRelocationSupport: z.boolean().optional(),
      eeo: z.enum(["decline", "answer"]).default("decline"),
    })
    .passthrough(),
  workAuthorization: z
    .record(z.string(), z.object({ authorized: z.boolean(), needsSponsorship: z.boolean() }))
    .default({}),
  search: z.object({
    titles: z.array(z.string()).min(1, "search.titles must list at least one job title"),
    keywords: z.array(z.string()).default([]),
    excludeKeywords: z.array(z.string()).default([]),
    excludeCompanies: z.array(z.string()).default([]),
    countries: z
      .array(z.string().transform((s) => s.toUpperCase()))
      .min(1, "search.countries must list at least one country (ISO alpha-2) or REMOTE"),
    workModes: z.array(z.enum(["remote", "hybrid", "onsite"])).default(["remote", "hybrid", "onsite"]),
    seniority: z.array(z.string()).default([]),
    maxAgeDays: z.number().int().positive().default(30),
    minJobs: z.number().int().nonnegative().default(100),
    /** Default floor: used for jobs whose country has no entry in minSalaryByCountry (e.g. worldwide remote). */
    minSalary: SalarySchema.optional(),
    minSalaryByCountry: z.record(z.string().transform((s) => s.toUpperCase()), SalarySchema).default({}),
    /** Currency the fx rates convert into; defaults to minSalary.currency. */
    fxBase: z.string().length(3).transform((s) => s.toUpperCase()).optional(),
    fx: z.record(z.string(), z.number().positive()).default({}),
    /** Free-text notes for the scorer: contract types, preferred regions, eligibility caveats. */
    preferences: z.string().default(""),
    targetCompanies: z
      .array(z.object({ name: z.string(), ats: AtsSchema, slug: z.string() }))
      .default([]),
  }),
  scoring: z.object({ threshold: z.number().min(0).max(100).default(70) }).default({ threshold: 70 }),
  llm: z
    .object({
      mode: z.enum(["api", "claude-code"]).default("api"),
      models: z
        .object({
          score: z.string().default("claude-haiku-5-5"),
          write: z.string().default("claude-sonnet-5-5"),
        })
        .default({ score: "claude-haiku-5-5", write: "claude-sonnet-5-5" }),
      useBatch: z.boolean().default(true),
      dailyBudgetUsd: z.number().positive().default(5),
      claudeBin: z.string().default("claude"),
    })
    .default({
      mode: "api",
      models: { score: "claude-haiku-5-5", write: "claude-sonnet-5-5" },
      useBatch: true,
      dailyBudgetUsd: 5,
      claudeBin: "claude",
    }),
  tracker: z.object({ followUpDays: z.number().int().positive().default(7) }).default({ followUpDays: 7 }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type SalarySpec = z.infer<typeof SalarySchema>;

/** Extracts the first ```yaml fenced block from a Markdown document. */
export function extractYamlBlock(markdown: string): string {
  const match = markdown.match(/```ya?ml\s*\n([\s\S]*?)```/);
  if (!match?.[1]) throw new Error("configs.md must contain a ```yaml block");
  return match[1];
}

export function parseConfig(markdown: string): Config {
  const result = ConfigSchema.safeParse(parseYaml(extractYamlBlock(markdown)));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`configs.md is invalid:\n${issues}`);
  }
  return result.data;
}

export function loadConfig(file = paths.config): Config {
  if (!fs.existsSync(file)) {
    throw new Error("configs.md not found. Run `pnpm setup` or copy configs.example.md to configs.md.");
  }
  return parseConfig(fs.readFileSync(file, "utf8"));
}

export function readRequiredFile(file: string, hint: string): string {
  if (!fs.existsSync(file)) throw new Error(`${file} not found. ${hint}`);
  return fs.readFileSync(file, "utf8");
}

export const readCv = () => readRequiredFile(paths.cv, "Copy CV.example.md to CV.md and fill it in.");
export const readStories = () =>
  fs.existsSync(paths.stories) ? fs.readFileSync(paths.stories, "utf8") : "";
