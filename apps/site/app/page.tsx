import { PageView } from "../components/PageView";
import { findPage } from "../lib/markdown.mjs";
import { pageMetadata } from "../lib/metadata";

const page = findPage("/")!;

export const metadata = pageMetadata(page);

export default function Home() {
  return <PageView page={page} />;
}
