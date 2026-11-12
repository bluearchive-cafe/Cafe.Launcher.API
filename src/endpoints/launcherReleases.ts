import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const LEGACY_GITHUB_API_URL =
  "https://api.github.com/repos/bluearchive-cafe/Cafe.Launcher.Avalonia_Release/releases";
const CURRENT_GITHUB_API_URL =
  "https://api.github.com/repos/bluearchive-cafe/Cafe.Launcher.Avalonia/releases";

const CACHE_MAX_AGE = 300;
const GITHUB_RELEASES_PER_PAGE = 100;

type ReleaseChannel = "stable" | "beta";

// Mirrors the client's SemVer grammar; also rejects characters that could rewrite an upstream URL.
// Numeric prerelease identifiers must not carry leading zeros ("beta.01" is invalid SemVer).
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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
  body?: string | null;
  assets: GitHubAsset[];
}

interface ReleaseFile {
  name: string;
  url: string;
  size: number;
  checksum: string | null;
  mirrorUrl?: string;
}

interface LauncherRelease {
  version: string;
  releaseDate: string;
  files: ReleaseFile[];
}

interface LatestLauncherRelease extends LauncherRelease {
  channel: ReleaseChannel;
}

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[] | null;
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
  mirrorUrl: z.string().nullable().optional().openapi({
    example:
      "https://download.cafe-launcher.saibamidori.com/v1/downloads/v1.3.1/Cafe.Launcher_v1.3.1_setup.exe",
    description:
      "Mirror download URL; only returned by the v2 endpoint. Clients must fall back to url.",
  }),
});

const LauncherReleaseSchema = z.object({
  version: z.string().openapi({ example: "1.1.0-beta.1" }),
  releaseDate: z.string().openapi({ example: "2026-08-28T10:44:41Z" }),
  files: ReleaseFileSchema.array(),
});

const LatestLauncherReleaseSchema = LauncherReleaseSchema.extend({
  channel: z.enum(["stable", "beta"]).openapi({
    description: "stable returns the newest non-prerelease, beta the newest prerelease.",
  }),
});

const ChannelQuerySchema = z.object({
  channel: z.enum(["stable", "beta"]).default("stable").openapi({
    example: "stable",
    description: "stable returns the newest non-prerelease, beta the newest prerelease.",
  }),
});

const ReleaseNotesSchema = z.object({
  version: z.string().openapi({ example: "1.3.1" }),
  releaseNotes: z.string().openapi({ example: "## Highlights\n\n- Faster updates" }),
});

const VersionParamSchema = z
  .string()
  .regex(VERSION_PATTERN)
  .openapi({ example: "1.3.1", description: "Bare release version, without the leading v" });

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
    return handleReleases(
      c,
      CURRENT_GITHUB_API_URL,
      "github-releases-v5-main",
      true,
      c.env.DOWNLOAD_MIRROR_BASE_URL,
    );
  }
}

/** Newest published release for one channel, so public download pages avoid GitHub rate limits. */
export class LauncherLatestRelease extends OpenAPIRoute {
  schema = {
    tags: ["Launcher"],
    summary: "Get the newest Cafe Launcher release for a channel (edge-cached 5 min)",
    request: {
      query: ChannelQuerySchema,
    },
    responses: {
      "200": {
        description: "Newest release for the requested channel",
        content: {
          "application/json": {
            schema: LatestLauncherReleaseSchema,
          },
        },
      },
      "400": { description: "Invalid channel" },
      "404": { description: "No published release with ready assets for this channel" },
      "502": { description: "GitHub upstream failure" },
    },
  };

  async handle(c: AppContext): Promise<Response> {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const channel = query.channel;
    try {
      const cache = await caches.open("github-latest-release-v1");
      const cacheKey = createChannelCacheKey(c.req.raw, channel);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const githubReleases = await fetchFromGitHub(
        c.env.GITHUB_TOKEN,
        CURRENT_GITHUB_API_URL,
      );
      const latest = selectLatestRelease(
        githubReleases,
        channel,
        c.env.DOWNLOAD_MIRROR_BASE_URL,
      );
      if (!latest) {
        return c.json({ error: "No published release for this channel" }, 404);
      }

      const response = c.json(latest);
      response.headers.set("Cache-Control", `public, max-age=${CACHE_MAX_AGE}`);
      c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      console.error("latest release proxy error:", err);
      return c.json({ error: "Failed to fetch latest release" }, 502);
    }
  }
}

/** One published release's notes by bare version, so clients avoid unauthenticated GitHub calls. */
export class LauncherReleaseNotes extends OpenAPIRoute {
  schema = {
    tags: ["Launcher"],
    summary: "Get one Cafe Launcher release's notes by version (edge-cached 5 min)",
    request: {
      params: z.object({
        version: VersionParamSchema,
      }),
    },
    responses: {
      "200": {
        description: "Release notes markdown",
        content: {
          "application/json": {
            schema: ReleaseNotesSchema,
          },
        },
      },
      "400": { description: "Invalid version" },
      "404": { description: "No published release for this version" },
      "502": { description: "GitHub upstream failure" },
    },
  };

