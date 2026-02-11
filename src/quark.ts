import type { Env, QuarkFolderItem, SaveResponse } from "./types";

interface QuarkApiResp<T> {
  status?: number;
  code?: number;
  message?: string;
  data?: T;
}

interface TokenData {
  stoken: string;
}

interface DetailData {
  share: {
    title: string;
  };
  list: Array<{
    fid: string;
    share_fid_token?: string;
    fid_token?: string;
  }>;
}

interface SaveData {
  task_id?: string;
  save_as?: {
    save_as_top_fids?: string[];
  };
}

interface FolderListData {
  list?: Array<{
    fid?: string;
    file_name?: string;
    dir?: boolean;
    file_type?: number;
    size?: number;
    file_size?: number;
    obj_size?: number;
    size_str?: string;
  }>;
}

interface DeleteData {
  task_id?: string;
}

interface QrStartResponse {
  token: string;
  qrUrl: string;
  sessionCookie?: string;
  requestId?: string;
}

interface QrPollResponse {
  status: "pending" | "expired" | "success";
  message?: string;
  cookie?: string;
  rawStatus?: number | string;
  rawMessage?: string;
}

interface SaveOverrides {
  quarkCookie?: string;
  quarkTargetDir?: string;
}

let lastQuarkCallAt = 0;
const QUARK_MIN_INTERVAL_MS = 350;

function required(input: string | undefined, key: string): string {
  if (!input) {
    throw new Error(`缺少配置: ${key}`);
  }
  return input;
}

function getRuntime(env: Env, overrides?: SaveOverrides): { cookie: string; pr: string; fr: string } {
  const overrideCookie = overrides?.quarkCookie?.trim();
  const rawCookie = overrideCookie || required(env.QUARK_COOKIE, "QUARK_COOKIE");
  // Normalize copied cookie text (some UIs copy with line breaks).
  const cookie = rawCookie.replace(/\r?\n/g, "").trim();
  return {
    cookie,
    pr: env.QUARK_PR || "ucpro",
    fr: env.QUARK_FR || "pc"
  };
}

function getQrRuntime(
  env: Env,
  overrides?: SaveOverrides
): { cookie: string; pr: string; fr: string } {
  const overrideCookie = overrides?.quarkCookie?.trim();
  const fallbackCookie = (env.QUARK_COOKIE || "").trim();
  const rawCookie = overrideCookie || fallbackCookie;
  return {
    cookie: rawCookie.replace(/\r?\n/g, "").trim(),
    pr: env.QUARK_PR || "ucpro",
    fr: env.QUARK_FR || "pc"
  };
}

function parsePwdId(shareUrl: string): string {
  const hit = shareUrl.match(/\/s\/([a-zA-Z0-9]+)/);
  if (!hit) {
    throw new Error("非法 quark 分享链接");
  }
  return hit[1];
}

