import type { Env, SearchItem } from "./types";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

function pickQuarkUrl(item: { url?: string; link?: string | null; share_url?: string | null }): string {
  return (item.share_url || item.link || item.url || "").trim();
}

function normalizeItems(
  list: Array<{ title?: string; url?: string; link?: string | null; share_url?: string | null }>,
  keyword: string
): SearchItem[] {
  const contains = new RegExp(escapeRegex(keyword), "i");
  const items: SearchItem[] = [];
  const dedup = new Set<string>();

  for (const item of list) {
    const title = (item.title || "").trim();
    const url = pickQuarkUrl(item);
    if (!title || !url) {
      continue;
    }
    if (!contains.test(title) && !contains.test(url)) {
      continue;
    }
    if (dedup.has(url)) {
      continue;
    }

    dedup.add(url);
    items.push({ title, url });
    if (items.length >= 20) {
      break;
    }
  }

  return items;
}

async function searchFunletu(keyword: string): Promise<SearchItem[]> {
  const body = {
    keyword,
    page: 1,
    pageSize: 20,
    courseid: 1,
    categoryid: 0,
    filetypeid: 0,
    sortBy: "sort",
    order: "desc",
    offset: 0
  };

  const resp = await fetch("https://b.funletu.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error(`funletu 搜索失败: HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: {
      list?: Array<{ title?: string; url?: string; link?: string | null; share_url?: string | null }>;
    };
  };

  if (data.code !== 200) {
    throw new Error(`funletu 搜索失败: ${data.msg || "未知错误"}`);
  }

  const list = data.data?.list || [];
  return normalizeItems(list, keyword);
}

async function searchCustomApi(env: Env, keyword: string): Promise<SearchItem[]> {
  const base = (env.PANSEARCH_API_BASE_URL || "").trim();
  if (!base) {
    return searchFunletu(keyword);
  }

  const api = new URL("/search", base).toString();
  const body = {
    keyword,
    page: 1,
    pageSize: 20
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };

  if (env.PANSEARCH_API_TOKEN?.trim()) {
    headers["authorization"] = `Bearer ${env.PANSEARCH_API_TOKEN.trim()}`;
  }

  const resp = await fetch(api, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error(`自定义搜索 API 失败: HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: {
      list?: Array<{ title?: string; url?: string; link?: string | null; share_url?: string | null }>;
      items?: Array<{ title?: string; url?: string; link?: string | null; share_url?: string | null }>;
    };
    list?: Array<{ title?: string; url?: string; link?: string | null; share_url?: string | null }>;
    items?: Array<{ title?: string; url?: string; link?: string | null; share_url?: string | null }>;
  };

  if (typeof data.code === "number" && data.code !== 200 && data.code !== 0) {
    throw new Error(`自定义搜索 API 失败: ${data.msg || `code=${data.code}`}`);
  }

  const list = data.data?.list || data.data?.items || data.list || data.items || [];
  return normalizeItems(list, keyword);
}

export async function searchMedia(env: Env, keyword: string): Promise<SearchItem[]> {
  return searchCustomApi(env, keyword);
}

export async function extractQuarkLinksFromPage(pageUrl: string): Promise<string[]> {
  const resp = await fetch(pageUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; CF-Worker-MediaBot/1.0)",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!resp.ok) {
    throw new Error(`详情页抓取失败: ${resp.status}`);
  }

  const html = await resp.text();
  const matches = html.match(/https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:\?[^\s"'<>]+)?/g) || [];
  return [...new Set(matches)];
}
