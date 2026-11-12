import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { LauncherOperationsResource } from "./endpoints/launcherOperationsResource";
import {
	LauncherLatestRelease,
	LauncherReleaseNotes,
	LauncherReleases,
	LauncherReleasesV2,
} from "./endpoints/launcherReleases";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Public read-only API: allow browser clients on every response, including errors.
app.use("*", cors());

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Launcher release proxy — fetches GitHub releases with PAT, cached at edge
openapi.get("/api/launcher/releases", LauncherReleases);
openapi.get("/api/v2/launcher/releases", LauncherReleasesV2);
openapi.get("/api/v2/launcher/releases/latest", LauncherLatestRelease);
openapi.get("/api/v2/launcher/releases/:version/notes", LauncherReleaseNotes);
openapi.get("/api/launcher/operations/resource", LauncherOperationsResource);

// Export the Hono app
export default app;
