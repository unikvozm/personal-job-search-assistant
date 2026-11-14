import { notFound } from "next/navigation";
import { jobsRepo } from "@/lib/db";
import { getPrep } from "@/lib/pipeline/prep";
import { loadStories } from "@/lib/stories";
import { PrepView } from "../../components/PrepView";

export const dynamic = "force-dynamic";

export default async function PrepPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = jobsRepo.get(jobId);
  if (!job) notFound();
  const stories = Object.fromEntries(loadStories().map((s) => [s.id, s.title]));
  return (
    <>
      <h1>Interview prep</h1>
      <p className="sub">
        {job.title} · {job.company} · <a href={job.url} target="_blank" rel="noreferrer">posting</a>
      </p>
      <PrepView jobId={jobId} initial={getPrep(jobId)} storyTitles={stories} />
    </>
  );
}
