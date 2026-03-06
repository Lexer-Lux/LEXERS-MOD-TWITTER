// Slopbuster Database Page

const GITHUB_REPO = "Lexer-Lux/LEXERS-MOD-TWITTER";
const GITHUB_BLOCKLIST_PATH = "data/blocklist.json";

document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("tbody");
  const countEl = document.getElementById("count");
  const emptyEl = document.getElementById("empty");
  const searchEl = document.getElementById("search");
  const filterEl = document.getElementById("filterReason");

  // Check admin status (GitHub login)
  const adminLoggedIn = await isGitHubLoggedIn();
  if (adminLoggedIn) {
    showAdminFeatures();
  }

  // Populate reason filter dropdown
  let reasonsCache = await getReasons();
  reasonsCache.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.label;
    filterEl.appendChild(opt);
  });

  // Pre-fill search from URL query param
  const urlParams = new URLSearchParams(window.location.search);
  const initialQuery = urlParams.get("q");
  if (initialQuery) {
    searchEl.value = initialQuery;
  }

  let allEntries = [];

  async function load() {
    const list = await getBlocklist();
    allEntries = list.entries.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    render();
  }

  function render() {
    const query = searchEl.value.toLowerCase();
    const reasonFilter = filterEl.value;
    const isAdmin = document.getElementById("adminBar").style.display !== "none";

    const filtered = allEntries.filter(entry => {
      if (reasonFilter && !entry.reasons.includes(reasonFilter)) return false;
      if (query) {
        const haystack = [
          entry.handle,
          entry.displayName,
          entry.note,
          ...entry.reasons
        ].join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    countEl.textContent = `${filtered.length} user${filtered.length !== 1 ? "s" : ""}`;
    tbody.innerHTML = "";

    if (filtered.length === 0) {
      emptyEl.style.display = "block";
      document.getElementById("table").style.display = "none";
      return;
    }

    emptyEl.style.display = "none";
    document.getElementById("table").style.display = "";

    filtered.forEach(entry => {
      const tr = document.createElement("tr");

      const reasonLabels = entry.reasons.map(rId => {
        const found = reasonsCache.find(r => r.id === rId);
        return { label: found ? found.label : rId, color: found?.color };
      });

      const sourceLabel = entry.source === "profile" ? "Profile" : "Tweet";
      const proofUrl = entry.proofUrl || entry.tweetUrl || "#";

      const reasonTags = reasonLabels.map(r => {
        const style = r.color ? `background-color: ${r.color}; color: #fff;` : "";
        return `<span class="tag" style="${style}">${esc(r.label)}</span>`;
      }).join(" ");

      tr.innerHTML = `
        <td class="handle">@${esc(entry.handle)}</td>
        <td>${esc(entry.displayName)}</td>
        <td class="reasons">${reasonTags}</td>
        <td class="note">${esc(entry.note || "—")}</td>
        <td><a href="${esc(proofUrl)}" target="_blank" class="link">${sourceLabel}</a></td>
        <td class="date">${formatDate(entry.addedAt)}</td>
        <td class="admin-only">${isAdmin ? `<button class="remove-btn" data-handle="${esc(entry.handle)}">Remove</button>` : ""}</td>
      `;

      tbody.appendChild(tr);
    });

    // Remove handlers
    if (isAdmin) {
      tbody.querySelectorAll(".remove-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const handle = btn.getAttribute("data-handle");
          if (confirm(`Remove @${handle} from the database?`)) {
            await removeEntry(handle);
            await load();
          }
        });
      });
    }
  }

  searchEl.addEventListener("input", render);
  filterEl.addEventListener("change", render);

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.blocklist) load();
    if (changes.customReasons) {
      getReasons().then(r => {
        reasonsCache = r;
        render();
        renderCategoryEditor();
      });
    }
  });

  // ── GitHub Login/Logout ─────────────────────────────────────────────

  document.getElementById("loginGithub").addEventListener("click", async () => {
    const success = await loginWithGitHub();
    if (success) {
      showAdminFeatures();
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await logoutGitHub();
    hideAdminFeatures();
  });

  // ── Push to GitHub ──────────────────────────────────────────────────

  document.getElementById("pushGithub").addEventListener("click", async () => {
    const pushStatus = document.getElementById("pushStatus");
    pushStatus.textContent = "Pushing...";
    pushStatus.className = "status-text";

    try {
      await pushToGitHub();
      pushStatus.textContent = "Pushed successfully!";
      pushStatus.className = "status-text success";
    } catch (err) {
      pushStatus.textContent = `Error: ${err.message}`;
      pushStatus.className = "status-text error";
    }
  });

  // ── Category Editor ─────────────────────────────────────────────────

  document.getElementById("addCategory").addEventListener("click", async () => {
    const label = prompt("Enter category label:");
    if (!label || !label.trim()) return;

    const id = generateCategoryId(label.trim());
    const description = prompt("Enter category description (optional):") || "";
    const color = prompt("Enter category color (hex, e.g. #ff6b6b):") || "#888888";

    const data = await chrome.storage.local.get("customReasons");
    const customReasons = data.customReasons || [];

    const reasons = await getReasons();
    if (reasons.some(r => r.id === id)) {
      alert("A category with this ID already exists.");
      return;
    }

    customReasons.push({ id, label: label.trim(), description: description.trim(), color });
    await saveCustomReasons(customReasons);

    await renderCategoryEditor();
    showCategoryStatus("Category added!");
  });

  document.getElementById("resetCategories").addEventListener("click", async () => {
    if (!confirm("Reset all categories to defaults? This will remove all custom categories.")) return;
    await saveCustomReasons([]);
    await renderCategoryEditor();
    showCategoryStatus("Categories reset to defaults");
  });

  await load();
  await renderCategoryEditor();
});

