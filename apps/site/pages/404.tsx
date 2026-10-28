import { PageView } from "../components/PageView";
import { NOT_FOUND } from "../lib/markdown.mjs";

export const config = { unstable_runtimeJS: false };

export default function NotFound() {
  return <PageView page={NOT_FOUND} />;
}
