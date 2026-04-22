// Content script: runs on apply.aims.ac.za review pages
(function () {
  function onReviewFormReady(callback) {
    if (document.querySelector('.review-form-container')) {
      callback();
      return;
    }
    const observer = new MutationObserver((mutations, obs) => {
      if (document.querySelector('.review-form-container')) {
        obs.disconnect();
        callback();
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  onReviewFormReady(init);

  function init() {

  // Cache fetched blobs so we don't re-download
  let cachedData = null; // { appNum, pdfBlobs: [{ blob, type }] }

  function getApplicationNumber() {
    const el = document.querySelector('.font-weight-bold');
    return el ? el.textContent.trim() : 'unknown';
  }

  function extractPdfs() {
    const appNum = getApplicationNumber();
    const links = document.querySelectorAll('a[href*="prod-api-dot-baobab.appspot.com/api/v1/file"]');
    const pdfs = [];

    links.forEach((link) => {
      const url = link.href;

      const card = link.closest('.card.review-section');
      let cardTitle = '';
      if (card) {
        const h3 = card.querySelector('h3.section-headline');
        if (h3) cardTitle = h3.textContent.trim().toLowerCase();
      }

      let questionLabel = '';
      const questionEl = link.closest('.question.information');
      if (questionEl) {
        const h5 = questionEl.querySelector('h5');
        if (h5) questionLabel = h5.textContent.trim().toLowerCase();
      }

      pdfs.push({ url, cardTitle, questionLabel });
    });

    let repWorkIndex = 0;
    const result = [];

    for (const pdf of pdfs) {
      let type = '';

      if (pdf.cardTitle.includes('academic transcript')) {
        type = 'academic_transcript';
      } else if (pdf.cardTitle.includes('representative work')) {
        const label = pdf.questionLabel;
        if (label.includes('representative work #')) {
          const match = label.match(/#(\d+)/);
          repWorkIndex = match ? parseInt(match[1]) : repWorkIndex + 1;
          type = `representative_work_${repWorkIndex}`;
        } else {
          repWorkIndex++;
          type = `representative_work_${repWorkIndex}`;
        }
      } else if (pdf.cardTitle.includes('curriculum vitae') || pdf.cardTitle.includes('motivation')) {
        const params = new URLSearchParams(pdf.url.split('?')[1]);
        const rename = (params.get('rename') || '').toLowerCase();
        const label = pdf.questionLabel;

        if (label.includes('cv') || label.includes('curriculum') || rename.includes('cv') || rename.includes('resume') || rename.includes('curriculum')) {
          type = 'cv';
        } else if (label.includes('motivation') || rename.includes('motivation') || rename.includes('letter')) {
          type = 'motivation_letter';
        } else {
          type = 'document';
        }
      } else {
        const params = new URLSearchParams(pdf.url.split('?')[1]);
        const rename = (params.get('rename') || '').toLowerCase();
        if (rename.includes('transcript')) type = 'academic_transcript';
        else if (rename.includes('cv') || rename.includes('resume')) type = 'cv';
        else if (rename.includes('motivation')) type = 'motivation_letter';
        else {
          repWorkIndex++;
          type = `representative_work_${repWorkIndex}`;
        }
      }

      result.push({
        url: pdf.url,
        type: type,
        downloadName: `${appNum}_${type}.pdf`
      });
    }

    return { appNum, pdfs: result };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ── Inline viewer (overlay on the same page) ──

  function buildViewer(appNum, pdfBlobs) {
    const old = document.getElementById('pdv-viewer-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pdv-viewer-overlay';
    overlay.innerHTML = `
      <div class="pdv-v-header">
        <div>
          <span class="pdv-v-title">Application ${appNum}</span>
          <span class="pdv-v-meta">${pdfBlobs.length} documents</span>
        </div>
        <div class="pdv-v-right">
          <span class="pdv-v-shortcuts">
            <span class="pdv-v-kbd">&larr;</span><span class="pdv-v-kbd">&rarr;</span> switch
            &nbsp;&nbsp;
            <span class="pdv-v-kbd">1</span>-<span class="pdv-v-kbd">${pdfBlobs.length}</span> jump
            &nbsp;&nbsp;
            <span class="pdv-v-kbd">Esc</span> close
          </span>
          <button class="pdv-v-close" id="pdv-v-close">&times;</button>
        </div>
      </div>
      <div class="pdv-v-tabs" id="pdv-v-tabs"></div>
      <div class="pdv-v-content" id="pdv-v-content"></div>
    `;
    document.body.appendChild(overlay);

    const tabsEl = overlay.querySelector('#pdv-v-tabs');
    const contentEl = overlay.querySelector('#pdv-v-content');
    let currentIdx = 0;

    const blobUrls = pdfBlobs.map(p => URL.createObjectURL(p.blob));

    function renderTab(idx) {
      currentIdx = idx;
      tabsEl.querySelectorAll('.pdv-v-tab').forEach((t, i) => {
        t.classList.toggle('active', i === idx);
      });
      contentEl.innerHTML = '';
      const embed = document.createElement('embed');
      embed.src = blobUrls[idx];
      embed.type = 'application/pdf';
      embed.style.cssText = 'width:100%;height:100%;border:none;';
      contentEl.appendChild(embed);
    }

    pdfBlobs.forEach((pdf, i) => {
      const tab = document.createElement('button');
      tab.className = 'pdv-v-tab';
      tab.textContent = pdf.type.replace(/_/g, ' ');
      tab.addEventListener('click', () => renderTab(i));
      tabsEl.appendChild(tab);
    });

    renderTab(0);

    overlay.querySelector('#pdv-v-close').addEventListener('click', () => {
      overlay.remove();
    });

    function onKey(e) {
      if (!document.getElementById('pdv-viewer-overlay')) {
        document.removeEventListener('keydown', onKey);
        return;
      }
      if (e.key === 'Escape') {
        overlay.remove();
      } else if (e.key === 'ArrowRight') {
        renderTab((currentIdx + 1) % pdfBlobs.length);
      } else if (e.key === 'ArrowLeft') {
        renderTab((currentIdx - 1 + pdfBlobs.length) % pdfBlobs.length);
      } else if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < pdfBlobs.length) renderTab(idx);
      }
    }
    document.addEventListener('keydown', onKey);
  }

  // ── Main button ──

  const btn = document.createElement('button');
  btn.id = 'pdv-dl-all-btn';
  btn.innerHTML = '📄 Open PDF Viewer';
  document.body.appendChild(btn);

  btn.addEventListener('click', async () => {
    const appNum = getApplicationNumber();

    // Already fetched for this applicant — just open viewer, no re-download
    if (cachedData && cachedData.appNum === appNum) {
      buildViewer(cachedData.appNum, cachedData.pdfBlobs);
      return;
    }

    const info = extractPdfs();
    if (info.pdfs.length === 0) {
      alert('No PDFs found on this page.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '⏳ Loading...';

    try {
      const { saveToDisk } = await new Promise(resolve =>
        chrome.storage.local.get('saveToDisk', resolve)
      );

      const pdfBlobs = [];

      for (let i = 0; i < info.pdfs.length; i++) {
        const pdf = info.pdfs[i];
        btn.innerHTML = `⏳ Fetching ${i + 1}/${info.pdfs.length}...`;

        const resp = await fetch(pdf.url, { credentials: 'include' });
        if (!resp.ok) throw new Error(`Failed to fetch ${pdf.downloadName}: ${resp.status}`);
        const blob = await resp.blob();

        if (saveToDisk) downloadBlob(blob, pdf.downloadName);
        pdfBlobs.push({ blob, type: pdf.type });
      }

      // Cache so second click just opens viewer
      cachedData = { appNum: info.appNum, pdfBlobs };

      btn.disabled = false;
      btn.innerHTML = '📄 Open PDF Viewer';

      buildViewer(info.appNum, pdfBlobs);

    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '📄 Open PDF Viewer';
      alert('Error: ' + err.message);
    }
  });

  } // end init
})();
