// Slopbuster Content Script — injected into Twitter/X

(function () {
  "use strict";

  let handleMap = {};
  let preferences = {};
  let adminMode = false;
  let reasonsCache = [];

  // ── Initialization ──────────────────────────────────────────────────

  async function init() {
    handleMap = await buildHandleMap();
    preferences = await getPreferences();
    adminMode = await isAdmin();
    reasonsCache = await getReasons();

    syncThemeColors();
    observeTimeline();
    processAll();

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.blocklist) {
        buildHandleMap().then(m => { handleMap = m; processAll(); });
      }
      if (changes.preferences) {
        getPreferences().then(p => { preferences = p; processAll(); });
      }
      if (changes.adminKey) {
        isAdmin().then(a => { adminMode = a; });
      }
      if (changes.customReasons) {
        getReasons().then(r => { reasonsCache = r; processAll(); });
      }
    });
  }

  // ── Dynamic theme color extraction ──────────────────────────────────

  function syncThemeColors() {
    applyTheme();
    const themeObserver = new MutationObserver(() => applyTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
  }

  function applyTheme() {
    const body = document.body;
    const bg = getComputedStyle(body).backgroundColor || "rgb(255, 255, 255)";
    const bgRgb = parseRgb(bg);
    const isLight = (bgRgb.r + bgRgb.g + bgRgb.b) / 3 > 128;

    const defaultText = isLight ? "rgb(15, 20, 25)" : "rgb(231, 233, 234)";
    const defaultSecondary = isLight ? "rgb(83, 100, 113)" : "rgb(113, 118, 123)";

    const textEl = document.querySelector('[data-testid="tweetText"]')
      || document.querySelector('[data-testid="UserName"]')
      || document.querySelector('nav [role="link"] span')
      || document.querySelector('h2[role="heading"] span');
    let textColor = textEl ? getComputedStyle(textEl).color : defaultText;

    const timeEl = document.querySelector('time');
    let secondaryColor = timeEl ? getComputedStyle(timeEl).color : defaultSecondary;

    const linkEl = document.querySelector('a[role="link"][href^="/"]');
    const accentColor = linkEl ? getComputedStyle(linkEl).color : "rgb(29, 155, 240)";

    // Safety: if detected text color is too close to the background, use defaults
    if (colorDistance(bgRgb, parseRgb(textColor)) < 50) {
      textColor = defaultText;
    }
    if (colorDistance(bgRgb, parseRgb(secondaryColor)) < 30) {
      secondaryColor = defaultSecondary;
    }
    const surfaceOffset = isLight ? -10 : 15;
    const surface = `rgb(${clamp(bgRgb.r + surfaceOffset)}, ${clamp(bgRgb.g + surfaceOffset)}, ${clamp(bgRgb.b + surfaceOffset)})`;
    const borderOffset = isLight ? -30 : 30;
    const border = `rgb(${clamp(bgRgb.r + borderOffset)}, ${clamp(bgRgb.g + borderOffset)}, ${clamp(bgRgb.b + borderOffset)})`;
    const hoverOffset = isLight ? -15 : 10;
    const hoverBg = `rgb(${clamp(bgRgb.r + hoverOffset)}, ${clamp(bgRgb.g + hoverOffset)}, ${clamp(bgRgb.b + hoverOffset)})`;

    const root = document.documentElement;
    root.style.setProperty("--sb-bg", bg);
    root.style.setProperty("--sb-surface", surface);
    root.style.setProperty("--sb-border", border);
    root.style.setProperty("--sb-text", textColor);
    root.style.setProperty("--sb-secondary", secondaryColor);
    root.style.setProperty("--sb-accent", accentColor);
    root.style.setProperty("--sb-hover", hoverBg);
    root.style.setProperty("--sb-danger", "rgb(244, 33, 46)");
    root.style.setProperty("--sb-danger-hover", "rgb(220, 29, 40)");
    root.style.setProperty("--sb-overlay", isLight ? "rgba(0, 0, 0, 0.4)" : "rgba(91, 112, 131, 0.4)");
  }

  function parseRgb(str) {
    const m = str.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 0, g: 0, b: 0 };
  }

  function clamp(v) {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  function colorDistance(a, b) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  // ── MutationObserver ────────────────────────────────────────────────

  function observeTimeline() {
    const observer = new MutationObserver(() => {
      processAll();
      if (adminMode) {
        injectTweetBustButtons();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Process everything: tweets + profile page + hover cards ──────────

  function processAll() {
    processVisibleTweets();
    processProfilePage();
    processHoverCards();
  }

  // ── Process Twitter hover cards (inject Slopbuster info) ────────────

  function processHoverCards() {
    // Twitter's hover card appears as a div with role="dialog" or in a portal
    // Look for the "Profile Summary" button and replace/augment it
    const hoverCards = document.querySelectorAll('[data-testid="HoverCard"], [data-testid="hoverCard"]');

    hoverCards.forEach(card => {
      if (card.querySelector(".slopbuster-hovercard-info")) return; // Already processed

      // Find handle from the card
      const handleLink = card.querySelector('a[href^="/"][role="link"]');
      if (!handleLink) return;

      const href = handleLink.getAttribute("href");
      const handleMatch = href?.match(/^\/([A-Za-z0-9_]+)$/);
      if (!handleMatch) return;

      const handle = handleMatch[1].toLowerCase();
      const entry = handleMap[handle];

      // Find the Profile Summary button (Grok)
      const grokButton = card.querySelector('button[aria-label*="Summary"], button[aria-label*="Grok"]')
        || Array.from(card.querySelectorAll("button")).find(btn =>
            btn.textContent?.includes("Profile Summary") || btn.textContent?.includes("Grok"));

      if (grokButton && entry) {
        // Replace Grok button with Slopbuster info
        const slopInfo = document.createElement("div");
        slopInfo.className = "slopbuster-hovercard-info";

        const reasonTags = entry.reasons.map(rId => {
          const found = reasonsCache.find(r => r.id === rId);
          const label = found ? found.label : rId;
          const color = found?.color || "#f44336";
          return `<span class="slopbuster-hovercard-tag" style="background:${color}">${escapeHtml(label)}</span>`;
        }).join("");

        slopInfo.innerHTML = `
          <div class="slopbuster-hovercard-header">
            <svg viewBox="0 0 24 24" class="slopbuster-hovercard-icon"><path d="M4 2 L4 22 M4 4 L20 4 L16 10 L20 16 L4 16" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            <span>Flagged by Slopbuster</span>
          </div>
          <div class="slopbuster-hovercard-tags">${reasonTags}</div>
          ${entry.note ? `<div class="slopbuster-hovercard-note">${escapeHtml(entry.note)}</div>` : ""}
        `;

        grokButton.parentElement?.replaceChild(slopInfo, grokButton);
      } else if (entry && !grokButton) {
        // No Grok button but user is flagged - append info at the end
        const existingInfo = card.querySelector(".slopbuster-hovercard-info");
        if (existingInfo) return;

        const slopInfo = document.createElement("div");
        slopInfo.className = "slopbuster-hovercard-info";

        const reasonTags = entry.reasons.map(rId => {
          const found = reasonsCache.find(r => r.id === rId);
          const label = found ? found.label : rId;
          const color = found?.color || "#f44336";
          return `<span class="slopbuster-hovercard-tag" style="background:${color}">${escapeHtml(label)}</span>`;
        }).join("");

        slopInfo.innerHTML = `
          <div class="slopbuster-hovercard-header">
            <svg viewBox="0 0 24 24" class="slopbuster-hovercard-icon"><path d="M4 2 L4 22 M4 4 L20 4 L16 10 L20 16 L4 16" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            <span>Flagged by Slopbuster</span>
          </div>
          <div class="slopbuster-hovercard-tags">${reasonTags}</div>
          ${entry.note ? `<div class="slopbuster-hovercard-note">${escapeHtml(entry.note)}</div>` : ""}
        `;

        card.appendChild(slopInfo);
      }
    });
  }

  // ── Process tweets: hide / flag / show ──────────────────────────────

  function processVisibleTweets() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    tweets.forEach(processTweet);
  }

  function getHandleFromArticle(article) {
    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const links = userNameEl.querySelectorAll("a");
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href && /^\/[A-Za-z0-9_]+$/.test(href)) {
          return href.slice(1).toLowerCase();
        }
      }
    }
    const allLinks = article.querySelectorAll('a[role="link"]');
    for (const link of allLinks) {
      const href = link.getAttribute("href");
      if (href && /^\/[A-Za-z0-9_]+$/.test(href)) {
        return href.slice(1).toLowerCase();
      }
    }
    return null;
  }

  function processTweet(article) {
    const handle = getHandleFromArticle(article);
    if (!handle) return;

    const entry = handleMap[handle];
    if (!entry) {
      removeTweetOverlay(article);
      return;
    }

    // Already processed
    if (article.getAttribute("data-slopbuster-handle") === handle
        && article.querySelector(".slopbuster-badge, .slopbuster-hidden-placeholder")) {
      return;
    }

    let action = "show";
    for (const reason of entry.reasons) {
      const pref = preferences[reason] || "flag";
      if (pref === "hide") { action = "hide"; break; }
      if (pref === "flag") action = "flag";
    }

    applyTweetAction(article, action, entry);
    article.setAttribute("data-slopbuster-handle", handle);
  }

  function applyTweetAction(article, action, entry) {
    removeTweetOverlay(article);

    if (action === "show") return;

    if (action === "hide") {
      article.setAttribute("data-slopbuster", "hidden");
      const wrapper = document.createElement("div");
      wrapper.className = "slopbuster-hidden-placeholder";
      wrapper.innerHTML = `
        <span class="slopbuster-hidden-text">
          Hidden by Slopbuster — @${entry.handle}
        </span>
        <button class="slopbuster-reveal-btn">Reveal</button>
      `;
      wrapper.querySelector(".slopbuster-reveal-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        article.removeAttribute("data-slopbuster");
        wrapper.remove();
      });
      article.style.position = "relative";
      article.appendChild(wrapper);
    }

    if (action === "flag") {
      article.setAttribute("data-slopbuster", "flagged");
      // Inject badge into the User-Name row, before existing badges
      const userNameEl = article.querySelector('[data-testid="User-Name"]');
      if (userNameEl) {
        injectBadge(userNameEl, entry);
      }
    }
  }

  function removeTweetOverlay(article) {
    article.removeAttribute("data-slopbuster");
    article.removeAttribute("data-slopbuster-handle");
    article.querySelectorAll(".slopbuster-hidden-placeholder, .slopbuster-badge").forEach(el => el.remove());
  }

  // ── Process profile page ────────────────────────────────────────────

  function processProfilePage() {
    const pathMatch = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/?$/);
    if (!pathMatch) {
      // Not a profile page — clean up any stale profile badge
      document.querySelectorAll('[data-testid="UserName"] .slopbuster-badge').forEach(el => el.remove());
      return;
    }

    const handle = pathMatch[1].toLowerCase();
    const entry = handleMap[handle];
    const profileNameEl = document.querySelector('[data-testid="UserName"]');
    if (!profileNameEl) return;

    // Already injected
    if (profileNameEl.querySelector(".slopbuster-badge")) {
      if (!entry) profileNameEl.querySelector(".slopbuster-badge").remove();
      return;
    }

    if (!entry) return;

    // Determine action
    let action = "show";
    for (const reason of entry.reasons) {
      const pref = preferences[reason] || "flag";
      if (pref === "hide") { action = "hide"; break; }
      if (pref === "flag") action = "flag";
    }

    if (action === "flag" || action === "hide") {
      injectBadge(profileNameEl, entry);
    }
  }

  // ── Badge injection (shared between tweet and profile) ──────────────
  // Finds the display name's container and prepends the flag badge before
  // any existing verification/corporate badges.

  function injectBadge(userNameContainer, entry) {
    // Already has one
    if (userNameContainer.querySelector(".slopbuster-badge")) return;

    const badge = document.createElement("span");
    badge.className = "slopbuster-badge";
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", "Flagged by Slopbuster");

    // Flag icon as inline SVG to match Twitter badge sizing
    badge.innerHTML = `<svg viewBox="0 0 24 24" class="slopbuster-badge-svg" aria-hidden="true"><path d="M4 2 L4 22 M4 4 L20 4 L16 10 L20 16 L4 16" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

    // Build reason tags for tooltip
    const reasonTags = entry.reasons.map(rId => {
      const found = reasonsCache.find(r => r.id === rId);
      const label = found ? found.label : rId;
      const pref = preferences[rId] || "flag";
      return `<span class="slopbuster-reason-tag slopbuster-reason-${pref}">${escapeHtml(label)}</span>`;
    });

    const tooltip = document.createElement("div");
    tooltip.className = "slopbuster-badge-tooltip";
    tooltip.innerHTML = `
      <div class="slopbuster-tooltip-header">Slopbuster</div>
      <div class="slopbuster-tooltip-handle">@${escapeHtml(entry.handle)}</div>
      <div class="slopbuster-tooltip-tags">${reasonTags.join("")}</div>
      ${entry.note ? `<div class="slopbuster-note">${escapeHtml(entry.note)}</div>` : ""}
    `;
    badge.appendChild(tooltip);

    // Click opens the database page filtered to this user
    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = chrome.runtime.getURL(`database.html?q=${encodeURIComponent(entry.handle)}`);
      window.open(url, "_blank");
    });

    // Stop hover events from triggering Twitter's profile hover card
    badge.addEventListener("mouseenter", (e) => {
      e.stopPropagation();
    });
    badge.addEventListener("mouseover", (e) => {
      e.stopPropagation();
    });

    // Strategy: Insert badge INSIDE the display name's innermost text container
    // to stay on the same line, just like Twitter's verification badges.

    // Find the display name link
    const nameLink = userNameContainer.querySelector('a[role="link"]');

    if (nameLink) {
      // Find the innermost span containing the actual display name text
      // Twitter structure: a > div > div > span > span (text)
      // We want to append to the parent of the text-containing span
      const spans = nameLink.querySelectorAll("span");
      let targetContainer = null;

      // Find the deepest span that contains text (the display name)
      for (const span of spans) {
        // Check if this span directly contains text (not just child elements)
        const hasDirectText = Array.from(span.childNodes).some(
          node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
        );
        if (hasDirectText) {
          // Use the parent of the text span as our target
          targetContainer = span.parentElement;
          break;
        }
      }

      // If we found a text container, append badge there
      if (targetContainer) {
        targetContainer.appendChild(badge);
        return;
      }

      // Fallback: append directly inside the link
      nameLink.appendChild(badge);
      return;
    }

    // Fallback for profile pages without standard link structure
    // Profile structure: [data-testid="UserName"] > div > div > span (display name)
    // Find any span containing direct text and append badge to its parent
    const allSpans = userNameContainer.querySelectorAll("span");
    for (const span of allSpans) {
      const hasDirectText = Array.from(span.childNodes).some(
        node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      );
      if (hasDirectText) {
        // Insert badge right after the text-containing span
        span.parentElement.appendChild(badge);
        return;
      }
    }

    // Last resort fallback
    userNameContainer.appendChild(badge);
  }

  // ── Tweet bust button injection (admin only) ────────────────────────

  function injectTweetBustButtons() {
    if (!adminMode) return;

    const menus = document.querySelectorAll('[data-testid="Dropdown"]');
    menus.forEach(menu => {
      if (menu.querySelector(".slopbuster-bust-option")) return;

      const menuItems = menu.querySelectorAll('[role="menuitem"]');
      if (menuItems.length === 0) return;

      const bustItem = createBustMenuItem();

      bustItem.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const context = detectBustContext(menu);
        if (!context) return;

        document.body.click();
        openBustModal(context);
      });

      menu.appendChild(bustItem);
    });
  }

  // ── Detect whether the dropdown is for a tweet or a profile ─────────

  function detectBustContext(menu) {
    const expandedBtn = document.querySelector('[data-testid="caret"][aria-expanded="true"]');
    if (expandedBtn) {
      const article = expandedBtn.closest('article[data-testid="tweet"]');
      if (article) {
        const info = extractTweetInfo(article);
        if (info) return info;
      }
    }

    const userActionsBtn = document.querySelector('[data-testid="userActions"][aria-expanded="true"]');
    if (userActionsBtn) {
      const info = extractProfileInfo();
      if (info) return info;
    }

    let node = menu;
    while (node && node !== document.body) {
      if (node.tagName === "ARTICLE") {
        const info = extractTweetInfo(node);
        if (info) return info;
      }
      node = node.parentElement;
    }

    const profileMatch = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/?$/);
    if (profileMatch) {
      return extractProfileInfo();
    }

    return null;
  }

  function extractTweetInfo(article) {
    let handle = null;
    let displayName = null;
    let tweetUrl = null;

    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const links = userNameEl.querySelectorAll("a");
      for (const link of links) {
        const href = link.getAttribute("href");
        if (href && /^\/[A-Za-z0-9_]+$/.test(href) && !handle) {
          handle = href.slice(1);
        }
      }
      const spans = userNameEl.querySelectorAll("span");
      if (spans.length > 0) displayName = spans[0].textContent;
    }

    const allLinks = article.querySelectorAll('a[role="link"]');
    for (const link of allLinks) {
      const href = link.getAttribute("href");
      if (href && /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(href)) {
        tweetUrl = "https://x.com" + href;
        break;
      }
    }

    if (!tweetUrl) {
      const statusMatch = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/\d+/);
      if (statusMatch) {
        tweetUrl = window.location.href.split("?")[0];
        if (!handle) handle = statusMatch[1];
      }
    }

    if (!handle) return null;

    return {
      handle,
      displayName: displayName || handle,
      proofUrl: tweetUrl || `https://x.com/${handle}`,
      source: "tweet"
    };
  }

  function extractProfileInfo() {
    const pathMatch = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/?$/);
    if (!pathMatch) return null;

    const handle = pathMatch[1];
    let displayName = handle;
    const profileHeader = document.querySelector('[data-testid="UserName"]');
    if (profileHeader) {
      const spans = profileHeader.querySelectorAll("span");
      if (spans.length > 0) displayName = spans[0].textContent;
    }

    return {
      handle,
      displayName,
      proofUrl: `https://x.com/${handle}`,
      source: "profile"
    };
  }

  // ── Shared menu item creator ────────────────────────────────────────

  function createBustMenuItem() {
    const bustItem = document.createElement("div");
    bustItem.setAttribute("role", "menuitem");
    bustItem.className = "slopbuster-bust-option";
    bustItem.tabIndex = 0;
    bustItem.innerHTML = `
      <div class="slopbuster-bust-option-inner">
        <span class="slopbuster-bust-icon">\u{1F4A5}</span>
        <span>Bust</span>
      </div>
    `;
    return bustItem;
  }

  // ── Bust modal ──────────────────────────────────────────────────────

  async function openBustModal(info) {
    document.querySelector(".slopbuster-modal-overlay")?.remove();

    const sourceLabel = info.source === "profile" ? "Profile" : "Tweet";

    // Fetch current reasons (may include custom categories)
    const reasons = await getReasons();

    const overlay = document.createElement("div");
    overlay.className = "slopbuster-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "slopbuster-modal";

    modal.innerHTML = `
      <div class="slopbuster-modal-header">
        <h2>Bust @${escapeHtml(info.handle)}</h2>
        <button class="slopbuster-modal-close">&times;</button>
      </div>
      <div class="slopbuster-modal-body">
        <p class="slopbuster-modal-sub">${escapeHtml(info.displayName)}</p>
        <p class="slopbuster-modal-source">${sourceLabel} bust</p>
        <p class="slopbuster-modal-url">${escapeHtml(info.proofUrl)}</p>
        <div class="slopbuster-reasons">
          <label class="slopbuster-label">Reason(s):</label>
          ${reasons.map(r => `
            <label class="slopbuster-checkbox-label">
              <input type="checkbox" name="reason" value="${r.id}">
              ${escapeHtml(r.label)}
            </label>
          `).join("")}
        </div>
        <div class="slopbuster-note-row">
          <label class="slopbuster-label">Note (optional):</label>
          <textarea class="slopbuster-note-input" rows="2" placeholder="Additional info..."></textarea>
        </div>
      </div>
      <div class="slopbuster-modal-footer">
        <button class="slopbuster-btn slopbuster-btn-cancel">Cancel</button>
        <button class="slopbuster-btn slopbuster-btn-bust">Bust 'em</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Helper to check if any data has been entered
    function hasUnsavedChanges() {
      const anyChecked = modal.querySelectorAll('input[name="reason"]:checked').length > 0;
      const hasNote = modal.querySelector(".slopbuster-note-input").value.trim().length > 0;
      return anyChecked || hasNote;
    }

    // Beforeunload handler to prevent accidental navigation
    function preventUnload(e) {
      e.preventDefault();
      return e.returnValue = "";
    }

    // Add beforeunload handler while modal is open
    window.addEventListener("beforeunload", preventUnload);

    // Close modal with cleanup
    function closeModal() {
      window.removeEventListener("beforeunload", preventUnload);
      overlay.remove();
    }

    // Close with confirmation if changes exist
    function closeWithConfirm() {
      if (hasUnsavedChanges() && !confirm("Discard changes?")) return;
      closeModal();
    }

    modal.querySelector(".slopbuster-modal-close").addEventListener("click", closeWithConfirm);
    modal.querySelector(".slopbuster-btn-cancel").addEventListener("click", closeWithConfirm);
    // Note: Overlay click-to-close intentionally removed to prevent accidental dismissal

    modal.querySelector(".slopbuster-btn-bust").addEventListener("click", async () => {
      const checked = [...modal.querySelectorAll('input[name="reason"]:checked')].map(cb => cb.value);
      if (checked.length === 0) {
        modal.querySelector(".slopbuster-reasons").classList.add("slopbuster-error");
        return;
      }

      const note = modal.querySelector(".slopbuster-note-input").value.trim();

      const entry = {
        handle: info.handle,
        displayName: info.displayName,
        proofUrl: info.proofUrl,
        source: info.source,
        reasons: checked,
        note
      };

      await addEntry(entry);
      handleMap = await buildHandleMap();
      processAll();
      closeModal();
    });
  }

  // ── Utilities ───────────────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Start ───────────────────────────────────────────────────────────
  init();
})();