// ── Category Editor Rendering ─────────────────────────────────────────

async function renderCategoryEditor() {
  const editor = document.getElementById("categoryEditor");
  if (!editor) return;
  editor.innerHTML = "";

  const reasons = await getReasons();

  reasons.forEach(reason => {
    const row = document.createElement("div");
    row.className = "category-row";
    row.dataset.id = reason.id;

    row.innerHTML = `
      <input type="color" class="category-color-input" value="${reason.color || "#888888"}" title="Category color">
      <div class="category-inputs">
        <input type="text" class="input category-label-input" value="${esc(reason.label)}" placeholder="Label">
        <input type="text" class="input category-desc-input" value="${esc(reason.description || "")}" placeholder="Description">
      </div>
      <div class="category-row-actions">
        <button class="btn btn-small btn-save" title="Save changes">Save</button>
        <button class="btn btn-small btn-danger btn-delete" title="Delete category">Delete</button>
      </div>
    `;

    // Save button handler
    row.querySelector(".btn-save").addEventListener("click", async () => {
      const newLabel = row.querySelector(".category-label-input").value.trim();
      const newDesc = row.querySelector(".category-desc-input").value.trim();
      const newColor = row.querySelector(".category-color-input").value;

      if (!newLabel) {
        alert("Label cannot be empty.");
        return;
      }

      const data = await chrome.storage.local.get("customReasons");
      const customReasons = data.customReasons || [];

      const existingIndex = customReasons.findIndex(r => r.id === reason.id);
      const updatedReason = { id: reason.id, label: newLabel, description: newDesc, color: newColor };

      if (existingIndex >= 0) {
        customReasons[existingIndex] = updatedReason;
      } else {
        customReasons.push(updatedReason);
      }

      await saveCustomReasons(customReasons);
      await renderCategoryEditor();
      showCategoryStatus("Category saved!");
    });

    // Delete button handler
    row.querySelector(".btn-delete").addEventListener("click", async () => {
      if (!confirm("Delete this category?")) return;

      const data = await chrome.storage.local.get("customReasons");
      const customReasons = data.customReasons || [];

      const isBuiltIn = DEFAULT_REASONS.some(r => r.id === reason.id);

      if (isBuiltIn) {
        const existingIndex = customReasons.findIndex(r => r.id === reason.id);
        if (existingIndex >= 0) {
          customReasons[existingIndex] = { id: reason.id, _deleted: true };
        } else {
          customReasons.push({ id: reason.id, _deleted: true });
        }
      } else {
        const newCustom = customReasons.filter(r => r.id !== reason.id);
        await saveCustomReasons(newCustom);
        await renderCategoryEditor();
        showCategoryStatus("Category deleted!");
        return;
      }

      await saveCustomReasons(customReasons);
      await renderCategoryEditor();
      showCategoryStatus("Category hidden!");
    });

    editor.appendChild(row);
  });
}

