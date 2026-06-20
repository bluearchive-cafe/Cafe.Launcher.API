import { fromHono } from "chanfana";
import { Hono } from "hono";
import { LauncherReleases } from "./endpoints/launcherReleases";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Launcher release proxy — fetches GitHub releases with PAT, cached at edge
openapi.get("/api/launcher/releases", LauncherReleases);

// Export the Hono app
export default app;
