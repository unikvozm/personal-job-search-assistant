import type { Config } from "../config";
import type { RawJob } from "../jobs/types";

export interface SourceContext {
  config: Config;
  since: Date;
  log: (message: string) => void;
}

export interface Source {
  name: string;
  fetch(ctx: SourceContext): Promise<RawJob[]>;
}
