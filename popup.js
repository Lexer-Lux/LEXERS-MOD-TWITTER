// Slopbuster Popup

document.addEventListener("DOMContentLoaded", async () => {
  const totalEl = document.getElementById("totalBusted");
  const syncEl = document.getElementById("lastSync");
  const statusEl = document.getElementById("status");
  const adminSection = document.getElementById("adminSection");

  // Load stats
  chrome.runtime.sendMessage({ action: "getStats" }, (resp) => {
    if (resp) {
      totalEl.textContent = resp.totalBusted;
      syncEl.textContent = formatSyncTime(resp.lastSync);
    }
  });

  // Show admin section if admin key is set
  if (await isAdmin()) {
    adminSection.style.display = "block";
  }

  // Sync button
  document.getElementById("syncBtn").addEventListener("click", () => {
    statusEl.textContent = "Syncing...";
    statusEl.className = "status";
    chrome.runtime.sendMessage({ action: "syncNow" }, (resp) => {
      if (resp && resp.ok) {
        statusEl.textContent = "Synced!";
        statusEl.className = "status success";
        // Refresh stats
        chrome.runtime.sendMessage({ action: "getStats" }, (r) => {
          if (r) {
            totalEl.textContent = r.totalBusted;
            syncEl.textContent = formatSyncTime(r.lastSync);
          }
        });
      } else {
        statusEl.textContent = "Sync failed";
        statusEl.className = "status error";
      }
    });
  });

  // Browse database
  document.getElementById("databaseBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("database.html") });
  });

  // Settings
  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Export
  document.getElementById("exportBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "exportBlocklist" }, (resp) => {
      if (resp && resp.blocklist) {
        const json = JSON.stringify(resp.blocklist, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "slopbuster-blocklist.json";
        a.click();
        URL.revokeObjectURL(url);
        statusEl.textContent = "Exported!";
        statusEl.className = "status success";
      }
    });
  });
});

function formatSyncTime(iso) {
  if (!iso || iso === "Never") return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return d.toLocaleDateString();
}
