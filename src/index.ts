import { extractQuarkLinksFromPage, searchMedia } from "./source";
import {
  checkQuarkHealth,
  deleteFilesFromQuark,
  listTargetFolderFiles,
  pollQuarkQrLogin,
  saveToQuark,
  startQuarkQrLogin
} from "./quark";
import type { Env, SaveResponse, SearchResponse } from "./types";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-quark-cookie, x-quark-target-dir"
    }
  });
}

async function readBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("请求体必须是 JSON");
  }
}

function isApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function getQuarkOverrides(request: Request): { quarkCookie?: string; quarkTargetDir?: string } {
  const quarkCookie = (request.headers.get("x-quark-cookie") || "").trim();
  const rawQuarkTargetDir = (request.headers.get("x-quark-target-dir") || "").trim();
  let quarkTargetDir = rawQuarkTargetDir;
  if (rawQuarkTargetDir) {
    try {
      quarkTargetDir = decodeURIComponent(rawQuarkTargetDir);
    } catch {
      quarkTargetDir = rawQuarkTargetDir;
    }
  }
  return {
    ...(quarkCookie ? { quarkCookie } : {}),
    ...(quarkTargetDir ? { quarkTargetDir } : {})
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && isApi(url.pathname)) {
      return json({ ok: true }, 204);
    }

    if (request.method === "POST" && url.pathname === "/api/search") {
      try {
        const body = await readBody<{ keyword?: string }>(request);
        const keyword = (body.keyword || "").trim();
        if (!keyword) {
          return json({ error: "keyword 不能为空" }, 400);
        }

        const items = await searchMedia(env, keyword);
        const data: SearchResponse = { items };
        return json(data);
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      try {
        const quark = await checkQuarkHealth(env, getQuarkOverrides(request));
        return json({
          ok: true,
          time: new Date().toISOString(),
          quark
        });
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/quark/files") {
      try {
        const fid = (url.searchParams.get("fid") || "").trim();
        const data = await listTargetFolderFiles(env, getQuarkOverrides(request), fid || undefined);
        return json(data);
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/quark/delete") {
      try {
        const body = await readBody<{ fids?: string[] }>(request);
        const fids = Array.isArray(body.fids) ? body.fids : [];
        if (!fids.length) {
          return json({ error: "fids 不能为空" }, 400);
        }
        const data = await deleteFilesFromQuark(env, fids, getQuarkOverrides(request));
        return json(data);
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/quark/qr/start") {
      try {
        const data = await startQuarkQrLogin();
        return json(data);
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/quark/qr/poll") {
      try {
        const body = await readBody<{ token?: string; sessionCookie?: string; requestId?: string }>(request);
        const token = (body.token || "").trim();
        if (!token) {
          return json({ error: "token 不能为空" }, 400);
        }
        const data = await pollQuarkQrLogin(
          env,
          token,
          (body.sessionCookie || "").trim(),
          (body.requestId || "").trim(),
          getQuarkOverrides(request)
        );
        return json(data);
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/quark/save-batch") {
      try {
        const body = await readBody<{ shareUrls?: string[] }>(request);
        const shareUrls = Array.isArray(body.shareUrls)
          ? body.shareUrls.map((x) => (x || "").trim()).filter(Boolean)
          : [];
        if (!shareUrls.length) {
          return json({ error: "shareUrls 不能为空" }, 400);
        }

        const overrides = getQuarkOverrides(request);
        const results: Array<{
          inputUrl: string;
          pickedShareUrl?: string;
          ok: boolean;
          data?: SaveResponse;
          error?: string;
        }> = [];

        for (const inputUrl of shareUrls) {
          try {
            const pickedShareUrl = /https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/.test(inputUrl)
              ? inputUrl
              : (await extractQuarkLinksFromPage(inputUrl))[0];
            if (!pickedShareUrl) {
              results.push({
                inputUrl,
                ok: false,
                error: "详情页没有找到 Quark 链接"
              });
              continue;
            }

            const data = await saveToQuark(env, pickedShareUrl, overrides);
            results.push({
              inputUrl,
              pickedShareUrl,
              ok: true,
              data
            });
          } catch (err) {
            results.push({
              inputUrl,
              ok: false,
              error: (err as Error).message
            });
          }
        }

        const success = results.filter((x) => x.ok).length;
        return json({
          total: results.length,
          success,
          failed: results.length - success,
          results
        });
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "GET") {
      return env.ASSETS.fetch(request);
    }

    return json({ error: "Not found" }, 404);
  }
};
