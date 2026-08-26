import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/launcher/releases", () => {
  it("returns the GitHub asset checksum", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json([
        {
          tag_name: "v1.0.0",
          published_at: "2026-07-14T00:00:00Z",
          assets: [{
            name: "Cafe.Launcher.Avalonia_v1.0.0_setup.exe",
            browser_download_url: "https://github.com/example/setup.exe",
            size: 123,
            digest: "sha256:abc123",
          }],
        },
      ])),
    );

    const response = await requestReleases(
      "https://checksum-test.invalid/api/launcher/releases",
    );
    const releases = await response.json<Array<{ files: Array<{ checksum: string | null }> }>>();

    expect(releases[0]?.files[0]?.checksum).toBe("sha256:abc123");
  });

  it("shares one cached response across query strings", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json([
        {
          tag_name: "v1.0.0",
          published_at: "2026-07-14T00:00:00Z",
          assets: [],
        },
      ])),
    );

    await requestReleases("https://cache-test.invalid/api/launcher/releases?probe=one");
    await requestReleases("https://cache-test.invalid/api/launcher/releases?probe=two");

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("returns stable releases beyond the first GitHub page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `v2.0.0-beta.${100 - index}`,
      published_at: "2026-07-14T00:00:00Z",
      assets: [],
    }));
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      (input, init) => {
        const request = new Request(input, init);
        const page = new URL(request.url).searchParams.get("page");
        return Promise.resolve(Response.json(
          page === "2"
            ? [{
                tag_name: "v1.9.0",
                published_at: "2026-07-01T00:00:00Z",
                assets: [],
              }]
            : firstPage,
        ));
      },
    );

    const response = await requestReleases(
      "https://pagination-test.invalid/api/launcher/releases",
    );
    const releases = await response.json<Array<{ version: string }>>();

    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(releases).toHaveLength(101);
    expect(releases.at(-1)?.version).toBe("1.9.0");
  });
});

async function requestReleases(url: string): Promise<Response> {
  const request = new IncomingRequest(url);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
