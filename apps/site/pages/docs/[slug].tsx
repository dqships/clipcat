import type { GetStaticPaths, GetStaticProps } from "next";
import { HelpView } from "../../components/HelpView";
import type { Doc } from "../../components/types";
import { DOCS, findPage } from "../../lib/markdown.mjs";

export const config = { unstable_runtimeJS: false };

type Props = { slug: string };

// Every help page is built ahead of time; any other address is a 404.
export const getStaticPaths: GetStaticPaths = () => ({
  paths: DOCS.filter((d) => d.path !== "/docs").map((d) => ({ params: { slug: d.path.slice("/docs/".length) } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<Props> = ({ params }) => ({ props: { slug: String(params!.slug) } });

export default function HelpPage({ slug }: Props) {
  return <HelpView doc={findPage(`/docs/${slug}`) as Doc} />;
}
