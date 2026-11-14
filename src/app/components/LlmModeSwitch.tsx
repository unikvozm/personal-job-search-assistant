"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./api";

export function LlmModeSwitch({ initial }: { initial: "api" | "claude-code" }) {
  const router = useRouter();
  const [mode, setMode] = useState(initial);
  const change = async (next: "api" | "claude-code") => {
    setMode(next);
    await post("/api/settings", { llmMode: next });
    router.refresh();
  };
  return (
    <div className="row">
      <label><input type="radio" checked={mode === "api"} onChange={() => change("api")} /> Anthropic API</label>
      <label><input type="radio" checked={mode === "claude-code"} onChange={() => change("claude-code")} /> Claude plan (Claude Code CLI)</label>
    </div>
  );
}