function getPasscodeFromShareUrl(shareUrl: string): string {
  const tryDecode = (input: string): string => {
    try {
      return decodeURIComponent(input);
    } catch {
      return input;
    }
  };

  const trySearchParams = (urlText: string): string => {
    try {
      const url = new URL(urlText);
      const keys = ["pwd", "passcode", "code", "p"];
      for (const key of keys) {
        const value = (url.searchParams.get(key) || "").trim();
        if (value) {
          return tryDecode(value);
        }
      }
      if (url.hash.includes("=")) {
        const hash = url.hash.replace(/^#/, "");
        const hashParams = new URLSearchParams(hash);
        for (const key of keys) {
          const value = (hashParams.get(key) || "").trim();
          if (value) {
            return tryDecode(value);
          }
        }
      }
      return "";
    } catch {
      return "";
    }
  };

  const fromSearch = trySearchParams(shareUrl);
  if (fromSearch) {
    return fromSearch;
  }

  const hit = shareUrl.match(/[?&#](?:pwd|passcode|code|p)=([^&#]+)/i);
  if (hit?.[1]) {
    return tryDecode(hit[1].trim());
  }

  return "";
}

function quarkHeaders(cookie: string): HeadersInit {
  return {
    cookie,
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    origin: "https://pan.quark.cn",
    referer: "https://pan.quark.cn/",
    "user-agent": "Mozilla/5.0 (compatible; CF-Worker-MediaBot/1.0)"
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleQuarkCall(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastQuarkCallAt + QUARK_MIN_INTERVAL_MS - now);
  if (wait > 0) {
    await sleep(wait);
  }
  lastQuarkCallAt = Date.now();
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

async function callQuark<T>(
  input: RequestInfo,
  init: RequestInit,
  stage: string
): Promise<QuarkApiResp<T>> {
  const delays = [0, 500, 1300, 2600];
  let lastError: Error | undefined;

  for (let i = 0; i < delays.length; i += 1) {
    if (delays[i] > 0) {
      await sleep(delays[i]);
    }

    try {
      await throttleQuarkCall();
      const resp = await fetch(input, init);

      if (!resp.ok) {
        if (i < delays.length - 1 && shouldRetry(resp.status)) {
          continue;
        }
        const respText = (await resp.text()).trim().replace(/\s+/g, " ").slice(0, 240);
        const suffix = respText ? ` - ${respText}` : "";
        throw new Error(`${stage} 失败: HTTP ${resp.status}${suffix}`);
      }

      const data = (await resp.json()) as QuarkApiResp<T>;
      if ((data.code && data.code !== 0) || (data.status && data.status >= 400)) {
        throw new Error(`${stage} 失败: ${data.message || `code=${data.code || data.status}`}`);
      }
      return data;
    } catch (err) {
      lastError = err as Error;
      if (i >= delays.length - 1) {
        break;
      }
    }
  }

  throw new Error(lastError?.message || `${stage} 失败`);
}

async function pollTaskDone(cookie: string, taskId: string, pr: string, fr: string): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    const url = new URL("https://drive-pc.quark.cn/1/clouddrive/task");
    url.searchParams.set("task_id", taskId);
    url.searchParams.set("retry_index", String(i));
    url.searchParams.set("pr", pr);
    url.searchParams.set("fr", fr);

    const data = await callQuark<{ status?: number }>(
      url.toString(),
      {
        method: "GET",
        headers: quarkHeaders(cookie)
      },
      "查询任务"
    );

    const status = data.data?.status;
    // 2: success (completed)
    if (status === 2) {
      return;
    }
    // 1: running / processing
    if (status === 1) {
      await sleep(1000);
      continue;
    }
    if (typeof status === "number" && status !== 0) {
      throw new Error(`任务执行失败: status=${status}`);
    }

    await sleep(1000);
  }

  throw new Error("任务超时未完成，请稍后刷新目录重试");
}

function normalizeDirPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  const noDupSlash = trimmed.replace(/\/+/g, "/");
  return noDupSlash.startsWith("/") ? noDupSlash : `/${noDupSlash}`;
}

function splitSetCookie(headerValue: string): string[] {
  // Split multiple Set-Cookie values while preserving Expires commas.
  return headerValue
    .split(/,(?=\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=)/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function toCookiePair(setCookieValue: string): string | undefined {
  const firstPart = setCookieValue.split(";")[0]?.trim();
  if (!firstPart || !firstPart.includes("=")) {
    return undefined;
  }
  const [name, ...rest] = firstPart.split("=");
  const value = rest.join("=");
  if (!name || !value) {
    return undefined;
  }
  if (/^deleted$/i.test(value)) {
    return undefined;
  }
  return `${name}=${value}`;
}

function getSetCookieValues(headers: Headers): string[] {
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const raw = headers.get("set-cookie");
  if (!raw) {
    return [];
  }
  return splitSetCookie(raw);
}

function mergeCookies(existingCookie: string, setCookieValues: string[]): string {
  const jar = new Map<string, string>();

  existingCookie
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx <= 0) {
        return;
      }
      jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    });

  for (const setCookie of setCookieValues) {
    const pair = toCookiePair(setCookie);
    if (!pair) {
      continue;
    }
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }

  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function formatBytes(value?: number): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return undefined;
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
}

async function resolveTargetFolderFid(
  cookie: string,
  pr: string,
  fr: string,
  targetDir?: string,
  fallbackFid?: string
): Promise<string> {
  const raw = (targetDir || "").trim();
  if (!raw) {
    return required(fallbackFid, "QUARK_TARGET_FOLDER_ID");
  }

  if (/^\d+$/.test(raw)) {
    return raw;
  }

  const dirPath = normalizeDirPath(raw);
  if (dirPath === "/") {
    return "0";
  }

  const url = new URL("https://drive-pc.quark.cn/1/clouddrive/file");
  url.searchParams.set("pr", pr);
  url.searchParams.set("fr", fr);
  url.searchParams.set("uc_param_str", "");

  const resp = await callQuark<{ fid?: string }>(
    url.toString(),
    {
      method: "POST",
      headers: quarkHeaders(cookie),
      body: JSON.stringify({
        pdir_fid: "0",
        file_name: "",
        dir_path: dirPath,
        dir_init_lock: false
      })
    },
    "创建/定位目标目录"
  );

  const fid = resp.data?.fid;
  if (!fid) {
    throw new Error("未获取到目标目录 fid");
  }
  return fid;
}

export async function saveToQuark(
  env: Env,
  shareUrl: string,
  overrides?: SaveOverrides
): Promise<SaveResponse> {
  const { cookie, pr, fr } = getRuntime(env, overrides);
  const toPdirFid = await resolveTargetFolderFid(
    cookie,
    pr,
    fr,
    overrides?.quarkTargetDir,
    env.QUARK_TARGET_FOLDER_ID
  );

  const pwdId = parsePwdId(shareUrl);
  const passcode = getPasscodeFromShareUrl(shareUrl);

  const tokenUrl = new URL("https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token");
  tokenUrl.searchParams.set("pr", pr);
  tokenUrl.searchParams.set("fr", fr);

  const tokenResp = await callQuark<TokenData>(
    tokenUrl.toString(),
    {
      method: "POST",
      headers: quarkHeaders(cookie),
      body: JSON.stringify({ pwd_id: pwdId, passcode })
    },
    "获取分享 Token"
  );

  const stoken = tokenResp.data?.stoken;
  if (!stoken) {
    throw new Error("未拿到 stoken，请检查分享链接是否需要提取码");
  }

  const detailUrl = new URL("https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail");
  detailUrl.searchParams.set("pwd_id", pwdId);
  detailUrl.searchParams.set("stoken", stoken);
  detailUrl.searchParams.set("pdir_fid", "0");
  detailUrl.searchParams.set("_page", "1");
  detailUrl.searchParams.set("_size", "50");
  detailUrl.searchParams.set("_fetch_banner", "0");
  detailUrl.searchParams.set("_fetch_share", "1");
  detailUrl.searchParams.set("_fetch_total", "1");
  detailUrl.searchParams.set("_sort", "file_type:asc,file_name:asc");
  detailUrl.searchParams.set("pr", pr);
  detailUrl.searchParams.set("fr", fr);

  const detailResp = await callQuark<DetailData>(
    detailUrl.toString(),
    {
      method: "GET",
      headers: quarkHeaders(cookie)
    },
    "读取分享详情"
  );

  const detailList = detailResp.data?.list || [];
  const fidList = detailList.map((x) => x.fid).filter(Boolean);
  if (!fidList.length) {
    throw new Error("分享内没有可转存文件");
  }

  const fidTokenList = detailList.map((x) => x.share_fid_token || x.fid_token || "");
  const payload = {
    fid_list: fidList,
    fid_token_list: fidTokenList,
    to_pdir_fid: toPdirFid,
    pwd_id: pwdId,
    stoken,
    pdir_fid: "0",
    scene: "link"
  };
  const saveHosts = ["https://drive-pc.quark.cn", "https://drive.quark.cn"];
  let saveResp: QuarkApiResp<SaveData> | undefined;
  let lastSaveError: Error | undefined;

  for (const host of saveHosts) {
    const saveUrl = new URL(`${host}/1/clouddrive/share/sharepage/save`);
    saveUrl.searchParams.set("pr", pr);
    saveUrl.searchParams.set("fr", fr);
    saveUrl.searchParams.set("uc_param_str", "");
    saveUrl.searchParams.set("app", "clouddrive");
    saveUrl.searchParams.set("__dt", String(Math.floor((1 + Math.random() * 4) * 60 * 1000)));
    saveUrl.searchParams.set("__t", String(Date.now()));

    try {
      saveResp = await callQuark<SaveData>(
        saveUrl.toString(),
        {
          method: "POST",
          headers: quarkHeaders(cookie),
          body: JSON.stringify(payload)
        },
        `转存文件(${host})`
      );
      break;
    } catch (err) {
      lastSaveError = err as Error;
    }
  }

  if (!saveResp) {
    throw lastSaveError || new Error("转存文件失败");
  }

  const taskId = saveResp.data?.task_id;
  if (taskId) {
    await pollTaskDone(cookie, taskId, pr, fr);
  }

  const saveAsTopFids = saveResp.data?.save_as?.save_as_top_fids || [];

  return {
    shareUrl,
    taskId,
    saveAsTopFids
  };
}

export async function checkQuarkHealth(env: Env, overrides?: SaveOverrides): Promise<{
  ok: boolean;
  quota?: string;
  message?: string;
}> {
  try {
    const { cookie, pr, fr } = getRuntime(env, overrides);
    const url = new URL("https://drive-pc.quark.cn/1/clouddrive/capacity/growth/info");
    url.searchParams.set("pr", pr);
    url.searchParams.set("fr", fr);

    const data = await callQuark<{ total_capacity_str?: string }>(
      url.toString(),
      {
        method: "GET",
        headers: quarkHeaders(cookie)
      },
      "检测 Quark 登录态"
    );

    return {
      ok: true,
      quota: data.data?.total_capacity_str
    };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message
    };
  }
}

