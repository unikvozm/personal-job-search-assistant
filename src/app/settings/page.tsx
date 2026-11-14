import { llmMode } from "@/lib/llm";
import { spendByStep, spentToday } from "@/lib/llm/cost";
import { tryConfig } from "@/lib/server";
import { describeSources } from "@/lib/sources";
import { LlmModeSwitch } from "../components/LlmModeSwitch";
import { SetupNotice } from "../components/SetupNotice";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const { config, error } = tryConfig();
  if (!config) return <SetupNotice error={error} />;
  const spend = spendByStep(30);
  const hasKey = !!process.env.ANTHROPIC_API_KEY;

  return (
    <>
      <h1>Settings</h1>
      <p className="sub">Everything else lives in configs.md.</p>

      <div className="card stack">
        <h2 style={{ marginTop: 0 }}>How Claude runs</h2>
        <LlmModeSwitch initial={llmMode(config)} />
        <p className="small muted">
          <strong>API</strong>: pay per token, cheapest models per step ({config.llm.models.score} for scoring, {config.llm.models.write} for writing), batch scoring, daily cap ${config.llm.dailyBudgetUsd}.
          {!hasKey && <span className="warn"> ANTHROPIC_API_KEY is not set in .env.local.</span>}
          <br />
          <strong>Claude plan</strong>: runs the same prompts through the Claude Code CLI ({config.llm.claudeBin}); no API cost, uses your plan&apos;s limits, slower.
        </p>
      </div>

      <h2>API spend</h2>
      <p>Today: ${spentToday().toFixed(3)} of ${config.llm.dailyBudgetUsd}</p>
      {spend.length > 0 && (
        <table className="table">
          <thead><tr><th>Step (last 30 days)</th><th>Calls</th><th>Cost</th></tr></thead>
          <tbody>{spend.map((s) => <tr key={s.step}><td>{s.step}</td><td>{s.calls}</td><td>${s.cost.toFixed(3)}</td></tr>)}</tbody>
        </table>
      )}

      <h2>Job sources for your countries</h2>
      <p className="small muted">Countries: {config.search.countries.join(", ")} · work modes: {config.search.workModes.join(", ")} · {config.search.targetCompanies.length} target companies</p>
      <ul>{describeSources(config).map((s) => <li key={s}>{s}</li>)}</ul>
    </>
  );
}
