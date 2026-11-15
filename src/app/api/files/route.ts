import fs from "node:fs";
import path from "node:path";
import { paths } from "@/lib/paths";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

/** Serves resumes, screenshots and reports from data/ and the ready CVs in cvs/. ?path=<absolute path> */
export function GET(req: Request) {
  const requested = new URL(req.url).searchParams.get("path") ?? "";
  const resolved = path.resolve(requested);
  const type = TYPES[path.extname(resolved)];
  const allowed = [paths.data, paths.cvs].some((dir) => resolved.startsWith(dir + path.sep));
  if (!allowed || !type || !fs.existsSync(resolved)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(fs.readFileSync(resolved), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