// ── GitHub Auth Functions (Personal Access Token) ─────────────────────

async function isGitHubLoggedIn() {
  const data = await chrome.storage.local.get("githubToken");
  if (!data.githubToken) return false;

  // Verify token is still valid
  try {
    const user = await getGitHubUser(data.githubToken);
    // Check if logged in as the correct user (Lexer-Lux)
    return user.login.toLowerCase() === "lexer-lux";
  } catch {
    return false;
  }
}

async function loginWithGitHub() {
  const token = prompt("Enter your GitHub Personal Access Token (with repo scope):\n\nCreate one at: https://github.com/settings/tokens/new");
  if (!token || !token.trim()) return false;

  try {
    const user = await getGitHubUser(token.trim());

    // Verify it's the correct account
    if (user.login.toLowerCase() !== "lexer-lux") {
      alert(`Wrong account. Expected: Lexer-Lux, Got: ${user.login}`);
      return false;
    }

    await chrome.storage.local.set({ githubToken: token.trim(), githubUser: user });
    return true;
  } catch (err) {
    alert("Invalid token or API error: " + err.message);
    return false;
  }
}

async function logoutGitHub() {
  await chrome.storage.local.remove(["githubToken", "githubUser"]);
}

async function getGitHubUser(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token}` }
  });
  if (!response.ok) throw new Error("Failed to get user info");
  return await response.json();
}

async function pushToGitHub() {
  const data = await chrome.storage.local.get(["githubToken", "customReasons"]);
  const token = data.githubToken;
  if (!token) throw new Error("Not logged in to GitHub");

  const blocklist = await getBlocklist();
  const content = JSON.stringify(blocklist, null, 2);
  const contentBase64 = btoa(unescape(encodeURIComponent(content)));

  // Get current file SHA (needed for update)
  let sha = null;
  try {
    const getResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_BLOCKLIST_PATH}`, {
      headers: { Authorization: `token ${token}` }
    });
    if (getResponse.ok) {
      const fileData = await getResponse.json();
      sha = fileData.sha;
    }
  } catch (e) {
    // File doesn't exist yet, that's ok
  }

  const body = {
    message: `Update blocklist - ${new Date().toISOString()}`,
    content: contentBase64,
    branch: "main"
  };
  if (sha) body.sha = sha;

  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_BLOCKLIST_PATH}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || "Failed to push to GitHub");
  }
}

// ── Admin Features Visibility ─────────────────────────────────────────

async function showAdminFeatures() {
  const data = await chrome.storage.local.get("githubUser");
  const user = data.githubUser;

  document.getElementById("adminBar").style.display = "flex";
  document.getElementById("adminStatus").textContent = user ? `Logged in as ${user.login}` : "Admin mode";

  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = "";
  });

  document.getElementById("loginGithub").style.display = "none";
  document.getElementById("pushGithub").style.display = "";
}

function hideAdminFeatures() {
  document.getElementById("adminBar").style.display = "none";
  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = "none";
  });
  document.getElementById("loginGithub").style.display = "";
  document.getElementById("pushGithub").style.display = "none";
}

// ── Helpers ───────────────────────────────────────────────────────────

function generateCategoryId(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 32) || "custom_" + Date.now();
}

function showCategoryStatus(msg) {
  const el = document.getElementById("categoryStatus");
  el.textContent = msg;
  el.className = "status-text success";
  setTimeout(() => { el.textContent = ""; el.className = "status-text"; }, 2000);
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
