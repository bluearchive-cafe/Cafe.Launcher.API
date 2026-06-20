import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const GITHUB_API_URL =
  "https://api.github.com/repos/bluearchive-cafe/Cafe.Launcher.Avalonia_Release/releases?per_page=20";

const CACHE_MAX_AGE = 300;

interface GitHubAsset {
  browser_download_url: string;
  size: number;
  name: string;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  assets: GitHubAsset[];
}

interface ReleaseFile {
  url: string;
  sha512: string;
  size: number;
}

interface LauncherRelease {
  version: string;
  files: ReleaseFile[];
  path: string;
  sha512: string;
  releaseDate: string;
}

// ── OpenAPI response schemas ──────────────────────────────────────────

const ReleaseFileSchema = z.object({
  url: z.string().openapi({ example: "https://github.com/..." }),
  sha512: z.string().openapi({ example: "" }),
  size: z.number().openapi({ example: 12345678 }),
});

const LauncherReleaseSchema = z.object({
  version: z.string().openapi({ example: "1.0.0" }),
  files: ReleaseFileSchema.array(),
  path: z.string().openapi({ example: "Cafe-Launcher-Setup.exe" }),
  sha512: z.string(),
  releaseDate: z.string().openapi({ example: "2025-01-15T12:00:00Z" }),
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
      const cache = await caches.open("github-releases");
      const cached = await cache.match(c.req.raw);
      if (cached) return cached;

      const githubReleases = await fetchFromGitHub(c.env.GITHUB_TOKEN);
      const releases = transformReleases(githubReleases);

      const response = c.json(releases);
      response.headers.set(
        "Cache-Control",
        `public, max-age=${CACHE_MAX_AGE}`,
      );
      response.headers.set("Access-Control-Allow-Origin", "*");

      c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));

      return response;
    } catch (err) {
      console.error("release proxy error:", err);
      return c.json({ error: "Failed to fetch releases" }, 502);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

async function fetchFromGitHub(token: string): Promise<GitHubRelease[]> {
  const res = await fetch(GITHUB_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Cafe-Launcher-Worker/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<GitHubRelease[]>;
}

function transformReleases(githubReleases: GitHubRelease[]): LauncherRelease[] {
  return githubReleases.map((release) => {
    const assets = release.assets ?? [];
    const files: ReleaseFile[] = assets.map((asset) => ({
      url: asset.browser_download_url,
      sha512: "",
      size: asset.size,
    }));

    return {
      version: release.tag_name.replace(/^v/, ""),
      files,
      path: assets[0]?.name ?? "",
      sha512: "",
      releaseDate: release.published_at,
    };
  });
}
