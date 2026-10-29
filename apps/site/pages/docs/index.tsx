import { HelpView } from "../../components/HelpView";
import type { Doc } from "../../components/types";
import { findPage } from "../../lib/markdown.mjs";

export const config = { unstable_runtimeJS: false };

export default function Help() {
  return <HelpView doc={findPage("/docs") as Doc} />;
}
