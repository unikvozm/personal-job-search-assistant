// Creates your local personal files from the templates. Never overwrites existing files.
import fs from "node:fs";

const copies = [
  ["configs.example.md", "configs.md"],
  ["CV.example.md", "CV.md"],
  ["interviewBankStories.example.md", "interviewBankStories.md"],
  [".env.example", ".env.local"],
];

for (const [from, to] of copies) {
  if (fs.existsSync(to)) {
    console.log(`  keep    ${to}`);
  } else {
    fs.copyFileSync(from, to);
    console.log(`  created ${to}`);
  }
}
fs.mkdirSync("data", { recursive: true });

console.log(`
Next steps:
  1. Edit configs.md (countries + titles are required), CV.md and interviewBankStories.md.
  2. API mode: put your ANTHROPIC_API_KEY in .env.local (or set llm.mode: claude-code).
  3. pnpm exec playwright install chromium   # for PDFs, form reading and prefill
  4. pnpm dev   → http://127.0.0.1:3417
These files are gitignored and never leave your machine.`);
