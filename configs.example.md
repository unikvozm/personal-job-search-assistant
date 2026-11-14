# Job search configuration

Copy this file to `configs.md` (gitignored) and edit the YAML block below.
Everything outside the ```yaml block is ignored, so feel free to keep notes here.

**Prerequisites:** `search.countries` and `search.titles` must not be empty. The countries decide which job boards are searched (see `src/lib/sources/index.ts`).

```yaml
profile:                      # used to fill application forms - stays on your machine
  firstName: Alex
  lastName: Example
  email: alex@example.com
  phone: "+49 000 0000000"
  city: Berlin
  country: DE
  linkedin: https://www.linkedin.com/in/alex-example
  github: https://github.com/alex-example
  website: ""
  noticePeriod: 3 months
  earliestStart: 2027-01-01
  salaryExpectation: ""        # leave empty to answer with the minimum for the job's country (e.g. "75,000+ EUR per year")
  howDidYouHear: Company careers page
  willingToRelocate: true      # answers "Are you willing to relocate?"
  needsRelocationSupport: false  # answers "Do you need relocation assistance?"
  eeo: decline                                   # decline | answer (voluntary diversity questions)

# Work authorization per country (ISO 3166 alpha-2). Used for eligibility scoring and form answers.
workAuthorization:
  DE: { authorized: true, needsSponsorship: false }
  NL: { authorized: true, needsSponsorship: false }
  US: { authorized: false, needsSponsorship: true }

search:
  titles:                     # matched case-insensitively against job titles
    - Senior Frontend Engineer
    - Senior Full Stack Engineer
    - Frontend Lead
  keywords: [React, TypeScript]          # a job must mention at least one (empty = no filter)
  excludeKeywords: [Java only, unpaid, internship]
  excludeCompanies: []
  countries: [DE, NL, US]     # ISO alpha-2 codes; add REMOTE for worldwide remote boards
  workModes: [remote, hybrid] # remote | hybrid | onsite
  seniority: [senior, lead]
  maxAgeDays: 30              # first run looks back this far; later runs start from the previous run
  minJobs: 100                # warn when a run finds fewer
  minSalary: { amount: 75000, currency: EUR, period: year }   # default floor (worldwide remote, unknown country)
  minSalaryByCountry:                                        # optional per-country floors
    US: { amount: 140000, currency: USD, period: year }
  fxBase: EUR                                                # currency the rates below convert into
  fx: { USD: 0.92, GBP: 1.17, CHF: 1.05 }                    # 1 unit of X = n units of fxBase (approximate)
  preferences: >-                                            # free text the scorer takes into account
    Full-time or contract-to-hire. Prefers hybrid in Berlin.
  targetCompanies:            # public ATS boards - most reliable source, add as many as you like
    - { name: Example Co, ats: greenhouse, slug: exampleco }
    # ats: greenhouse | lever | ashby | smartrecruiters  (slug = the company id in the board URL)

scoring:
  threshold: 70               # jobs at or below this are hidden

llm:
  mode: api                   # api | claude-code  (can be switched in the UI)
  models:
    score: claude-haiku-5-5   # cheap, high volume: scoring, question classification, practice feedback
    write: claude-sonnet-5-5  # resumes, answers, STAR stories, interview prep
  useBatch: true              # 50% cheaper scoring; results usually arrive within minutes
  dailyBudgetUsd: 5           # runs that would exceed this stop and ask first
  claudeBin: claude           # path to the Claude Code CLI, used in claude-code mode

tracker:
  followUpDays: 7
```
