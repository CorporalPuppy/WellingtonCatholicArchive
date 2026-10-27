// ===========================================================================
// Loads the day's Mass readings from Universalis into the Readings page.
//
// This runs in the visitor's web browser (Universalis asks that their
// readings are loaded this way, not copied by our server).
//
// How it works:
//   1. We add a <script> tag pointing at Universalis's feed.
//   2. Universalis's feed calls universalisCallback(data) with the readings.
//   3. For every piece of data, we look for an element on the page whose id
//      is "Universalis_" + its name (e.g. "Universalis_Mass_G.text" for the
//      text of the Gospel) and put the text in it.
//   4. We then show the sections that got filled in.
// ===========================================================================

// Called by Universalis's feed with the day's readings.
function universalisCallback(data) {
  for (const name in data) {
    const value = data[name];
    if (typeof value === "string") {
      fillElement("Universalis_" + name, value);
    } else if (value !== null && typeof value === "object") {
      // e.g. data.Mass_G = { heading: "...", source: "Luke 13:10-17", text: "..." }
      for (const part in value) {
        fillElement("Universalis_" + name + "." + part, value[part]);
      }
    }
  }
  showFilledSections();
}

// Puts some text (which Universalis sends as HTML) into the element with this id.
function fillElement(id, html) {
  const element = document.getElementById(id);
  if (element !== null && typeof html === "string" && html.trim() !== "") {
    element.innerHTML = html;
    element.dataset.filled = "yes";
  }
}

// Each reading is in a <section data-universalis-section>. Show only the
// ones that received some text (e.g. weekdays have no Reading 2).
function showFilledSections() {
  const sections = document.querySelectorAll("[data-universalis-section]");
  let anyFilled = false;
  for (const section of sections) {
    if (section.querySelector("[data-filled]") !== null) {
      section.hidden = false;
      anyFilled = true;
    }
  }
  document.getElementById("readings-loading").hidden = true;
  if (!anyFilled) {
    document.getElementById("readings-failed").hidden = false;
  }
}

// Start loading. The page tells us which address to use.
const readingsPage = document.getElementById("universalis-readings");
if (readingsPage !== null) {
  const script = document.createElement("script");
  script.src = readingsPage.dataset.feedUrl;
  // If Universalis can't be reached, say so (instead of loading forever).
  script.onerror = function () {
    document.getElementById("readings-loading").hidden = true;
    document.getElementById("readings-failed").hidden = false;
  };
  document.body.appendChild(script);

  // If nothing has arrived after 10 seconds, stop waiting.
  setTimeout(function () {
    const loading = document.getElementById("readings-loading");
    if (!loading.hidden) {
      loading.hidden = true;
      document.getElementById("readings-failed").hidden = false;
    }
  }, 10000);
}
