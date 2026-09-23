import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const LEGACY_GITHUB_API_URL =
  "https://api.github.com/repos/bluearchive-cafe/Cafe.Launcher.Avalonia_Release/releases";
const CURRENT_GITHUB_API_URL =
  "https://api.github.com/repos/bluearchive-cafe/Cafe.Launcher.Avalonia/releases";

const CACHE_MAX_AGE = 300;
const GITHUB_RELEASES_PER_PAGE = 100;

interface GitHubAsset {
  browser_download_url: string;
  size: number;
  name: string;
  digest: string | null;
  state?: string;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  draft?: boolean;
  assets: GitHubAsset[];
}

interface ReleaseFile {
  name: string;
  url: string;
  size: number;
  checksum: string | null;
}

interface LauncherRelease {
  version: string;
  releaseDate: string;
  files: ReleaseFile[];
}

// ── OpenAPI response schemas ──────────────────────────────────────────

const ReleaseFileSchema = z.object({
  name: z.string().openapi({
    example: "Cafe.Launcher.Avalonia_v1.1.0-beta.1_win-x64.zip",
  }),
  url: z.string().openapi({
    example:
      "https://github.com/bluearchive-cafe/Cafe.Launcher.Avalonia_Release/releases/download/v1.1.0-beta.1/Cafe.Launcher.Avalonia_v1.1.0-beta.1_win-x64.zip",
  }),
  size: z.number().openapi({ example: 79796626 }),
  checksum: z.string().nullable().openapi({
    example: "sha256:630916b5e2717bb78bad7b219c2abc7665733e00cabab759a69d59b08901d8a0",
  }),
});

const LauncherReleaseSchema = z.object({
  version: z.string().openapi({ example: "1.1.0-beta.1" }),
  releaseDate: z.string().openapi({ example: "2026-08-28T10:44:41Z" }),
  files: ReleaseFileSchema.array(),
});

// ── Route handler ─────────────────────────────────────────────────────

export class LauncherReleases extends OpenAPIRoute {
  schema = {
    tags: ["Launcher"],
    summary: "Get latest Cafe Launcher releases from GitHub (edge-cached 5 min)",
    responses: {
      "200": {
        description: "List of launcher releases",
        content: {
          "application/json": {
            schema: LauncherReleaseSchema.array(),
          },
        },
      },
    },
  };

  async handle(c: AppContext): Promise<Response> {
    return handleReleases(c, LEGACY_GITHUB_API_URL, "github-releases-v3", false);
  }
}

/** Versioned release feed backed by the application repository. */
export class LauncherReleasesV2 extends LauncherReleases {
  override async handle(c: AppContext): Promise<Response> {
    return handleReleases(c, CURRENT_GITHUB_API_URL, "github-releases-v4-main", true);
  }
}

async function handleReleases(
  c: AppContext,
  githubApiUrl: string,
  cacheName: string,
  filterIncomplete: boolean,
): Promise<Response> {
  try {
    const cache = await caches.open(cacheName);
    const cacheKey = createCacheKey(c.req.raw);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const githubReleases = await fetchFromGitHub(c.env.GITHUB_TOKEN, githubApiUrl);
    const releases = transformReleases(githubReleases, filterIncomplete);

    const response = c.json(releases);
    response.headers.set(
      "Cache-Control",
      `public, max-age=${CACHE_MAX_AGE}`,
    );
    response.headers.set("Access-Control-Allow-Origin", "*");

    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  } catch (err) {
    console.error("release proxy error:", err);
    return c.json({ error: "Failed to fetch releases" }, 502);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function createCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  return new Request(url.toString(), { method: "GET" });
}

async function fetchFromGitHub(token: string, githubApiUrl: string): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  let page = 1;
  let pageReleases: GitHubRelease[];

  do {
    const url = new URL(githubApiUrl);
    url.searchParams.set("per_page", GITHUB_RELEASES_PER_PAGE.toString());
    url.searchParams.set("page", page.toString());
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Cafe-Launcher-Worker/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    }

    pageReleases = await response.json<GitHubRelease[]>();
    releases.push(...pageReleases);
    page++;
  } while (pageReleases.length === GITHUB_RELEASES_PER_PAGE);

  return releases;
}

function transformReleases(
  githubReleases: GitHubRelease[],
  filterIncomplete: boolean,
): LauncherRelease[] {
  return githubReleases
    .filter((release) => !filterIncomplete || !release.draft)
    .map((release) => {
      const assets = (release.assets ?? [])
        .filter((asset) => !filterIncomplete || asset.state === "uploaded");
      const files: ReleaseFile[] = assets.map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size,
        checksum: asset.digest ?? null,
      }));

      return {
        version: release.tag_name.replace(/^v/, ""),
        releaseDate: release.published_at,
        files,
      };
    });
}
