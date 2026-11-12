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

describe("GET /api/v2/launcher/releases/:version/notes", () => {
  it("returns the release body for the requested tag", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({
        tag_name: "v1.2.0",
        published_at: "2026-09-22T00:00:00Z",
        body: "## Highlights\n\n- Faster updates",
        assets: [],
      })),
    );

    const response = await requestNotes(
      "https://notes-test.invalid/api/v2/launcher/releases/1.2.0/notes",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toEqual({
      version: "1.2.0",
      releaseNotes: "## Highlights\n\n- Faster updates",
    });
    const upstreamRequest = new Request(
      upstreamFetch.mock.calls[0]?.[0],
      upstreamFetch.mock.calls[0]?.[1],
    );
    expect(upstreamRequest.url).toBe(
      "https://api.github.com/repos/bluearchive-cafe/Cafe.Launcher.Avalonia/releases/tags/v1.2.0",
    );
    expect(upstreamRequest.headers.get("Authorization")).toMatch(/^Bearer /);
  });

  it("accepts prerelease versions and maps a null body to empty notes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({
        tag_name: "v1.4.0-beta.99",
        published_at: "2026-11-01T00:00:00Z",
        body: null,
        assets: [],
      })),
    );

    const response = await requestNotes(
      "https://notes-null-test.invalid/api/v2/launcher/releases/1.4.0-beta.99/notes",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: "1.4.0-beta.99",
      releaseNotes: "",
    });
  });

  it("returns 404 when GitHub has no such release", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ message: "Not Found" }, { status: 404 })),
    );

    const response = await requestNotes(
      "https://notes-404-test.invalid/api/v2/launcher/releases/9.9.9/notes",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("does not expose draft releases through the public endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({
        tag_name: "v2.0.0",
        draft: true,
        published_at: "2026-11-01T00:00:00Z",
        body: "unpublished notes",
        assets: [],
      })),
    );

    const response = await requestNotes(
      "https://notes-draft-test.invalid/api/v2/launcher/releases/2.0.0/notes",
    );

    expect(response.status).toBe(404);
  });

  it("returns 502 when the GitHub upstream fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ message: "rate limited" }, { status: 403 })),
    );

    const response = await requestNotes(
      "https://notes-502-test.invalid/api/v2/launcher/releases/1.2.0/notes",
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects a malformed version without touching GitHub", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch");

    const response = await requestNotes(
      "https://notes-validation-test.invalid/api/v2/launcher/releases/not-a-version/notes",
    );

    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects prerelease identifiers with leading zeros without touching GitHub", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch");

    const response = await requestNotes(
      "https://notes-leading-zero-test.invalid/api/v2/launcher/releases/1.2.0-beta.01/notes",
    );

    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("caches notes per version and ignores query strings", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({
        tag_name: "v1.2.0",
        published_at: "2026-09-22T00:00:00Z",
        body: "notes",
        assets: [],
      })),
    );

    await requestNotes("https://notes-cache-test.invalid/api/v2/launcher/releases/1.2.0/notes?probe=one");
    await requestNotes("https://notes-cache-test.invalid/api/v2/launcher/releases/1.2.0/notes?probe=two");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    await requestNotes("https://notes-cache-test.invalid/api/v2/launcher/releases/1.3.0/notes");
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });
});

async function requestNotes(url: string): Promise<Response> {
  const request = new IncomingRequest(url);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}