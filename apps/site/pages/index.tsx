import { PageView } from "../components/PageView";
import { findPage } from "../lib/markdown.mjs";

// The pages are plain HTML: nothing on them needs JavaScript.
export const config = { unstable_runtimeJS: false };

export default function Home() {
  return <PageView page={findPage("/")!} />;
}
