import { redirect } from "next/navigation";

/** The tracker now lives on the Applied tab. */
export default function TrackerPage() {
  redirect("/applied");
}
