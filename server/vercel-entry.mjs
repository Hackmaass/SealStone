// Vercel's entrypoint for the server service. It must exist before the build runs, so it is a committed stub; the real server is
// compiled into dist/index.mjs by `npm run bundle` (the service's build command, see scripts/bundle-server.mjs).
export { default } from "./dist/index.mjs";
