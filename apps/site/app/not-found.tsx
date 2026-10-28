import { PageView } from "../components/PageView";
import { NOT_FOUND } from "../lib/markdown.mjs";
import { pageMetadata } from "../lib/metadata";

export const metadata = pageMetadata(NOT_FOUND);

export default function NotFound() {
  return <PageView page={NOT_FOUND} />;
}
