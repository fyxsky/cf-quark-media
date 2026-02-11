      const $ = (id) => document.getElementById(id);
      const QUARK_COOKIE_KEY = "cf_quark_cookie_override";
      const QUARK_DIR_KEY = "cf_quark_dir_override";
      const logBox = $("log");
      const expandedFids = new Set();
      const loadedChildren = new Map();
      const selectedFids = new Set();
      const selectedSearchUrls = new Set();
      const parentByFid = new Map();
      const itemByFid = new Map();
      const dirTreeChildren = new Map();
      const dirTreeExpanded = new Set();
      const dirPathByFid = new Map();
      let qrPollTimer = null;
      let qrToken = "";
      let qrSessionCookie = "";
      let qrRequestId = "";
      let currentSearchItems = [];
      let isMarqueeSelecting = false;
      let marqueeStartX = 0;
      let marqueeStartY = 0;
      let isSearchMarqueeSelecting = false;
      let searchMarqueeStartX = 0;
      let searchMarqueeStartY = 0;
      function nowTime() {
        return new Date().toLocaleTimeString("zh-CN", { hour12: false });
      }

      function clearLog(title = "等待操作...") {
        logBox.textContent = `${nowTime()} ${title}`;
      }

      function appendLog(message, level = "INFO") {
        const line = `${nowTime()} [${level}] ${message}`;
        logBox.textContent = `${logBox.textContent}\n${line}`;
        logBox.scrollTop = logBox.scrollHeight;
      }

      function rectIntersects(a, b) {
        return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
      }

      function updateMarqueeBox(startX, startY, currentX, currentY) {
        const box = $("marqueeBox");
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
      }

      function hideMarqueeBox() {
        const box = $("marqueeBox");
        box.style.display = "none";
      }


      function stopQrPolling() {
        if (qrPollTimer) {
          clearInterval(qrPollTimer);
          qrPollTimer = null;
        }
      }

      function closeQrModal() {
        stopQrPolling();
        $("qrModal").classList.remove("open");
      }

      function openQrModal() {
        $("qrModal").classList.add("open");
      }

      function getQuarkCookie() {
        return $("quarkCookie").value.trim() || localStorage.getItem(QUARK_COOKIE_KEY) || "";
      }

      function getQuarkTargetDir() {
        return $("quarkTargetDir").value.trim() || localStorage.getItem(QUARK_DIR_KEY) || "";
      }

      function buildQuarkHeaders() {
        const quarkCookie = getQuarkCookie();
        const quarkTargetDir = getQuarkTargetDir();
        return {
          ...(quarkCookie ? { "x-quark-cookie": quarkCookie } : {}),
          ...(quarkTargetDir ? { "x-quark-target-dir": encodeURIComponent(quarkTargetDir) } : {})
        };
      }

      async function post(path, body) {
        const res = await fetch(path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...buildQuarkHeaders()
          },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `请求失败: ${res.status}`);
        return data;
      }

      async function get(path) {
        const res = await fetch(path, {
          headers: buildQuarkHeaders()
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `请求失败: ${res.status}`);
        return data;
      }

      async function remove(path, body) {
        const res = await fetch(path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...buildQuarkHeaders()
          },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `请求失败: ${res.status}`);
        return data;
      }

      async function fetchFoldersByFid(fid, parentPath = "") {
        const data = await get(`/api/quark/files?fid=${encodeURIComponent(fid)}`);
        const folders = (data.items || []).filter((x) => x.isDir);
        const withPath = folders.map((item) => {
          const path = parentPath ? `${parentPath}/${item.fileName}` : `/${item.fileName}`;
          dirPathByFid.set(item.fid, path);
          return { ...item, path };
        });
        dirTreeChildren.set(fid, withPath);
        return withPath;
      }

      function renderDirTreeNodes(items, container) {
        container.innerHTML = "";
        if (!items.length) {
          container.innerHTML = "<li>根目录下暂无文件夹</li>";
          return;
        }

        items.forEach((item) => {
          const li = document.createElement("li");
          const node = document.createElement("div");
          node.className = "dir-node";

          const expanded = dirTreeExpanded.has(item.fid);
          const expBtn = document.createElement("button");
          expBtn.className = "dir-expand";
          expBtn.textContent = expanded ? "▾" : "▸";
          expBtn.addEventListener("click", async () => {
            if (dirTreeExpanded.has(item.fid)) {
              dirTreeExpanded.delete(item.fid);
              renderDirTree();
              return;
            }
            dirTreeExpanded.add(item.fid);
            if (!dirTreeChildren.has(item.fid)) {
              try {
                await fetchFoldersByFid(item.fid, item.path);
              } catch (e) {
                appendLog(`加载目录树失败: ${e.message}`, "ERROR");
              }
            }
            renderDirTree();
          });
          node.appendChild(expBtn);

          const nameBtn = document.createElement("button");
          nameBtn.className = "dir-name";
          nameBtn.textContent = item.fileName;
          nameBtn.title = item.path;
          nameBtn.addEventListener("click", () => {
            $("quarkTargetDir").value = item.path;
            localStorage.setItem(QUARK_DIR_KEY, item.path);
            $("dirDropdown").classList.add("hidden");
            clearLog(`已选择目录: ${item.path}`);
            $("refreshFilesBtn").click();
          });
          node.appendChild(nameBtn);
          li.appendChild(node);

          if (expanded) {
            const children = dirTreeChildren.get(item.fid) || [];
            const childUl = document.createElement("ul");
            childUl.className = "dir-tree dir-children";
            renderDirTreeNodes(children, childUl);
            li.appendChild(childUl);
          }

          container.appendChild(li);
        });
      }

      function renderDirTree() {
        const root = $("dirTree");
        const rootItems = dirTreeChildren.get("0") || [];
        renderDirTreeNodes(rootItems, root);
      }

      async function ensureRootDirTree() {
        if (!dirTreeChildren.has("0")) {
          await fetchFoldersByFid("0", "");
        }
        renderDirTree();
      }

      function registerNodes(items, parentFid) {
        items.forEach((item) => {
          itemByFid.set(item.fid, item);
          parentByFid.set(item.fid, parentFid || "");
        });
      }

      async function ensureChildrenLoaded(item) {
        if (!item?.isDir) {
          return [];
        }
        if (loadedChildren.has(item.fid)) {
          return loadedChildren.get(item.fid) || [];
        }
        appendLog(`读取子目录: ${item.fileName}`);
        const childData = await get(`/api/quark/files?fid=${encodeURIComponent(item.fid)}`);
        const children = childData.items || [];
        loadedChildren.set(item.fid, children);
        registerNodes(children, item.fid);
        return children;
      }

      async function selectFolderDeep(fid) {
        const item = itemByFid.get(fid);
        if (!item) {
          return;
        }
        selectedFids.add(fid);
        if (!item.isDir) {
          return;
        }
        const children = await ensureChildrenLoaded(item);
        for (const child of children) {
          await selectFolderDeep(child.fid);
        }
      }

      function deselectNodeDeep(fid) {
        selectedFids.delete(fid);
        const item = itemByFid.get(fid);
        if (!item?.isDir) {
          return;
        }
        const children = loadedChildren.get(fid) || [];
        for (const child of children) {
          deselectNodeDeep(child.fid);
        }
      }

      function deselectAncestors(fid) {
        let current = parentByFid.get(fid) || "";
        while (current) {
          selectedFids.delete(current);
          current = parentByFid.get(current) || "";
        }
      }

      function trySelectAncestors(fid) {
        let current = parentByFid.get(fid) || "";
        while (current) {
          const siblings = loadedChildren.get(current) || [];
          if (!siblings.length) {
            break;
          }
          const allChecked = siblings.every((child) => selectedFids.has(child.fid));
          if (allChecked) {
            selectedFids.add(current);
          } else {
            selectedFids.delete(current);
          }
          current = parentByFid.get(current) || "";
        }
      }

      async function setItemChecked(item, checked) {
        if (checked) {
          if (item.isDir) {
            await selectFolderDeep(item.fid);
          } else {
            selectedFids.add(item.fid);
          }
          trySelectAncestors(item.fid);
        } else {
          if (item.isDir) {
            deselectNodeDeep(item.fid);
          } else {
            selectedFids.delete(item.fid);
          }
          deselectAncestors(item.fid);
        }
      }

      function renderNodes(items, rootUl) {
        rootUl.innerHTML = "";
        if (!items.length) {
          rootUl.innerHTML = "<li>目录为空</li>";
          return;
        }

        items.forEach((item) => {
          const li = document.createElement("li");
          const row = document.createElement("div");
          row.className = "file-row";
          row.dataset.fid = item.fid;
          const content = document.createElement("div");
          content.className = "file-content";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = selectedFids.has(item.fid);
          if (item.isDir) {
            const children = loadedChildren.get(item.fid) || [];
            if (children.length > 0) {
              const selectedCount = children.filter((child) => selectedFids.has(child.fid)).length;
              checkbox.indeterminate = selectedCount > 0 && selectedCount < children.length;
            }
          }
          checkbox.addEventListener("change", async () => {
            checkbox.disabled = true;
            try {
              await setItemChecked(item, checkbox.checked);
              renderFolderItems(window.__rootFolderData || { items: [] });
            } finally {
              checkbox.disabled = false;
            }
          });
          row.appendChild(checkbox);

          row.addEventListener("click", async (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("input,button,a,label")) {
              return;
            }
            try {
              const nextChecked = !selectedFids.has(item.fid);
              await setItemChecked(item, nextChecked);
              renderFolderItems(window.__rootFolderData || { items: [] });
            } catch (e) {
              appendLog(`行点击选中失败: ${e.message}`, "ERROR");
            }
          });

          if (item.isDir) {
            const btn = document.createElement("button");
            btn.className = "file-name-btn";
            const open = expandedFids.has(item.fid);
            const sizeSuffix = item.sizeText && item.sizeText !== "0 B" ? ` [${item.sizeText}]` : "";
            btn.textContent = `${open ? "▾" : "▸"} ${item.fileName}${sizeSuffix}`;
            btn.addEventListener("click", async () => {
              if (expandedFids.has(item.fid)) {
                expandedFids.delete(item.fid);
                renderFolderItems(window.__rootFolderData || { items: [] });
                return;
              }
              expandedFids.add(item.fid);
              if (!loadedChildren.has(item.fid)) {
                try {
                  await ensureChildrenLoaded(item);
                } catch (e) {
                  appendLog(`读取子目录失败: ${e.message}`, "ERROR");
                }
              }
              renderFolderItems(window.__rootFolderData || { items: [] });
            });
            content.appendChild(btn);
          } else {
            const name = document.createElement("span");
            name.className = "file-name";
            const sizeSuffix = item.sizeText ? ` [${item.sizeText}]` : "";
            name.textContent = `${item.fileName}${sizeSuffix}`;
            content.appendChild(name);
          }
          row.appendChild(content);

          li.appendChild(row);

          if (item.isDir && expandedFids.has(item.fid)) {
            const childUl = document.createElement("ul");
            childUl.className = "folder-children";
            const children = loadedChildren.get(item.fid) || [];
            renderNodes(children, childUl);
            li.appendChild(childUl);
          }
          rootUl.appendChild(li);
        });
      }

      function renderFolderItems(data) {
        const list = $("folderList");
        window.__rootFolderData = data;
        const items = data?.items || [];
        registerNodes(items, "");
        renderNodes(items, list);
      }

      async function refreshFolderList() {
        appendLog("请求 /api/quark/files 读取目标目录...");
        const data = await get("/api/quark/files");
        loadedChildren.clear();
        expandedFids.clear();
        selectedFids.clear();
        parentByFid.clear();
        itemByFid.clear();
        renderFolderItems(data);
        appendLog(`目录读取完成，共 ${data.items?.length || 0} 项`, "OK");
      }

      $("saveQuarkCookieBtn").addEventListener("click", () => {
        const value = $("quarkCookie").value.trim();
        if (!value) {
          localStorage.removeItem(QUARK_COOKIE_KEY);
          clearLog("已清除 Quark Cookie 本地缓存。");
          return;
        }
        localStorage.setItem(QUARK_COOKIE_KEY, value);
        clearLog("Quark Cookie 已保存到当前浏览器。");
      });

      async function pollQrStatus() {
        if (!qrToken) {
          return;
        }
        try {
          const data = await post("/api/quark/qr/poll", {
            token: qrToken,
            sessionCookie: qrSessionCookie,
            requestId: qrRequestId
          });
          const debugText = data.rawStatus ? `（状态码: ${data.rawStatus}${data.rawMessage ? `, ${data.rawMessage}` : ""}）` : "";
          if (data.status === "success" && data.cookie) {
            $("quarkCookie").value = data.cookie;
            localStorage.setItem(QUARK_COOKIE_KEY, data.cookie);
            $("qrStatus").textContent = "登录成功，Cookie 已自动填入并保存。";
            appendLog("扫码登录成功，Cookie 已自动保存", "OK");
            stopQrPolling();
            return;
          }
          if (data.status === "expired") {
            $("qrStatus").textContent = `${data.message || "二维码已过期，请重新生成。"}${debugText}`;
            appendLog($("qrStatus").textContent, "ERROR");
            stopQrPolling();
            return;
          }
          $("qrStatus").textContent = `${data.message || "等待扫码确认..."}${debugText}`;
        } catch (e) {
          $("qrStatus").textContent = `轮询失败: ${e.message}`;
          appendLog($("qrStatus").textContent, "ERROR");
          stopQrPolling();
        }
      }

      async function startQrLogin() {
        stopQrPolling();
        qrToken = "";
        qrSessionCookie = "";
        qrRequestId = "";
        $("qrStatus").textContent = "正在生成二维码...";
        $("qrImage").removeAttribute("src");
        try {
          const data = await post("/api/quark/qr/start", {});
          qrToken = data.token;
          qrSessionCookie = data.sessionCookie || "";
          qrRequestId = data.requestId || "";
          const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data.qrUrl)}`;
          $("qrImage").src = qrImg;
          $("qrStatus").textContent = "请使用夸克 App 扫码并确认登录。";
          appendLog("二维码已生成，等待扫码确认", "INFO");
          qrPollTimer = setInterval(pollQrStatus, 2000);
        } catch (e) {
          $("qrStatus").textContent = `生成失败: ${e.message}`;
          appendLog($("qrStatus").textContent, "ERROR");
        }
      }

      $("saveQuarkDirBtn").addEventListener("click", () => {
        const value = $("quarkTargetDir").value.trim();
        if (!value) {
          localStorage.removeItem(QUARK_DIR_KEY);
          clearLog("已清除目标目录缓存。");
          return;
        }
        localStorage.setItem(QUARK_DIR_KEY, value);
        clearLog("目标目录已保存到当前浏览器。");
      });

      $("openDirPickerBtn").addEventListener("click", async () => {
        const dropdown = $("dirDropdown");
        const willOpen = dropdown.classList.contains("hidden");
        if (!willOpen) {
          dropdown.classList.add("hidden");
          return;
        }
        dropdown.classList.remove("hidden");
        try {
          await ensureRootDirTree();
        } catch (e) {
          $("dirTree").innerHTML = "<li>目录树加载失败</li>";
          appendLog(`目录树加载失败: ${e.message}`, "ERROR");
        }
      });

      $("pickRootBtn").addEventListener("click", () => {
        $("quarkTargetDir").value = "/";
        localStorage.setItem(QUARK_DIR_KEY, "/");
        $("dirDropdown").classList.add("hidden");
        clearLog("已选择目录: /");
        $("refreshFilesBtn").click();
      });

      document.addEventListener("click", (event) => {
        const target = event.target;
        const picker = document.querySelector(".dir-picker-wrap");
        if (!picker || !target) {
          return;
        }
        if (!picker.contains(target)) {
          $("dirDropdown").classList.add("hidden");
        }
      });

      const filesBoxEl = document.querySelector(".files-box");
      if (filesBoxEl) {
        filesBoxEl.addEventListener("mousedown", (event) => {
          if (event.button !== 0) {
            return;
          }
          const target = event.target;
          if (target instanceof Element && target.closest("button,input,label,a")) {
            return;
          }
          isMarqueeSelecting = true;
          marqueeStartX = event.clientX;
          marqueeStartY = event.clientY;
          const box = $("marqueeBox");
          box.style.display = "block";
          updateMarqueeBox(marqueeStartX, marqueeStartY, event.clientX, event.clientY);
          event.preventDefault();
        });

        document.addEventListener("mousemove", (event) => {
          if (!isMarqueeSelecting) {
            return;
          }
          updateMarqueeBox(marqueeStartX, marqueeStartY, event.clientX, event.clientY);
        });

        document.addEventListener("mouseup", (event) => {
          if (!isMarqueeSelecting) {
            return;
          }
          isMarqueeSelecting = false;
          const endX = event.clientX;
          const endY = event.clientY;
          hideMarqueeBox();

          const width = Math.abs(endX - marqueeStartX);
          const height = Math.abs(endY - marqueeStartY);
          if (width < 6 && height < 6) {
            return;
          }

          const dragRect = {
            left: Math.min(marqueeStartX, endX),
            right: Math.max(marqueeStartX, endX),
            top: Math.min(marqueeStartY, endY),
            bottom: Math.max(marqueeStartY, endY)
          };

          const rows = document.querySelectorAll("#folderList .file-row[data-fid]");
          rows.forEach((row) => {
            const fid = row.dataset.fid || "";
            if (!fid) {
              return;
            }
            const rect = row.getBoundingClientRect();
            if (rectIntersects(dragRect, rect)) {
              if (selectedFids.has(fid)) {
                selectedFids.delete(fid);
              } else {
                selectedFids.add(fid);
              }
            }
          });

          renderFolderItems(window.__rootFolderData || { items: [] });
        });
      }

      const searchScrollBoxEl = $("searchScrollBox");
      if (searchScrollBoxEl) {
        searchScrollBoxEl.addEventListener("mousedown", (event) => {
          if (event.button !== 0) {
            return;
          }
          const target = event.target;
          if (target instanceof Element && target.closest("button,input,label,a")) {
            return;
          }
          isSearchMarqueeSelecting = true;
          searchMarqueeStartX = event.clientX;
          searchMarqueeStartY = event.clientY;
          const box = $("marqueeBox");
          box.style.display = "block";
          updateMarqueeBox(searchMarqueeStartX, searchMarqueeStartY, event.clientX, event.clientY);
          event.preventDefault();
        });

        document.addEventListener("mousemove", (event) => {
          if (!isSearchMarqueeSelecting) {
            return;
          }
          updateMarqueeBox(searchMarqueeStartX, searchMarqueeStartY, event.clientX, event.clientY);
        });

        document.addEventListener("mouseup", (event) => {
          if (!isSearchMarqueeSelecting) {
            return;
          }
          isSearchMarqueeSelecting = false;
          const endX = event.clientX;
          const endY = event.clientY;
          hideMarqueeBox();

          const width = Math.abs(endX - searchMarqueeStartX);
          const height = Math.abs(endY - searchMarqueeStartY);
          if (width < 6 && height < 6) {
            return;
          }

          const dragRect = {
            left: Math.min(searchMarqueeStartX, endX),
            right: Math.max(searchMarqueeStartX, endX),
            top: Math.min(searchMarqueeStartY, endY),
            bottom: Math.max(searchMarqueeStartY, endY)
          };

          const rows = document.querySelectorAll("#resultList .search-row[data-url]");
          rows.forEach((row) => {
            const url = row.dataset.url || "";
            if (!url) {
              return;
            }
            const rect = row.getBoundingClientRect();
            if (rectIntersects(dragRect, rect)) {
              if (selectedSearchUrls.has(url)) {
                selectedSearchUrls.delete(url);
              } else {
                selectedSearchUrls.add(url);
              }
            }
          });

          renderItems(currentSearchItems);
        });
      }

      const savedCookie = localStorage.getItem(QUARK_COOKIE_KEY);
      if (savedCookie) $("quarkCookie").value = savedCookie;
      const savedDir = localStorage.getItem(QUARK_DIR_KEY);
      if (savedDir) $("quarkTargetDir").value = savedDir;

      $("healthBtn").addEventListener("click", async () => {
        try {
          clearLog("开始检测 Quark 状态");
          const data = await get("/api/health");
          const ok = data.quark?.ok ? "可用" : "不可用";
          appendLog(`检测时间: ${data.time}`);
          appendLog(`Quark 登录态: ${ok}`);
          if (data.quark?.quota) {
            appendLog(`容量: ${data.quark.quota}`);
          }
          appendLog(`信息: ${data.quark?.message || "正常"}`, "OK");
        } catch (e) {
          appendLog(`检测失败: ${e.message}`, "ERROR");
        }
      });

      $("refreshFilesBtn").addEventListener("click", async () => {
        try {
          clearLog("开始刷新目标目录文件");
          await refreshFolderList();
        } catch (e) {
          appendLog(`读取目录失败: ${e.message}`, "ERROR");
        }
      });

      $("scanLoginBtn").addEventListener("click", async () => {
        openQrModal();
        await startQrLogin();
      });

      $("qrRefreshBtn").addEventListener("click", async () => {
        await startQrLogin();
      });

      $("qrCloseBtn").addEventListener("click", () => {
        closeQrModal();
      });

      $("deleteSelectedBtn").addEventListener("click", async () => {
        if (!selectedFids.size) {
          appendLog("请先勾选要删除的条目", "INFO");
          return;
        }
        if (!confirm(`确认删除已选中的 ${selectedFids.size} 项吗？`)) {
          return;
        }
        try {
          appendLog(`请求 /api/quark/delete，删除 ${selectedFids.size} 项...`);
          const data = await remove("/api/quark/delete", { fids: Array.from(selectedFids) });
          appendLog(`删除完成: ${data.deleted || 0} 项`, "OK");
          await refreshFolderList();
        } catch (e) {
          appendLog(`删除失败: ${e.message}`, "ERROR");
        }
      });

      $("saveSelectedSearchBtn").addEventListener("click", async () => {
        const shareUrls = Array.from(selectedSearchUrls);
        if (!shareUrls.length) {
          appendLog("请先在搜索结果中勾选要保存的条目", "INFO");
          return;
        }
        try {
          clearLog(`开始批量转存，共 ${shareUrls.length} 项`);
          const data = await post("/api/quark/save-batch", { shareUrls });
          appendLog(`批量转存完成: 成功 ${data.success}，失败 ${data.failed}`, "OK");
          (data.results || []).forEach((item, idx) => {
            if (item.ok) {
              appendLog(`${idx + 1}. 成功: ${item.inputUrl}`, "OK");
            } else {
              appendLog(`${idx + 1}. 失败: ${item.inputUrl} -> ${item.error || "未知错误"}`, "ERROR");
            }
          });
          await refreshFolderList();
        } catch (e) {
          appendLog(`批量转存失败: ${e.message}`, "ERROR");
        }
      });

      function renderItems(items) {
        const list = $("resultList");
        list.innerHTML = "";
        items.forEach((item) => {
          const li = document.createElement("li");
          const selected = selectedSearchUrls.has(item.url);
          li.innerHTML = `
            <div class="search-row ${selected ? "selected" : ""}" data-url="${item.url}">
              <input type="checkbox" ${selected ? "checked" : ""} />
              <div>
                <div class="item-title">${item.title}</div>
                <div class="item-url">${item.url}</div>
              </div>
            </div>
          `;
          list.appendChild(li);
        });

        list.querySelectorAll(".search-row[data-url]").forEach((row) => {
          const url = row.getAttribute("data-url") || "";
          const checkbox = row.querySelector("input[type='checkbox']");
          if (!(checkbox instanceof HTMLInputElement)) {
            return;
          }

          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              selectedSearchUrls.add(url);
            } else {
              selectedSearchUrls.delete(url);
            }
            renderItems(items);
          });

          row.addEventListener("click", (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("input,button,a,label")) {
              return;
            }
            if (selectedSearchUrls.has(url)) {
              selectedSearchUrls.delete(url);
            } else {
              selectedSearchUrls.add(url);
            }
            renderItems(items);
          });
        });
      }

      $("searchBtn").addEventListener("click", async () => {
        const keyword = $("keyword").value.trim();
        if (!keyword) {
          clearLog("请先输入关键词");
          return;
        }
        try {
          clearLog("开始搜索");
          appendLog(`关键词: ${keyword}`);
          appendLog("请求 /api/search ...");
          const t = Date.now();
          const data = await post("/api/search", { keyword });
          const ms = Date.now() - t;
          appendLog(`搜索完成，用时 ${ms}ms`, "OK");
          if (!data.items.length) {
            appendLog("没有检索到条目，请换关键词再试。");
            $("resultList").innerHTML = "";
            currentSearchItems = [];
            selectedSearchUrls.clear();
            return;
          }
          currentSearchItems = data.items;
          selectedSearchUrls.clear();
          renderItems(data.items);
          appendLog(`找到 ${data.items.length} 条结果，可多选后点击“保存到网盘”。`, "OK");
        } catch (e) {
          appendLog(`搜索失败: ${e.message}`, "ERROR");
        }
      });

      $("keyword").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          $("searchBtn").click();
        }
      });

      (async () => {
        try {
          await refreshFolderList();
        } catch {
          $("folderList").innerHTML = "<li>目录读取失败</li>";
        }
      })();
