import { notFound } from "next/navigation";
import { PageView } from "../../components/PageView";
import { PAGES, findPage } from "../../lib/markdown.mjs";
import { pageMetadata } from "../../lib/metadata";

type Props = { params: Promise<{ slug: string }> };

// Every page is built ahead of time; any other address is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return PAGES.filter((p) => p.path !== "/").map((p) => ({ slug: p.path.slice(1) }));
}

export async function generateMetadata({ params }: Props) {
  const page = findPage(`/${(await params).slug}`);
  return page ? pageMetadata(page) : {};
}

export default async function Page({ params }: Props) {
  const page = findPage(`/${(await params).slug}`);
  if (!page) notFound();
  return <PageView page={page} />;
}
