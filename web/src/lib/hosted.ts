/**
 * True when the app is served from somewhere other than the visitor's own machine (for example a Vercel preview).
 * The chain and the AI service always run locally (docs/01: no public network by default), so a hosted copy can show every
 * screen but cannot run the live chain demo unless the visitor starts `npm run dev` themselves.
 */
export const isHosted: boolean = typeof window !== "undefined" && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname);
