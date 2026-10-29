export type Card = { title: string; text: string; track?: string };
export type Short = { length: string; caption: string; key: string; rest: string };
export type Section = {
  /** How the home page lays the section out: timeline, features, shorts, agents, facts or end. */
  kind?: string;
  h2?: string;
  caption?: string;
  body?: string[];
  note?: string;
  list?: string[];
  /** Lay the list out in columns: for long lists of short items, like languages. */
  columns?: boolean;
  steps?: { title: string; text: string }[];
  /** Things to type into an agent, shown one per line. */
  prompts?: string[];
  cards?: Card[];
  shorts?: Short[];
  h3?: string;
  detail?: string;
  session?: string[];
  download?: boolean;
  pageList?: boolean;
  more?: string;
};
export type Page = {
  path: string;
  /** Its name in the header and footer. */
  nav?: string;
  title: string;
  description: string;
  kicker?: string;
  h1: string;
  lede: string;
  hero?: boolean;
  updated?: string;
  sections: Section[];
};

/** A help page, made from the repo's docs/ folder by scripts/docs.mjs. */
export type Doc = {
  path: string;
  nav: string;
  title: string;
  description: string;
  h1: string;
  updated: string;
  /** The page after its H1, as HTML. */
  html: string;
  markdown: string;
};
