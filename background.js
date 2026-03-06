// Slopbuster Background Service Worker

importScripts("lib/shared.js");

// GitHub repo URL for blocklist sync
const GITHUB_BLOCKLIST_URL = "https://raw.githubusercontent.com/Lexer-Lux/LEXERS-MOD-TWITTER/main/data/blocklist.json";

// ── Alarm-based sync ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Set default preferences
  chrome.storage.local.get("preferences", (data) => {
    if (!data.preferences) {
      savePreferences(DEFAULT_PREFERENCES);
    }
  });

  // Initialize blocklist if empty
  chrome.storage.local.get("blocklist", (data) => {
    if (!data.blocklist) {
      saveBlocklist({ version: 1, updated: null, entries: [] });
    }
  });

  // Set up periodic sync alarm (daily)
  chrome.alarms.create("syncBlocklist", {
    periodInMinutes: SYNC_INTERVAL_MINUTES
  });

  // Sync immediately on install
  syncBlocklist();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "syncBlocklist") {
    syncBlocklist();
  }
});

// ── Remote blocklist sync from GitHub ─────────────────────────────────

async function syncBlocklist() {
  try {
    // Add cache-busting param to avoid getting cached response
    const url = `${GITHUB_BLOCKLIST_URL}?t=${Date.now()}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        // Repo or file doesn't exist yet - that's ok
        await chrome.storage.local.set({ lastSync: new Date().toISOString(), syncStatus: "no_remote" });
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const remote = await response.json();
    if (!remote || !Array.isArray(remote.entries)) throw new Error("Invalid blocklist format");

    const local = await getBlocklist();

    // Merge: remote entries override local by handle
    const merged = new Map();

    // Local entries first
    for (const entry of local.entries) {
      merged.set(entry.handle.toLowerCase(), entry);
    }

    // Remote entries override
    for (const entry of remote.entries) {
      const key = entry.handle.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        // Merge reasons
        const allReasons = [...new Set([...existing.reasons, ...entry.reasons])];
        merged.set(key, { ...existing, ...entry, reasons: allReasons });
      } else {
        merged.set(key, entry);
      }
    }

    const newList = {
      version: remote.version || local.version,
      updated: new Date().toISOString(),
      entries: Array.from(merged.values())
    };

    await saveBlocklist(newList);
    await chrome.storage.local.set({ lastSync: new Date().toISOString(), syncStatus: "ok" });
  } catch (err) {
    console.error("Slopbuster sync failed:", err);
    await chrome.storage.local.set({ lastSync: new Date().toISOString(), syncStatus: "error", syncError: err.message });
  }
}

// ── Message handling ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "syncNow") {
    syncBlocklist().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // async response
  }

  if (msg.action === "getStats") {
    (async () => {
      const list = await getBlocklist();
      const data = await chrome.storage.local.get(["lastSync", "syncStatus"]);
      sendResponse({
        totalBusted: list.entries.length,
        lastSync: data.lastSync || "Never",
        syncStatus: data.syncStatus || "unknown"
      });
    })();
    return true;
  }

  if (msg.action === "exportBlocklist") {
    (async () => {
      const list = await getBlocklist();
      sendResponse({ blocklist: list });
    })();
    return true;
  }
});
