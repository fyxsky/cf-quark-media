export interface Env {
  ASSETS: Fetcher;

  // Optional custom search API (e.g. self-hosted yz_pansearch_api).
  PANSEARCH_API_BASE_URL?: string;
  PANSEARCH_API_TOKEN?: string;

  QUARK_COOKIE: string;
  QUARK_TARGET_FOLDER_ID: string;
  QUARK_PR?: string;
  QUARK_FR?: string;
}

export interface SearchItem {
  title: string;
  url: string;
}

export interface SearchResponse {
  items: SearchItem[];
}

export interface SaveResponse {
  shareUrl: string;
  taskId?: string;
  saveAsTopFids?: string[];
}

export interface QuarkFolderItem {
  fid: string;
  fileName: string;
  isDir: boolean;
  sizeBytes?: number;
  sizeText?: string;
}
