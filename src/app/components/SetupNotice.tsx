export function SetupNotice({ error }: { error: string }) {
  return (
    <div className="card stack">
      <h1>Setup needed</h1>
      <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
      <p>
        Run <code>pnpm setup</code> to create <code>configs.md</code>, <code>CV.md</code> and <code>interviewBankStories.md</code> from the
        templates, fill them in, then reload this page.
      </p>
    </div>
  );
}
