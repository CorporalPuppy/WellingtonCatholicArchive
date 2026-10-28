// ===========================================================================
// The print page (/files/:id/print).
//
// Draws the file as pages here in the browser, then opens the print window:
//   PDFs        with pdf.js (Mozilla's PDF reader, in public/vendor/pdfjs)
//   Word files  with docx-preview (public/vendor/docx-preview), which needs
//               JSZip (public/vendor/jszip) to open the .docx
//   pictures and text files as they are
//
// Printing a PDF from a hidden frame works on some computers but not on
// phones (iPhones print just the first page, or nothing). Drawing the pages
// ourselves works the same everywhere, and costs the site nothing extra.
// ===========================================================================

(function () {
  const pages = document.getElementById("print-pages");
  const status = document.getElementById("print-status");
  const printButton = document.getElementById("print-button");
  const fileUrl = pages.dataset.file;
  const printAs = pages.dataset.printAs;

  printButton.addEventListener("click", function () {
    window.print();
  });

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Couldn't load " + src));
      };
      document.head.appendChild(script);
    });
  }

  async function fetchFile() {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error("Couldn't get the file (" + response.status + ")");
    }
    return response;
  }

  // Each PDF page becomes a picture. Scale 2 is about 150 dots per inch:
  // sharp on paper, and small enough for a phone's memory.
  async function drawPdf() {
    await loadScript("/vendor/pdfjs/pdf.min.js");
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument(fileUrl).promise;

    for (let number = 1; number <= pdf.numPages; number++) {
      status.textContent = "Getting page " + number + " of " + pdf.numPages + " ready…";
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 2 });
      if (number === 1) {
        // PDF sizes are in points, which CSS understands too.
        const size = page.getViewport({ scale: 1 });
        setPaperSize(size.width + "pt", size.height + "pt");
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport: viewport }).promise;

      const blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, "image/png");
      });
      // Free the drawing area straight away: phones run out of memory otherwise.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();

      await addPicture(URL.createObjectURL(blob), "Page " + number);
    }
  }

  async function drawWord() {
    await loadScript("/vendor/jszip/jszip.min.js");
    await loadScript("/vendor/docx-preview/docx-preview.min.js");
    const response = await fetchFile();
    const data = await response.blob();
    await window.docx.renderAsync(data, pages, null, {
      // Leaves out the grey background and page shadows when printing.
      hideWrapperOnPrint: true,
      // Headers and footers often hold the copyright line, so keep them.
      renderHeaders: true,
      renderFooters: true,
    });
    // Print on the document's own paper size (A4, Letter...), so a page
    // on screen is a page on paper.
    const firstPage = pages.querySelector("section.docx");
    if (firstPage !== null && firstPage.style.width !== "" && firstPage.style.minHeight !== "") {
      setPaperSize(firstPage.style.width, firstPage.style.minHeight);
    }

    // Let pictures inside the document finish loading.
    await Promise.all(
      Array.from(pages.querySelectorAll("img")).map(function (img) {
        return img.decode().catch(function () {});
      }),
    );

    shrinkLongWordPages();
    fitWordPagesOnScreen();
    window.addEventListener("resize", fitWordPagesOnScreen);
  }

  // The browser's fonts are a little different from Word's, so a chord
  // chart that just fits on one page in Word can come out slightly longer
  // here. Shrink those pages a touch when printing, so one page in Word is
  // still one sheet of paper.
  function shrinkLongWordPages() {
    pages.querySelectorAll("section.docx").forEach(function (section) {
      const pageHeight = parseFloat(getComputedStyle(section).minHeight) * 0.99;
      const height = section.getBoundingClientRect().height;
      if (pageHeight > 0 && height > pageHeight) {
        section.style.setProperty("--print-fit", String(pageHeight / height));
      }
    });
  }

  // Word pages are as wide as paper, so on a phone shrink them to fit the screen.
  function fitWordPagesOnScreen() {
    const wrapper = pages.querySelector(".docx-wrapper");
    const firstPage = pages.querySelector("section.docx");
    if (wrapper === null || firstPage === null) {
      return;
    }
    const fit = Math.min(1, document.documentElement.clientWidth / (firstPage.offsetWidth + 60));
    wrapper.style.setProperty("--screen-fit", String(fit));
  }

  async function drawPicture() {
    await addPicture(fileUrl, "");
  }

  async function drawText() {
    const response = await fetchFile();
    const text = document.createElement("div");
    text.className = "print-text";
    text.textContent = await response.text();
    pages.appendChild(text);
    // Plain text has no margins of its own, so give the paper some.
    const style = document.createElement("style");
    style.textContent = "@page { margin: 15mm; }";
    document.head.appendChild(style);
  }

  async function addPicture(src, alt) {
    const holder = document.createElement("div");
    holder.className = "print-page";
    const img = document.createElement("img");
    img.alt = alt;
    img.src = src;
    holder.appendChild(img);
    pages.appendChild(holder);
    await img.decode().catch(function () {});
  }

  function setPaperSize(width, height) {
    const style = document.createElement("style");
    style.textContent =
      "@page { size: " + width + " " + height + "; }" +
      // A Word page a hair shorter than the paper, so rounding never
      // spills a blank page out after it.
      "@media print { section.docx { min-height: calc(" + height + " - 2mm) !important; } }";
    document.head.appendChild(style);
  }

  const drawers = { pdf: drawPdf, docx: drawWord, image: drawPicture, text: drawText };

  (drawers[printAs] || drawPicture)()
    .then(function () {
      printButton.disabled = false;
      status.textContent = "Ready. If the print window didn't open, press Print.";
      // A short pause lets the page settle before the print window opens.
      setTimeout(function () {
        window.print();
      }, 300);
    })
    .catch(function (error) {
      status.textContent = "Sorry, this file couldn't be got ready to print (" + error.message + "). Try Download instead.";
    });
})();
