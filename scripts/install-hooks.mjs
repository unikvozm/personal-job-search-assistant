// Installs a pre-commit hook that refuses to commit personal files, even with `git add -f`.
import fs from "node:fs";
import path from "node:path";

const gitDir = ".git";
if (!fs.existsSync(gitDir)) process.exit(0);

const hook = `#!/bin/sh
# Installed by scripts/install-hooks.mjs - blocks personal data from being committed.
blocked=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '^(CV\\.md|interviewBankStories\\.md|configs\\.md|\\.env(\\..*)?|data/.*|personal/.*)$' | grep -v '^\\.env\\.example$')
if [ -n "$blocked" ]; then
  echo "✖ Refusing to commit personal files:"
  echo "$blocked" | sed 's/^/    /'
  echo "  Unstage them with: git restore --staged <file>"
  exit 1
fi
`;

const file = path.join(gitDir, "hooks", "pre-commit");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, hook, { mode: 0o755 });