export async function listTargetFolderFiles(
  env: Env,
  overrides?: SaveOverrides,
  pdirFid?: string
): Promise<{ folderFid: string; items: QuarkFolderItem[] }> {
  const { cookie, pr, fr } = getRuntime(env, overrides);
  const folderFid = pdirFid
    ? pdirFid
    : await resolveTargetFolderFid(cookie, pr, fr, overrides?.quarkTargetDir, env.QUARK_TARGET_FOLDER_ID);

  const url = new URL("https://drive-pc.quark.cn/1/clouddrive/file/sort");
  url.searchParams.set("pdir_fid", folderFid);
  url.searchParams.set("_page", "1");
  url.searchParams.set("_size", "200");
  url.searchParams.set("_fetch_total", "1");
  url.searchParams.set("_fetch_sub_dirs", "1");
  url.searchParams.set("_sort", "file_type:asc,file_name:asc");
  url.searchParams.set("pr", pr);
  url.searchParams.set("fr", fr);
  url.searchParams.set("uc_param_str", "");

  const resp = await callQuark<FolderListData>(
    url.toString(),
    {
      method: "GET",
      headers: quarkHeaders(cookie)
    },
    "读取目标目录文件"
  );

  const items = (resp.data?.list || [])
    .map((item) => {
      const fid = (item.fid || "").trim();
      const fileName = (item.file_name || "").trim();
      const isDir = item.dir === true || item.file_type === 0;
      const sizeBytes = item.obj_size ?? item.file_size ?? item.size;
      const sizeText = item.size_str || formatBytes(sizeBytes);
      if (!fid || !fileName) {
        return undefined;
      }
      return { fid, fileName, isDir, sizeBytes, sizeText };
    })
    .filter(Boolean) as QuarkFolderItem[];

  return { folderFid, items };
}

