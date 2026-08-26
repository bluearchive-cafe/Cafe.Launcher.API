import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const NOTICE_INDEX_URL =
  "https://prod-noticeindex.bluearchive.cafe/prod/index.json";
const CACHE_NAME = "launcher-operations-resource-v1";
const CACHE_MAX_AGE = 300;

const NoticeIndexItemSchema = z.object({
  NoticeId: z.number().optional().default(0),
  StartDate: z.string().optional().default(""),
  EndDate: z.string().optional().default(""),
  Url: z.string().optional().default(""),
  Title: z.string().optional().default(""),
  DisplayOrder: z.number().optional().default(0),
});

const BannerIndexItemSchema = z.object({
  BannerId: z.number().optional().default(0),
  StartDate: z.string().optional().default(""),
  EndDate: z.string().optional().default(""),
  Url: z.string().optional().default(""),
  FileName: z.array(z.string()).optional().default([]),
  LinkedLobbyBannerId: z.number().optional().default(0),
  BannerDisplayType: z.number().optional().default(0),
  DisplayOrder: z.number().optional().default(0),
});

const NoticeIndexSchema = z.object({
  Notices: z.array(NoticeIndexItemSchema).optional().default([]),
  Events: z.array(NoticeIndexItemSchema).optional().default([]),
  Banners: z.array(BannerIndexItemSchema).optional().default([]),
});

type NoticeIndex = z.infer<typeof NoticeIndexSchema>;

interface NoticeDetail {
  notice_time: string;
  jump_url: string;
  notice_title: string;
}

interface NoticeGroup {
  notice_type: string;
  notice_detail_list: NoticeDetail[];
}

interface OperationsResource {
  operations_resource_open: boolean;
  banner_loop: boolean;
  time_interval: number;
  operations_banner_list: Array<{
    banner_img: string;
    jump_url: string;
  }>;
  news_list: null;
  notice_list: NoticeGroup[];
}

const NoticeDetailSchema = z.object({
  notice_time: z.string().openapi({ example: "2026-08-25T15:00:00" }),
  jump_url: z.string().openapi({
    example: "https://prod-notice.bluearchive.cafe/prod/1055/index.html",
  }),
  notice_title: z.string().openapi({ example: "维护" }),
});

const NoticeGroupSchema = z.object({
  notice_type: z.string().openapi({ example: "公告" }),
  notice_detail_list: NoticeDetailSchema.array(),
});

const OperationsResourceSchema = z.object({
  operations_resource_open: z.boolean(),
  banner_loop: z.boolean(),
  time_interval: z.number(),
  operations_banner_list: z
    .object({
      banner_img: z.string(),
      jump_url: z.string(),
    })
    .array(),
  news_list: z.null(),
  notice_list: NoticeGroupSchema.array(),
});

const OperationsEnvelopeSchema = z.object({
  code: z.number().openapi({ example: 200 }),
  message: z.string().openapi({ example: "success" }),
  data: OperationsResourceSchema,
});

export class LauncherOperationsResource extends OpenAPIRoute {
  schema = {
    tags: ["Launcher"],
    summary: "Translate the Blue Archive notice index to the launcher API contract",
    responses: {
      "200": {
        description: "Launcher-compatible operations and notice resources",
        content: {
          "application/json": {
            schema: OperationsEnvelopeSchema,
          },
        },
      },
    },
  };

  async handle(c: AppContext): Promise<Response> {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cacheKey = createCacheKey(c.req.raw);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const noticeIndex = await fetchNoticeIndex();
      const response = c.json({
        code: 200,
        message: "success",
        data: transformNoticeIndex(noticeIndex),
      });
      response.headers.set(
        "Cache-Control",
        `public, max-age=${CACHE_MAX_AGE}`,
      );
      response.headers.set("Access-Control-Allow-Origin", "*");

      c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      console.error("launcher operations resource proxy error:", err);
      return c.json({ error: "Failed to fetch notice index" }, 502);
    }
  }
}

function createCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  return new Request(url.toString(), { method: "GET" });
}

async function fetchNoticeIndex(): Promise<NoticeIndex> {
  const response = await fetch(NOTICE_INDEX_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Cafe-Launcher-Worker/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Notice index ${response.status}: ${await response.text()}`,
    );
  }

  const parsed = NoticeIndexSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Notice index has an incompatible JSON shape.");
  }

  return parsed.data;
}

function transformNoticeIndex(index: NoticeIndex): OperationsResource {
  const notices = sortByDisplayOrder(index.Notices).map(toNoticeDetail);
  const events = sortByDisplayOrder(index.Events).map(toNoticeDetail);

  return {
    operations_resource_open: true,
    banner_loop: true,
    time_interval: 5,
    operations_banner_list: sortByDisplayOrder(index.Banners).map((banner) => ({
      banner_img: resolveBannerImageUrl(banner.Url, banner.FileName[0]),
      jump_url: resolveLinkedNoticeUrl(
        banner.LinkedLobbyBannerId,
        index.Notices,
        index.Events,
      ),
    })),
    news_list: null,
    notice_list: [
      { notice_type: "公告", notice_detail_list: notices },
      { notice_type: "活动", notice_detail_list: events },
    ].filter((group) => group.notice_detail_list.length > 0),
  };
}

function sortByDisplayOrder<T extends { DisplayOrder: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.DisplayOrder - right.DisplayOrder);
}

function toNoticeDetail(item: z.infer<typeof NoticeIndexItemSchema>): NoticeDetail {
  return {
    notice_time: item.StartDate,
    jump_url: item.Url,
    notice_title: item.Title,
  };
}

function resolveBannerImageUrl(baseUrl: string, fileName: string | undefined): string {
  if (!baseUrl || !fileName) return "";

  try {
    return new URL(fileName, baseUrl).toString();
  } catch {
    return "";
  }
}

function resolveLinkedNoticeUrl(
  linkedNoticeId: number,
  notices: z.infer<typeof NoticeIndexItemSchema>[],
  events: z.infer<typeof NoticeIndexItemSchema>[],
): string {
  const linkedNotice = [...notices, ...events].find(
    (item) => item.NoticeId === linkedNoticeId,
  );
  return linkedNotice?.Url ?? "";
}
