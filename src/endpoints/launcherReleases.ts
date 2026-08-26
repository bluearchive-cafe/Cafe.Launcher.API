import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const GITHUB_API_URL =
  "https://api.github.com/repos/bluearchive-cafe/Cafe.Launcher.Avalonia_Release/releases";

const CACHE_MAX_AGE = 300;
const GITHUB_RELEASES_PER_PAGE = 100;

interface GitHubAsset {
  browser_download_url: string;
  size: number;
  name: string;
  digest: string | null;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
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
    example: "Cafe.Launcher.Avalonia_v1.0.0-beta.1.zip",
  }),
  url: z.string().openapi({ example: "https://github.com/..." }),
  size: z.number().openapi({ example: 79918145 }),
  checksum: z.string().nullable().openapi({
    example: "sha256:24741899cf32870644c73d6f3e20a7d26c8f6325ad1e7d3fea0a79d26c293988",
  }),
});

const LauncherReleaseSchema = z.object({
  version: z.string().openapi({ example: "1.0.0-beta.1" }),
  releaseDate: z.string().openapi({ example: "2026-06-19T06:18:31Z" }),
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
    try {
      const cache = await caches.open("github-releases-v3");
      const cacheKey = createCacheKey(c.req.raw);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const githubReleases = await fetchFromGitHub(c.env.GITHUB_TOKEN);
      const releases = transformReleases(githubReleases);

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
}

// ── Helpers ───────────────────────────────────────────────────────────

function createCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  return new Request(url.toString(), { method: "GET" });
}

async function fetchFromGitHub(token: string): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  let page = 1;
  let pageReleases: GitHubRelease[];

  do {
    const url = new URL(GITHUB_API_URL);
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

function transformReleases(githubReleases: GitHubRelease[]): LauncherRelease[] {
  return githubReleases.map((release) => {
    const assets = release.assets ?? [];
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
