// Slopbuster shared constants and helpers

const DEFAULT_REASONS = [
  { id: "ai_slop", label: "AI Slop", description: "" },
  { id: "fake_news", label: "Fake News", description: "" },
  { id: "illegal_ads", label: "Illegal Advertising", description: "" },
  { id: "toxicity", label: "Toxicity", description: "" },
  { id: "spam", label: "Spam", description: "" },
  { id: "engagement_bait", label: "Engagement Bait", description: "" },
  { id: "of_promotion", label: "OF Promotion", description: "" },
  { id: "fraud", label: "Fraud", description: "" },
  { id: "vtuber", label: "VTuber", description: "" },
  { id: "insane", label: "Insane", description: "" }
];

// Keep REASONS as alias for backward compatibility (used by content.js)
const REASONS = DEFAULT_REASONS;

// Get reasons merged with custom overrides from storage
async function getReasons() {
  const data = await chrome.storage.local.get("customReasons");
  const customReasons = data.customReasons || [];

  // Start with default reasons
  const merged = new Map();
  for (const r of DEFAULT_REASONS) {
    merged.set(r.id, { ...r });
  }

  // Apply custom reasons (overrides existing or adds new)
  for (const r of customReasons) {
    if (r._deleted) {
      merged.delete(r.id);
    } else {
      merged.set(r.id, { ...r });
    }
  }

  return Array.from(merged.values());
}

// Save custom reasons to storage
async function saveCustomReasons(customReasons) {
  await chrome.storage.local.set({ customReasons });
}

const DEFAULT_PREFERENCES = {};
DEFAULT_REASONS.forEach(r => {
  DEFAULT_PREFERENCES[r.id] = "flag"; // "show" | "flag" | "hide"
});

const SYNC_INTERVAL_MINUTES = 1440; // Daily sync (24 hours)

// Storage helpers
async function getBlocklist() {
  const data = await chrome.storage.local.get("blocklist");
  return data.blocklist || { version: 1, updated: null, entries: [] };
}

async function saveBlocklist(blocklist) {
  blocklist.updated = new Date().toISOString();
  await chrome.storage.local.set({ blocklist });
}

async function addEntry(entry) {
  const list = await getBlocklist();
  // Check if user already has an entry — merge reasons if so
  const existing = list.entries.find(e => e.handle === entry.handle);
  if (existing) {
    const newReasons = entry.reasons.filter(r => !existing.reasons.includes(r));
    existing.reasons.push(...newReasons);
    if (entry.note && entry.note.trim()) {
      existing.note = existing.note
        ? existing.note + " | " + entry.note
        : entry.note;
    }
    // Update proof URL to the latest offense
    existing.proofUrl = entry.proofUrl;
    existing.source = entry.source || "tweet";
    existing.addedAt = new Date().toISOString();
  } else {
    list.entries.push({
      handle: entry.handle,
      displayName: entry.displayName || entry.handle,
      proofUrl: entry.proofUrl,
      source: entry.source || "tweet", // "tweet" or "profile"
      reasons: entry.reasons,
      note: entry.note || "",
      addedAt: new Date().toISOString()
    });
  }
  await saveBlocklist(list);
  return list;
}

async function removeEntry(handle) {
  const list = await getBlocklist();
  list.entries = list.entries.filter(e => e.handle !== handle);
  await saveBlocklist(list);
  return list;
}

async function getPreferences() {
  const data = await chrome.storage.local.get("preferences");
  return { ...DEFAULT_PREFERENCES, ...(data.preferences || {}) };
}

async function savePreferences(prefs) {
  await chrome.storage.local.set({ preferences: prefs });
}

async function isAdmin() {
  // Admin mode requires GitHub login as Lexer-Lux
  const data = await chrome.storage.local.get(["githubToken", "githubUser"]);
  if (!data.githubToken || !data.githubUser) return false;
  return data.githubUser.login?.toLowerCase() === "lexer-lux";
}

// Build a lookup map: handle -> { reasons[], note, tweetUrl }
async function buildHandleMap() {
  const list = await getBlocklist();
  const map = {};
  for (const entry of list.entries) {
    map[entry.handle.toLowerCase()] = entry;
  }
  return map;
}
