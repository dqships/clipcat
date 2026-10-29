import type { GetStaticPaths, GetStaticProps } from "next";
import { PageView } from "../components/PageView";
import type { Page } from "../components/types";
import { PAGES, findPage } from "../lib/markdown.mjs";

export const config = { unstable_runtimeJS: false };

type Props = { slug: string };

// Every page is built ahead of time; any other address is a 404.
export const getStaticPaths: GetStaticPaths = () => ({
  paths: PAGES.filter((p) => p.path !== "/").map((p) => ({ params: { slug: p.path.slice(1) } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<Props> = ({ params }) => ({ props: { slug: String(params!.slug) } });

export default function Page({ slug }: Props) {
  return <PageView page={findPage(`/${slug}`) as Page} />;
}
