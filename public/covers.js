// ===========================================================================
// Faint previews behind the music library's covers.
//
// Each cover with a data-preview-pdf address gets the first page of that
// PDF drawn behind it, once the cover scrolls into view. The drawing is
// done by pdf.js (Mozilla's PDF reader, in public/vendor/pdfjs), here in
// the visitor's browser, so it costs the site nothing extra.
//
// The browser keeps each file it fetches (see /files/:id), so a cover's
// file is only fetched once per browser, until the file is replaced.
// ===========================================================================

(function () {
  const covers = document.querySelectorAll(".score-cover[data-preview-pdf]");
  if (covers.length === 0) {
    return;
  }

  // pdf.js is big, so it's only loaded on pages that need it.
  let pdfjsReady = null;
  function loadPdfjs() {
    if (pdfjsReady === null) {
      pdfjsReady = new Promise(function (resolve, reject) {
        const script = document.createElement("script");
        script.src = "/vendor/pdfjs/pdf.min.js";
        script.onload = function () {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
          resolve(window.pdfjsLib);
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    return pdfjsReady;
  }

  // Draw a few at a time, so a phone doesn't slow down while scrolling.
  const waiting = [];
  let running = 0;
  const AT_ONCE = 2;

  function next() {
    while (running < AT_ONCE && waiting.length > 0) {
      const cover = waiting.shift();
      running += 1;
      drawPreview(cover)
        .catch(function () {
          // No preview (e.g. a damaged PDF): the drawn cover is enough.
        })
        .finally(function () {
          running -= 1;
          next();
        });
    }
  }

  async function drawPreview(cover) {
    const pdfjsLib = await loadPdfjs();
    // Fetch the whole file in one go: one request, which the browser keeps.
    const response = await fetch(cover.dataset.previewPdf);
    if (!response.ok) {
      return;
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: data, isEvalSupported: false }).promise;
    const page = await pdf.getPage(1);

    // Sharp enough for the cover's size on this screen, and no more.
    const unscaled = page.getViewport({ scale: 1 });
    const scale = (cover.clientWidth * (window.devicePixelRatio || 1)) / unscaled.width;
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement("canvas");
    canvas.className = "score-cover-preview";
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
    pdf.destroy();

    cover.prepend(canvas);
    // Fade in (see .score-cover-preview in styles.css).
    requestAnimationFrame(function () {
      canvas.classList.add("shown");
    });
  }

  // Start a cover once it's on screen, or nearly.
  const watcher = new IntersectionObserver(
    function (entries) {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          watcher.unobserve(entry.target);
          waiting.push(entry.target);
        }
      }
      next();
    },
    { rootMargin: "300px 0px" },
  );
  covers.forEach(function (cover) {
    watcher.observe(cover);
  });
})();
