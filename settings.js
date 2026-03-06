// Slopbuster Settings Page

document.addEventListener("DOMContentLoaded", async () => {
  await renderReasonFilters();

  // Listen for category changes to update the filters
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.customReasons) {
      renderReasonFilters();
    }
  });
});

// ── Render reason filter rows ────────────────────────────────────────

async function renderReasonFilters() {
  const reasonsList = document.getElementById("reasonsList");
  reasonsList.innerHTML = "";

  const reasons = await getReasons();
  const prefs = await getPreferences();

  reasons.forEach(reason => {
    const row = document.createElement("div");
    row.className = "reason-row";

    const labelWrap = document.createElement("div");
    labelWrap.className = "reason-label-wrap";

    // Color indicator
    if (reason.color) {
      const colorDot = document.createElement("span");
      colorDot.className = "reason-color-dot";
      colorDot.style.backgroundColor = reason.color;
      labelWrap.appendChild(colorDot);
    }

    const label = document.createElement("span");
    label.className = "reason-label";
    label.textContent = reason.label;
    labelWrap.appendChild(label);

    if (reason.description) {
      const desc = document.createElement("span");
      desc.className = "reason-desc";
      desc.textContent = reason.description;
      labelWrap.appendChild(desc);
    }

    const radios = document.createElement("div");
    radios.className = "reason-radios";

    ["show", "flag", "hide"].forEach(value => {
      const id = `${reason.id}_${value}`;
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = reason.id;
      radio.id = id;
      radio.value = value;
      radio.checked = (prefs[reason.id] || "flag") === value;

      radio.addEventListener("change", async () => {
        const current = await getPreferences();
        current[reason.id] = value;
        await savePreferences(current);
        showStatus("Saved!");
      });

      const radioLabel = document.createElement("label");
      radioLabel.htmlFor = id;
      radioLabel.className = `radio-label radio-${value}`;
      radioLabel.textContent = value.charAt(0).toUpperCase() + value.slice(1);

      radios.appendChild(radio);
      radios.appendChild(radioLabel);
    });

    row.appendChild(labelWrap);
    row.appendChild(radios);
    reasonsList.appendChild(row);
  });
}

function showStatus(msg) {
  const el = document.getElementById("saveStatus");
  el.textContent = msg;
  el.style.opacity = 1;
  setTimeout(() => { el.style.opacity = 0; }, 1500);
}
