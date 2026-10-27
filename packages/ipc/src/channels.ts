// Channel names on the wire, kept free of zod so the sandboxed preload can
// import them without bundling the schemas.

/** One prefix for every channel, so main can reject anything else. */
export const CHANNEL_PREFIX = "clipcat:";
