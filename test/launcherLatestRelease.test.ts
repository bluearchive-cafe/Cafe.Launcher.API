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

describe("GET /api/v2/launcher/releases/latest", () => {
  it("returns the newest stable release with mirror URLs by default", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json([
        release("v1.10.0", { draft: true }),
        prerelease("v1.11.0-beta.1"),
        release("v1.9.0"),
        release("v1.10.0"),
      ])),
    );

    const response = await requestLatest(
      "https://latest-stable-test.invalid/api/v2/launcher/releases/latest",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const latest = await response.json<{
      channel: string;
      version: string;
      releaseDate: string;
      files: Array<{ name: string; url: string; mirrorUrl?: string; checksum: string | null }>;
    }>();

    expect(latest.channel).toBe("stable");
    expect(latest.version).toBe("1.10.0");
    expect(latest.files).toEqual([{
      name: "Cafe.Launcher_v1.10.0_setup.exe",
      url: "https://github.com/bluearchive-cafe/Cafe.Launcher.Avalonia/releases/download/v1.10.0/Cafe.Launcher_v1.10.0_setup.exe",
      size: 123,
      checksum: "sha256:abc123",
      mirrorUrl:
        "https://download.cafe-launcher.saibamidori.com/v1/downloads/v1.10.0/Cafe.Launcher_v1.10.0_setup.exe",
    }]);
  });

  it("returns the newest prerelease for the beta channel", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json([
        prerelease("v1.11.0-beta.2"),
        release("v1.10.0"),
        prerelease("v1.11.0-beta.10"),
        prerelease("v1.11.0-beta.1"),
      ])),
    );

    const response = await requestLatest(
      "https://latest-beta-test.invalid/api/v2/launcher/releases/latest?channel=beta",
    );

    expect(response.status).toBe(200);
    const latest = await response.json<{ channel: string; version: string }>();
    expect(latest.channel).toBe("beta");
    expect(latest.version).toBe("1.11.0-beta.10");
  });

  it("returns 404 when the channel has no matching release", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json([release("v1.10.0")])),
    );

    const response = await requestLatest(
      "https://latest-beta-404-test.invalid/api/v2/launcher/releases/latest?channel=beta",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("skips releases whose assets are not uploaded yet", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json([
        release("v1.11.0", { assetState: "new" }),
        release("v1.10.0"),
      ])),
    );

    const response = await requestLatest(
      "https://latest-pending-test.invalid/api/v2/launcher/releases/latest",
    );

    expect(response.status).toBe(200);
    expect((await response.json<{ version: string }>()).version).toBe("1.10.0");
  });

  it("ignores releases whose tag is not valid SemVer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json([
        prerelease("v1.11.0-beta.01"),
        release("v1.10.0"),
      ])),
    );

    const response = await requestLatest(
      "https://latest-invalid-semver-test.invalid/api/v2/launcher/releases/latest?channel=beta",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects an unsupported channel", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch");

    const response = await requestLatest(
      "https://latest-invalid-channel-test.invalid/api/v2/launcher/releases/latest?channel=nightly",
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("caches each channel separately and ignores other query strings", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json([
        release("v1.10.0"),
        prerelease("v1.11.0-beta.1"),
      ])),
    );

    await requestLatest(
      "https://latest-cache-test.invalid/api/v2/launcher/releases/latest?probe=one",
    );
    await requestLatest(
      "https://latest-cache-test.invalid/api/v2/launcher/releases/latest?probe=two",
    );
    await requestLatest(
      "https://latest-cache-test.invalid/api/v2/launcher/releases/latest?channel=beta",
    );

    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });
});

function release(
  tag: string,
  options: { draft?: boolean; assetState?: string } = {},
) {
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    published_at: "2026-11-01T00:00:00Z",
    assets: [{
      name: `Cafe.Launcher_${tag}_setup.exe`,
      browser_download_url:
        `https://github.com/bluearchive-cafe/Cafe.Launcher.Avalonia/releases/download/${tag}/Cafe.Launcher_${tag}_setup.exe`,
      size: 123,
      digest: "sha256:abc123",
      state: options.assetState ?? "uploaded",
    }],
  };
}

function prerelease(tag: string) {
  return release(tag);
}

async function requestLatest(url: string): Promise<Response> {
  const request = new IncomingRequest(url);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
