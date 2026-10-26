(() => {
  "use strict";
  const host = document.getElementById("privateBatch");
  const table = document.querySelector(".table-wrap");
  const refresh = document.getElementById("refreshStatuses");
  const publicCount = artists.length;
  const noteKey = "sr-watercolor-batch4-encrypted-notes-v1";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let key = null;
  let salt = null;
  let unlocked = false;
  let busy = false;
  let notes = {};
  let saveChain = Promise.resolve();
  let pendingSaves = 0;
  const objectUrls = [];
  const unpack = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const pack = bytes => {
    let text = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(text);
  };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = value => {
    try { const url = new URL(value); return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : "#"; }
    catch { return "#"; }
  };
  const link = item => `<a href="${escape(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escape(item.label)}</a>`;
  const list = items => `<ul>${items.map(item => `<li>${item.url ? link(item) : escape(item.label)}${item.detail ? ": " + escape(item.detail) : ""}</li>`).join("")}</ul>`;
  function imageUrl(data) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
    if (!match) throw new Error("Bad image payload");
    const url = URL.createObjectURL(new Blob([unpack(match[2])], { type: match[1] }));
    objectUrls.push(url);
    return url;
  }
  async function decrypt(envelope, currentKey) {
    if (envelope.version !== 1) throw new Error("Unsupported format");
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unpack(envelope.iv) }, currentKey, unpack(envelope.data));
    const bytes = envelope.compression === "gzip"
      ? await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
      : data;
    return JSON.parse(decoder.decode(bytes));
  }
  async function encrypt(value, currentKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, currentKey, encoder.encode(JSON.stringify(value)));
    return { version: 1, salt, iv: pack(iv), data: pack(new Uint8Array(data)) };
  }
  function renderRows(items) {
    rows.querySelectorAll('[data-batch="4"]').forEach(row => row.remove());
    for (const [index, item] of items.entries()) {
      const artistIndex = publicCount + index;
      const artist = { ...item, batch: 4, works: item.works.map(work => ({ ...work, image: imageUrl(work.thumb), fullImage: imageUrl(work.full) })) };
      if (item.portrait) artist.portrait = { ...item.portrait, image: imageUrl(item.portrait.thumb), fullImage: imageUrl(item.portrait.full) };
      artists.push(artist);
      const row = document.createElement("tr");
      row.dataset.batch = "4";
      row.dataset.search = JSON.stringify(item).replace(/data:image\/[^\"]+/g, "").toLocaleLowerCase("ru");
      const works = artist.works.map((work, wi) => `<div class="work"><button type="button" data-artist-index="${artistIndex}" data-work-index="${wi}" aria-label="Увеличить: ${escape(work.title)}"><img src="${work.image}" alt="${escape(artist.name + ": " + work.title)}" loading="lazy" width="320" height="320"></button><span>${link({ label: work.title, url: work.page })}</span></div>`).join("");
      row.innerHTML = `<td class="col-number">${index + 1}</td>
        <td class="col-name"><p class="name">${escape(item.name)}</p>${artist.portrait ? `<button type="button" class="expert-portrait-button" data-portrait-index="${artistIndex}" aria-label="Увеличить фото: ${escape(item.name)}"><img class="expert-portrait" src="${artist.portrait.image}" alt="${escape(item.name)}" width="112" height="144" loading="lazy"></button>` : ""}<span class="note">${escape(item.location)}</span><br><span class="note">${escape(item.ageLabel)}</span>${item.recommendation ? `<div class="launch-recommendation"><span class="launch-label">Удобнее для запуска</span><p>${escape(item.recommendation)}</p><span class="note">Условия и согласие ещё не обсуждались.</span></div>` : ""}</td>
        <td class="col-rating"><span class="rating">${Number(item.score).toFixed(1)}</span><span class="level">/ 10</span></td>
        <td class="col-summary">${escape(item.summary)}${item.warning ? `<span class="draft-warning">${escape(item.warning)}</span>` : ""}</td>
        <td class="col-education">${escape(item.education)}</td><td class="col-why">${list(item.why)}</td>
        <td class="col-works"><div class="gallery">${works}</div>${item.artNote ? `<p class="note">${escape(item.artNote)}</p>` : ""}</td>
        <td class="col-links">${list(item.social)}</td><td class="col-schools">${list(item.schools)}</td><td class="col-sources">${list(item.sources)}</td>
        <td class="col-notes"><div class="draft-note-panel" data-draft-id="${escape(item.id)}"><label>Статус<select data-draft-field="status">${["Не взято", "В работе", "Проверить контакты", "Написать", "Ждем ответ", "Договорились", "Отказ", "Пауза"].map(s => `<option>${s}</option>`).join("")}</select></label><label>Личная заметка<textarea data-draft-field="notes" rows="5"></textarea></label><span class="sync-state" aria-live="polite"></span></div></td>`;
      rows.appendChild(row);
    }
    for (const panel of rows.querySelectorAll(".draft-note-panel")) {
      const saved = notes[panel.dataset.draftId] || {};
      panel.querySelectorAll("[data-draft-field]").forEach(input => {
        if (saved[input.dataset.draftField]) input.value = saved[input.dataset.draftField];
        input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => saveNote(panel));
      });
    }
  }
  function saveNote(panel) {
    const status = panel.querySelector(".sync-state");
    notes[panel.dataset.draftId] = Object.fromEntries([...panel.querySelectorAll("[data-draft-field]")].map(input => [input.dataset.draftField, input.value]));
    const snapshot = JSON.parse(JSON.stringify(notes));
    const currentKey = key;
    const revision = panel.dataset.revision = String(Number(panel.dataset.revision || 0) + 1);
    status.textContent = "Сохранение…";
    pendingSaves++;
    saveChain = saveChain.catch(() => {}).then(async () => {
      const envelope = await encrypt(snapshot, currentKey);
      localStorage.setItem(noteKey, JSON.stringify(envelope));
      if (panel.dataset.revision === revision) { status.textContent = "Зашифровано в этом браузере"; status.className = "sync-state saved"; }
    }).catch(() => { status.textContent = "Не сохранено. Экспортируйте заметки."; status.className = "sync-state error"; }).finally(() => pendingSaves--);
  }
  function renderTools(noteWarning) {
    host.innerHTML = `<div class="draft-tools"><p>Закрытый черновик. Заметки хранятся зашифрованными только в этом браузере, без Google Таблицы.</p><button type="button" data-export>Экспорт заметок</button><button type="button" data-import>Импорт заметок</button><button type="button" data-lock>Закрыть доступ</button><input type="file" data-import-file accept=".json" hidden></div>${noteWarning ? `<p class="draft-error">${escape(noteWarning)}</p>` : ""}`;
    host.querySelector("[data-lock]").onclick = async () => { await saveChain; lock(); };
    host.querySelector("[data-export]").onclick = async () => {
      try {
        const envelope = await encrypt(notes, key);
        const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: "application/json" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "batch4-private-notes.json"; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch { alert("Не удалось экспортировать заметки."); }
    };
    const fileInput = host.querySelector("[data-import-file]");
    host.querySelector("[data-import]").onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      if (!fileInput.files[0]) return;
      try {
        const envelope = JSON.parse(await fileInput.files[0].text());
        if (envelope.salt !== salt) throw new Error("Wrong batch");
        const imported = await decrypt(envelope, key);
        if (!imported || typeof imported !== "object" || Array.isArray(imported)) throw new Error("Bad notes");
        for (const item of artists.slice(publicCount)) {
          if (!imported[item.id]) continue;
          notes[item.id] = { ...notes[item.id], ...imported[item.id] };
          const panel = [...rows.querySelectorAll(".draft-note-panel")].find(p => p.dataset.draftId === item.id);
          panel.querySelectorAll("[data-draft-field]").forEach(input => { input.value = notes[item.id][input.dataset.draftField] || ""; });
          saveNote(panel);
        }
        await saveChain;
      } catch { alert("Файл не подходит или не расшифровывается этим паролем."); }
      fileInput.value = "";
    };
  }
  function lock() {
    viewer.close(); viewerImage.removeAttribute("src"); viewerImage.alt = ""; viewerTitle.textContent = ""; openSource.onclick = null;
    rows.querySelectorAll('[data-batch="4"]').forEach(row => row.remove());
    artists.splice(publicCount);
    objectUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
    key = null; notes = {}; unlocked = false;
    renderLock(); activate(activeBatch);
  }
  function renderLock() {
    host.innerHTML = `<div class="draft-lock"><h2>Партия 4. Закрытый черновик</h2><form><label>Пароль<input type="password" autocomplete="current-password" required aria-label="Пароль партии 4"></label><button type="submit">Открыть партию</button><p class="draft-error" role="status"></p></form></div>`;
    host.querySelector("form").onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const input = host.querySelector('input[type="password"]');
      const button = host.querySelector('button[type="submit"]');
      const state = host.querySelector(".draft-error");
      button.disabled = true; button.textContent = "Открываю…"; state.textContent = "";
      try {
        if (!crypto.subtle) throw new Error("Crypto unavailable");
        const response = await fetch(new URL("private-batch.enc.json", document.baseURI), { cache: "no-cache" });
        if (!response.ok) throw new Error("Download failed");
        const envelope = await response.json();
        if (envelope.version !== 1 || envelope.iterations !== 310000) throw new Error("Unsupported format");
        const material = await crypto.subtle.importKey("raw", encoder.encode(input.value), "PBKDF2", false, ["deriveKey"]);
        const derived = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: unpack(envelope.salt), iterations: envelope.iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        const payload = await decrypt(envelope, derived);
        if (payload.batch !== 4 || !Array.isArray(payload.artists) || payload.artists.length !== 11) throw new Error("Bad batch");
        input.value = ""; key = derived; salt = envelope.salt;
        let warning = "";
        try { const saved = localStorage.getItem(noteKey); if (saved) notes = await decrypt(JSON.parse(saved), key); }
        catch { warning = "Сохранённые заметки не прочитаны. Прежде чем редактировать, сохраните резервную копию браузера."; }
        renderRows(payload.artists); unlocked = true; applyFilter();
        renderTools(warning); activate(activeBatch);
      } catch (error) {
        if (artists.length > publicCount) lock();
        const stateNow = host.querySelector(".draft-error");
        if (stateNow) stateNow.textContent = error.name === "OperationError" ? "Неверный пароль." : "Не удалось открыть партию. Проверьте подключение и повторите.";
      } finally {
        busy = false;
        const submit = host.querySelector('button[type="submit"]');
        if (submit) { submit.disabled = false; submit.textContent = "Открыть партию"; }
      }
    };
  }
  function activate(batch) {
    const selected = batch === "4";
    host.hidden = !selected;
    table.hidden = selected && !unlocked;
    search.disabled = selected && !unlocked;
    refresh.hidden = selected;
    if (selected) {
      batchMeta.textContent = unlocked ? "Партия 4: 11 художников. Закрытый черновик, не передан в работу." : "Партия 4 закрыта паролем.";
      if (!unlocked) empty.style.display = "none";
    }
  }
  window.addEventListener("artist-batch-change", event => activate(event.detail));
  window.addEventListener("beforeunload", event => { if (pendingSaves) { event.preventDefault(); event.returnValue = ""; } });
  renderLock(); activate(activeBatch);
})();