  async handle(c: AppContext): Promise<Response> {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const version = params.version;
    try {
      const cache = await caches.open("github-release-notes-v1");
      const cacheKey = createCacheKey(c.req.raw);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const response = await fetch(
        `${CURRENT_GITHUB_API_URL}/tags/v${encodeURIComponent(version)}`,
        { headers: githubApiHeaders(c.env.GITHUB_TOKEN) },
      );
      if (response.status === 404) return c.json({ error: "Release not found" }, 404);
      if (!response.ok) {
        throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
      }
      const release = await response.json<GitHubRelease>();
      // The PAT can read drafts; the public endpoint must not leak unpublished notes.
      if (release.draft) return c.json({ error: "Release not found" }, 404);

      const result = c.json({ version, releaseNotes: release.body ?? "" });
      result.headers.set("Cache-Control", `public, max-age=${CACHE_MAX_AGE}`);
      c.executionCtx.waitUntil(cache.put(cacheKey, result.clone()));
      return result;
    } catch (err) {
      console.error("release notes proxy error:", err);
      return c.json({ error: "Failed to fetch release notes" }, 502);
    }
  }
}

async function handleReleases(
  c: AppContext,
  githubApiUrl: string,
  cacheName: string,
  filterIncomplete: boolean,
  mirrorBaseUrl?: string,
): Promise<Response> {
  try {
    const cache = await caches.open(cacheName);
    const cacheKey = createCacheKey(c.req.raw);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const githubReleases = await fetchFromGitHub(c.env.GITHUB_TOKEN, githubApiUrl);
    const releases = transformReleases(githubReleases, filterIncomplete, mirrorBaseUrl);

    const response = c.json(releases);
    response.headers.set(
      "Cache-Control",
      `public, max-age=${CACHE_MAX_AGE}`,
    );

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

/** Keeps one cache entry per channel; other query strings are ignored. */
function createChannelCacheKey(request: Request, channel: ReleaseChannel): Request {
  const url = new URL(request.url);
  url.search = `?channel=${channel}`;
  url.hash = "";
  return new Request(url.toString(), { method: "GET" });
}

function githubApiHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Cafe-Launcher-Worker/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
  };
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
      headers: githubApiHeaders(token),
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
  mirrorBaseUrl?: string,
): LauncherRelease[] {
  const mirrorBase = mirrorBaseUrl?.replace(/\/+$/, "");
  return githubReleases
    .filter((release) => !filterIncomplete || !release.draft)
    .map((release) => toLauncherRelease(release, filterIncomplete, mirrorBase));
}

function toLauncherRelease(
  release: GitHubRelease,
  filterIncomplete: boolean,
  mirrorBase?: string,
): LauncherRelease {
  const version = release.tag_name.replace(/^v/, "");
  const assets = (release.assets ?? [])
    .filter((asset) => !filterIncomplete || asset.state === "uploaded");
  const files: ReleaseFile[] = assets.map((asset) => {
    const file: ReleaseFile = {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      checksum: asset.digest ?? null,
    };
    if (mirrorBase) {
      file.mirrorUrl =
        `${mirrorBase}/v1/downloads/v${version}/${encodeURIComponent(asset.name)}`;
    }
    return file;
  });

  return {
    version,
    releaseDate: release.published_at,
    files,
  };
}

/** Picks the highest SemVer release of a channel that already has uploaded assets. */
function selectLatestRelease(
  githubReleases: GitHubRelease[],
  channel: ReleaseChannel,
  mirrorBaseUrl?: string,
): LatestLauncherRelease | null {
  const mirrorBase = mirrorBaseUrl?.replace(/\/+$/, "");
  let latest: { release: LatestLauncherRelease; parsed: ParsedVersion } | null = null;

  for (const githubRelease of githubReleases) {
    if (githubRelease.draft) continue;

    const release = toLauncherRelease(githubRelease, true, mirrorBase);
    const parsed = parseVersion(release.version);
    if (!parsed || release.files.length === 0) continue;
    if (channel === "stable" ? parsed.prerelease !== null : parsed.prerelease === null) {
      continue;
    }
    if (!latest || compareVersions(parsed, latest.parsed) > 0) {
      latest = { release: { channel, ...release }, parsed };
    }
  }

  return latest?.release ?? null;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version);
  if (!match) return null;

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : null,
  };
}

/** SemVer 2.0.0 precedence; a stable release outranks its own prereleases. */
function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  const [leftMajor, leftMinor, leftPatch] = left.core;
  const [rightMajor, rightMinor, rightPatch] = right.core;
  const coreDiff =
    [leftMajor - rightMajor, leftMinor - rightMinor, leftPatch - rightPatch]
      .find((diff) => diff !== 0) ?? 0;
  if (coreDiff !== 0) return coreDiff;

  if (left.prerelease === null || right.prerelease === null) {
    if (left.prerelease === right.prerelease) return 0;
    return left.prerelease === null ? 1 : -1;
  }

  for (const [index, l] of left.prerelease.entries()) {
    const r = right.prerelease[index];
    if (r === undefined) break;

    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff;
    } else if (lNumeric !== rNumeric) {
      return lNumeric ? -1 : 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }

  return left.prerelease.length - right.prerelease.length;
}
