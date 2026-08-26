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

describe("GET /api/launcher/operations/resource", () => {
  it("translates notices, events, and banners into the launcher contract", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({
        Notices: [
          {
            NoticeId: 2,
            StartDate: "2026-08-25T15:00:00",
            Url: "https://notice.example/maintenance",
            Title: "维护",
            DisplayOrder: 1,
          },
          {
            NoticeId: 1,
            StartDate: "2026-08-20T15:00:00",
            Url: "https://notice.example/news",
            Title: "新闻",
            DisplayOrder: 0,
          },
        ],
        Events: [{
          NoticeId: 3,
          StartDate: "2026-08-26T15:00:00",
          Url: "https://notice.example/event",
          Title: "活动",
          DisplayOrder: 0,
        }],
        Banners: [{
          BannerId: 4,
          Url: "https://cdn.example/banners/4/",
          FileName: ["banner.png"],
          LinkedLobbyBannerId: 3,
          DisplayOrder: 0,
        }],
      })),
    );

    const response = await requestOperations(
      "https://operations-contract-test.invalid/api/launcher/operations/resource",
    );
    const body = await response.json<{
      code: number;
      data: {
        operations_resource_open: boolean;
        notice_list: Array<{
          notice_type: string;
          notice_detail_list: Array<{
            notice_title: string;
            jump_url: string;
          }>;
        }>;
        operations_banner_list: Array<{
          banner_img: string;
          jump_url: string;
        }>;
      };
    }>();

    expect(response.status).toBe(200);
    expect(body.code).toBe(200);
    expect(body.data.operations_resource_open).toBe(true);
    expect(body.data.notice_list[0]?.notice_type).toBe("公告");
    expect(body.data.notice_list[0]?.notice_detail_list.map((item) => item.notice_title))
      .toEqual(["新闻", "维护"]);
    expect(body.data.notice_list[1]?.notice_type).toBe("活动");
    expect(body.data.operations_banner_list).toEqual([{
      banner_img: "https://cdn.example/banners/4/banner.png",
      jump_url: "https://notice.example/event",
    }]);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("shares one cached response across query strings", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ Notices: [], Events: [], Banners: [] })),
    );

    await requestOperations(
      "https://operations-cache-test.invalid/api/launcher/operations/resource?probe=one",
    );
    await requestOperations(
      "https://operations-cache-test.invalid/api/launcher/operations/resource?probe=two",
    );

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("returns bad gateway when the notice index is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("upstream failure", { status: 503 })),
    );

    const response = await requestOperations(
      "https://operations-error-test.invalid/api/launcher/operations/resource",
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch notice index",
    });
  });
});

async function requestOperations(url: string): Promise<Response> {
  const request = new IncomingRequest(url);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
