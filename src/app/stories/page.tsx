import { listPendingStories } from "@/lib/pipeline/stories";
import { StoryCards } from "../components/StoryCards";

export const dynamic = "force-dynamic";

export default function StoriesPage() {
  const pending = listPendingStories();
  return (
    <>
      <h1>Story bank: questions for you</h1>
      <p className="sub">
        These application questions had no matching story. Answer in your own words; a STAR draft is generated for you to edit, and it is
        added to interviewBankStories.md only when you approve it.
      </p>
      {pending.length === 0 ? <p className="muted">No open questions.</p> : <StoryCards items={pending} />}
    </>
  );
}