export async function deleteFilesFromQuark(
  env: Env,
  fids: string[],
  overrides?: SaveOverrides
): Promise<{ deleted: number }> {
  const cleaned = [...new Set(fids.map((x) => x.trim()).filter(Boolean))];
  if (!cleaned.length) {
    throw new Error("删除失败: fids 不能为空");
  }

  const { cookie, pr, fr } = getRuntime(env, overrides);
  const url = new URL("https://drive-pc.quark.cn/1/clouddrive/file/delete");
  url.searchParams.set("pr", pr);
  url.searchParams.set("fr", fr);
  url.searchParams.set("uc_param_str", "");

  const payloads = [
    { action_type: 2, filelist: cleaned, exclude_fids: [] as string[] },
    { fid_list: cleaned },
    { filelist: cleaned }
  ];

  let lastError: Error | undefined;
  for (const body of payloads) {
    try {
      const resp = await callQuark<DeleteData>(
        url.toString(),
        {
          method: "POST",
          headers: quarkHeaders(cookie),
          body: JSON.stringify(body)
        },
        "删除文件"
      );

      if (resp.data?.task_id) {
        await pollTaskDone(cookie, resp.data.task_id, pr, fr);
      }
      return { deleted: cleaned.length };
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError || new Error("删除文件失败");
}

export async function startQuarkQrLogin(): Promise<QrStartResponse> {
  const requestId = crypto.randomUUID();
  const t = Date.now();
  const dt = Math.floor(9000 + Math.random() * 12000);
  const startUrl = new URL("https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin");
  startUrl.searchParams.set("client_id", "532");
  startUrl.searchParams.set("v", "1.2");
  startUrl.searchParams.set("__dt", String(dt));
  startUrl.searchParams.set("__t", String(t));
  startUrl.searchParams.set("request_id", requestId);

  const resp = await fetch(startUrl.toString(), {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://pan.quark.cn",
      referer: "https://pan.quark.cn/",
      "user-agent": "Mozilla/5.0 (compatible; CF-Worker-MediaBot/1.0)"
    }
  });

  if (!resp.ok) {
    throw new Error(`获取扫码 token 失败: HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as {
    code?: number | string;
    status?: number;
    msg?: string;
    message?: string;
    data?: { members?: { token?: string } };
  };
  const token = (data.data?.members?.token || "").trim();
  if (!token) {
    throw new Error(`获取扫码 token 失败: ${data.msg || data.message || "返回为空"}`);
  }

  const qr = new URL("https://su.quark.cn/4_eMHBJ");
  qr.searchParams.set("token", token);
  qr.searchParams.set("client_id", "532");
  qr.searchParams.set("ssb", "weblogin");
  qr.searchParams.set("uc_param_str", "");
  qr.searchParams.set("uc_biz_str", "S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0");

  const sessionCookie = mergeCookies("", getSetCookieValues(resp.headers));
  return { token, qrUrl: qr.toString(), sessionCookie, requestId };
}

export async function pollQuarkQrLogin(
  env: Env,
  token: string,
  sessionCookie?: string,
  requestId?: string,
  overrides?: SaveOverrides
): Promise<QrPollResponse> {
  const tk = token.trim();
  if (!tk) {
    throw new Error("token 不能为空");
  }

  const pollUrl = new URL("https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken");
  pollUrl.searchParams.set("token", tk);
  pollUrl.searchParams.set("client_id", "532");
  pollUrl.searchParams.set("v", "1.2");
  pollUrl.searchParams.set("__dt", String(Math.floor(9000 + Math.random() * 12000)));
  pollUrl.searchParams.set("__t", String(Date.now()));
  pollUrl.searchParams.set("request_id", requestId?.trim() || crypto.randomUUID());

  const pollResp = await fetch(pollUrl.toString(), {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      ...(sessionCookie?.trim() ? { cookie: sessionCookie.trim() } : {}),
      referer: "https://pan.quark.cn/",
      origin: "https://pan.quark.cn",
      "user-agent": "Mozilla/5.0 (compatible; CF-Worker-MediaBot/1.0)"
    }
  });
  if (!pollResp.ok) {
    throw new Error(`轮询扫码状态失败: HTTP ${pollResp.status}`);
  }

  const pollData = (await pollResp.json()) as {
    status?: number;
    code?: number | string;
    msg?: string;
    message?: string;
    data?: { members?: { service_ticket?: string; st?: string }; service_ticket?: string; st?: string };
  };
  const rawStatus = pollData.status ?? pollData.code;
  const rawMessage = pollData.message || pollData.msg || "";

  if (pollData.status === 50004002) {
    return { status: "expired", message: "二维码已过期，请重新生成", rawStatus, rawMessage };
  }
  if (pollData.status === 50004001) {
    return { status: "pending", message: "等待扫码确认", rawStatus, rawMessage };
  }

  const serviceTicket = (
    pollData.data?.members?.service_ticket ||
    pollData.data?.members?.st ||
    pollData.data?.service_ticket ||
    pollData.data?.st ||
    ""
  ).trim();
  if (!serviceTicket) {
    return { status: "pending", message: "等待扫码确认", rawStatus, rawMessage };
  }

  const { cookie: existingCookie, pr, fr } = getQrRuntime(env, overrides);
  const exchangeUrl = new URL("https://pan.quark.cn/account/info");
  exchangeUrl.searchParams.set("st", serviceTicket);
  exchangeUrl.searchParams.set("lw", "scan");
  exchangeUrl.searchParams.set("pr", pr);
  exchangeUrl.searchParams.set("fr", fr);

  const exchangeResp = await fetch(exchangeUrl.toString(), {
    method: "GET",
    headers: {
      ...quarkHeaders(existingCookie),
      referer: "https://pan.quark.cn/"
    },
    redirect: "manual"
  });

  if (!exchangeResp.ok && exchangeResp.status !== 302 && exchangeResp.status !== 301) {
    throw new Error(`换取登录态失败: HTTP ${exchangeResp.status}`);
  }

  const setCookies = getSetCookieValues(exchangeResp.headers);
  if (!setCookies.length) {
    return {
      status: "pending",
      message: "已确认登录，但暂未获取到 Cookie，请稍后重试",
      rawStatus,
      rawMessage
    };
  }

  const mergedCookie = mergeCookies(existingCookie, setCookies);
  if (!mergedCookie) {
    return { status: "pending", message: "Cookie 解析失败，请重新扫码", rawStatus, rawMessage };
  }

  return { status: "success", cookie: mergedCookie, message: "扫码登录成功", rawStatus, rawMessage };
}
