/**
 * Content Script — マルチプロバイダ対応のメールトラッキング
 *
 * 対応先:
 *   - Gmail (mail.google.com)  — 既存動作を維持
 *   - QQメール (mail.qq.com / wx.mail.qq.com)
 *
 * FR-EXT-01: Track トグルボタン表示
 * FR-EXT-02: 送信時に API POST → tracking 情報取得
 * FR-EXT-03: メール本文末尾に 1×1 透明 GIF 挿入
 * FR-EXT-04: 本文内 URL をトラッキング URL に書き換え
 *
 * manifest の all_frames=true により各 iframe でも実行される。
 * QQメールの Compose / 本文エディタは iframe 内にあることが多いため、
 * 各 frame が自分の document だけをスキャンし、見つかった場所で処理する。
 */

// ============================================================
// Platform detection
// ============================================================
var LOG = '[pixletter:qq]';
var injectedSendBtns = new WeakSet();
var controllers = [];              // 已注入追踪开关的写信窗口（点击 / 快捷键共用）
var keyboardListenerAdded = false;
var IS_TOP = window === window.top;
var HOST = location.hostname;

var PLATFORM =
  /(^|\.)mail\.google\.com$/.test(HOST) ? 'gmail' :
  /(^|\.)mail\.qq\.com$/.test(HOST) ? 'qqmail' :
  /(^|\.)wx\.qq\.com$/.test(HOST) ? 'qqmail' :
  null;

if (PLATFORM) console.log(LOG, 'content script loaded', { host: HOST, top: IS_TOP, platform: PLATFORM });

// ============================================================
// Provider definitions — 各メールサービスの DOM 差分をここに閉じ込める
// ============================================================
var PROVIDERS = {
  gmail: {
    findSendButtons: function (root) {
      return root.querySelectorAll('.T-I.J-J5-Ji.aoO[role="button"]');
    },
    compose: function (btn) {
      return btn.closest('.nH.Hd') || btn.closest('[role="dialog"]') || btn.closest('.AD');
    },
    toggleHost: function (btn) {
      return btn.parentElement;
    },
    body: function (composeEl) {
      return composeEl && composeEl.querySelector('[role="textbox"][contenteditable="true"]');
    },
    extract: extractGmail,
    isSentFolder: function () {
      return location.hash.indexOf('#sent') !== -1 || location.hash.indexOf('#label/Sent') !== -1;
    },
    statusRows: function () {
      return document.querySelectorAll('tr.zA');
    },
    statusSubject: function (row) {
      var el = row.querySelector('.bog .bqe, .bog span[data-thread-id]');
      return el ? el.textContent.trim() : '';
    },
    statusTarget: function (row) {
      return row.querySelector('.bog') || row.querySelector('.xT');
    },
  },

  qqmail: {
    findSendButtons: function (root) {
      var sels = [
        // 実 DOM で確認済み (wx.mail.qq.com / XMail):
        //   <div class="xmail-ui-btn ui-btn-size32 ui-btn-border ui-btn-them-blue-lighten"
        //        data-a11y="button" ...> ... <div class="ui-btn-text">发送</div>
        // 青テーマ (ui-btn-them-blue*) のうち、実際に「发送」文言を持つものだけを採る。
        '.xmail-page-root .xmail-ui-btn[class*="ui-btn-them-blue"]',
        '.mail-compose-header .xmail-ui-btn[class*="ui-btn-them-blue"]',
        '.xmail-page-root [data-a11y="button"][class*="ui-btn-them-blue"]',
        // 旧版 / 汎用
        '#sendbtn', '#sendBtn', '#send_button',
        'a[node-type="send"]', 'button[node-type="send"]',
        '.btn_send', '.compose_send', '.qm-send',
        '[data-action="send"]',
      ];
      var found = [];
      var seen = new Set();
      sels.forEach(function (sel) {
        try {
          root.querySelectorAll(sel).forEach(function (el) {
            if (!seen.has(el)) { seen.add(el); found.push(el); }
          });
        } catch (e) { /* invalid selector on old browser — skip */ }
      });
      // 「发送」文言で絞り込む（青ボタンには「保存草稿」「定时发送」等も混ざるため）
      var exact = found.filter(function (el) {
        var t = (el.textContent || '').trim();
        return t === '发送' || t === '发送邮件';
      });
      if (exact.length > 0) found = exact;

      // テキスト「发送」によるフォールバック（class が頻繁に変わるため最終手段）
      if (found.length === 0) {
        var cands = root.querySelectorAll('a, button, div[data-a11y="button"], div[role="button"], span[role="button"]');
        for (var i = 0; i < cands.length; i++) {
          var t2 = (cands[i].textContent || '').trim();
          if (t2 === '发送' || t2 === '发送邮件') found.push(cands[i]);
        }
      }
      return found;
    },
    compose: function (btn) {
      var sels = [
        // XMail: ページ全体を Compose コンテナとして扱う（主題/宛先/本文がすべて含まれる）
        '.xmail-page-root',
        '.compose_window', '#composeWindow', '.compose-container',
        '.mail-compose', '[class*="compose_win"]', '[class*="composeWindow"]',
        '.mail-compose-header',
      ];
      for (var i = 0; i < sels.length; i++) {
        try {
          var el = btn.closest(sels[i]);
          if (el) return el;
        } catch (e) { /* ignore */ }
      }
      // フォールバック: 主題入力を持つ直近の祖先
      var p = btn;
      for (var d = 0; p && d < 8; p = p.parentElement, d++) {
        if (p.querySelector && p.querySelector('input[name="subject"], #subject, [placeholder*="主题"]')) {
          return p;
        }
      }
      return btn.parentElement && btn.parentElement.parentElement;
    },
    toggleHost: function (btn) {
      // XMail: 送信ボタンが「その他」メニュー (ui-toolbar-ellipsis) 内にあり、
      // そこへ入れるとメニューを閉じた際に非表示になる → 常に見える header に置く
      try {
        var header = btn.closest('.mail-compose-header');
        if (header) return header;
      } catch (e) { /* ignore */ }
      return btn.parentElement;
    },
    body: function (composeEl) {
      // 0) この frame 自体がエディタ iframe の場合
      if (document.body && (document.body.isContentEditable ||
          document.body.getAttribute && document.body.getAttribute('contenteditable') === 'true')) {
        return document.body;
      }
      // 1) 実 DOM で確認済みの XMail エディタ（最も固定的な id/class を優先）:
      //    <div id="contentDiv_0" class="xmail-cmp-editor-content mail-content-editor-inner"
      //         aria-label="输入正文" contenteditable="true">
      var precise = firstMatch([
        '#contentDiv_0',
        '.xmail-cmp-editor-content[contenteditable="true"]',
        '.mail-content-editor-inner[contenteditable="true"]',
        '.xmail-cmp-editor [contenteditable="true"]',
        '[aria-label="输入正文"][contenteditable="true"]',
      ]);
      if (precise) { console.log(LOG, 'body -> precise editor', precise.id || precise.className); return precise; }

      // 2) 面积最大の contenteditable（ツールバーの小さなものを避ける）
      var xmailBody = pickLargestEditable(
        document.querySelectorAll('.xmail-page-root [contenteditable="true"], .xmail-page-root [contenteditable="plaintext-only"]')
      );
      if (xmailBody) { console.log(LOG, 'body -> largest editable', xmailBody.id || xmailBody.className); return xmailBody; }

      // 3) 同じ document 内の contenteditable
      var direct = null;
      if (composeEl) {
        direct = composeEl.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"], .qm_editor [contenteditable], .edit_area [contenteditable]');
      }
      if (!direct) {
        direct = document.querySelector('[contenteditable="true"][role="textbox"], .qm_editor [contenteditable="true"]');
      }
      if (direct) return direct;

      // 4) Compose 内のエディタ iframe（旧版 QQ の保険）
      var frames = composeEl ? composeEl.querySelectorAll('iframe') : document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var b = editorBodyFromIframe(frames[i]);
        if (b) return b;
      }

      var editors = document.querySelectorAll('iframe[id*="htmleditor"], iframe[id*="editor"], iframe[class*="editor"]');
      for (var j = 0; j < editors.length; j++) {
        var b2 = editorBodyFromIframe(editors[j]);
        if (b2) return b2;
      }
      console.warn(LOG, 'body -> NO EDITOR FOUND');
      return null;
    },
    extract: extractQmail,
    isSentFolder: function () {
      if (/folderid=[34]\b/i.test(location.href)) return true;
      return !!document.querySelector('[title*="已发送"][class*="active"], [class*="active"][title*="已发送"]');
    },
    statusRows: function () {
      return document.querySelectorAll('[class*="mail-item"], [class*="maillist"] li, li[class*="item"]');
    },
    statusSubject: function (row) {
      var a = row.querySelector('[class*="subject"], a[title]');
      return a ? (a.getAttribute('title') || a.textContent || '').trim() : '';
    },
    statusTarget: function (row) {
      return row;
    },
  },
};

/** セレクタ配列を順に試し、最初に見つかった要素を返す */
function firstMatch(selectors) {
  for (var i = 0; i < selectors.length; i++) {
    try {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    } catch (e) { /* ignore invalid selector */ }
  }
  return null;
}

/** contenteditable 候補から表示領域が最大のもの（=本文エディタ）を返す */
function pickLargestEditable(nodes) {
  var best = null;
  var bestArea = 0;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.getAttribute && el.getAttribute('contenteditable') === 'false') continue;
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    var area = rect.width * rect.height;
    if (area > bestArea) { bestArea = area; best = el; }
  }
  if (best) return best;
  // 領域が取れない場合は最初の候補
  return nodes.length > 0 ? nodes[0] : null;
}

/** iframe から編集可能な body を取り出す（同一オリジンのみ） */
function editorBodyFromIframe(iframe) {
  try {
    var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
    if (!doc) return null;
    var b = doc.body;
    if (!b) return null;
    if (b.isContentEditable || b.getAttribute('contenteditable') === 'true') return b;
    var ce = b.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]');
    return ce || null;
  } catch (e) {
    return null; // cross-origin — all_frames=true なら当該 frame 側で処理される
  }
}

// ============================================================
// Compose detection
// ============================================================
function init() {
  if (!PLATFORM) return;
  var provider = PROVIDERS[PLATFORM];

  // Ctrl/Cmd+Enter 送信も捕捉（トップフレームのみ。複数 frame で二重送信しないよう）
  // 本文が iframe 内の旧版 QQ でも、キーイベントは通常トップまで bubble する。
  if (IS_TOP && !keyboardListenerAdded) {
    installSendShortcut();
    keyboardListenerAdded = true;
  }

  // 初回スキャン + DOM 変化時のみスキャン（1 秒ポーリングはやめてログ/負荷を減らす）
  scanForCompose(provider);
  watchDomChanges(function () { scanForCompose(provider); });

  setInterval(function () {
    if (provider.isSentFolder()) injectStatusIcons(provider);
  }, 3000);

  // ステータス同期はトップフレームのみ（複数 frame での重複書き込みを防ぐ）
  if (IS_TOP) {
    refreshTrackingStatus();
    setInterval(refreshTrackingStatus, 60000);
  }
}

/** DOM が変わったときだけコールバックを呼ぶ（debounce 付き MutationObserver） */
function watchDomChanges(callback) {
  if (typeof MutationObserver === 'undefined') {
    // フォールバック: 古い環境は低頻度ポーリング
    setInterval(callback, 2000);
    return;
  }
  var timer = null;
  var observer = new MutationObserver(function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(callback, 150);
  });
  try {
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  } catch (e) {
    setInterval(callback, 2000);
  }
}

function scanForCompose(provider) {
  var sendBtns = provider.findSendButtons(document);
  var injectedCount = 0;
  for (var i = 0; i < sendBtns.length; i++) {
    var btn = sendBtns[i];
    if (injectedSendBtns.has(btn)) continue;
    injectedSendBtns.add(btn);
    injectToggle(btn, provider);
    injectedCount++;
  }
  // 新しいボタンを見つけてトグルを仕込んだ時だけログする（毎スキャンは出さない）
  if (injectedCount > 0) {
    console.log(LOG, 'injected toggle on', injectedCount, 'send button(s)',
      sendBtns.map(function (b) { return b.className || b.id; }));
  }
}

// ============================================================
// Toggle Button — FR-EXT-01
// ============================================================
function injectToggle(sendBtn, provider) {
  var host = provider.toggleHost(sendBtn);
  if (!host) return;

  var state = { tracking: true };
  var toggle = document.createElement('span');
  toggle.className = 'mt-track-toggle mt-track-toggle--on';
  toggle.innerHTML =
    '<span class="mt-track-dot"></span>' +
    '<span class="mt-track-label">追踪已开启</span>';
  toggle.title = '切换邮件追踪';
  updateToggleUI(toggle, state);

  // 設定から初期値を取得
  try {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, function (config) {
      if (config && typeof config.trackByDefault === 'boolean') {
        state.tracking = config.trackByDefault;
        updateToggleUI(toggle, state);
      }
    });
  } catch (e) {
    // Extension context invalidated — ignore
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    state.tracking = !state.tracking;
    updateToggleUI(toggle, state);
  });

  host.appendChild(toggle);

  // 点击与 Ctrl/Cmd+Enter 共用同一个 controller（守卫状态、追踪开关共享）
  var controller = {
    sendBtn: sendBtn,
    state: state,
    provider: provider,
    sending: false,
    skipNext: false,
  };
  controllers.push(controller);
  attachClickIntercept(controller);
}

function updateToggleUI(toggle, state) {
  toggle.className = 'mt-track-toggle ' + (state.tracking ? 'mt-track-toggle--on' : 'mt-track-toggle--off');
  var label = toggle.querySelector('.mt-track-label');
  if (label) label.textContent = state.tracking ? '追踪已开启' : '追踪已关闭';
}

// ============================================================
// Send Interception — FR-EXT-02, 03, 04
// ============================================================
/**
 * 追跡の中身（extract → API → 本文注入）。クリック/ショートカットで共通利用する。
 * 成功失敗に関わらず、呼び出し側が必ず「送信の再発動」を行うこと。
 */
async function runTracking(controller) {
  var provider = controller.provider;
  var sendBtn = controller.sendBtn;
  var composeEl = provider.compose(sendBtn);

  try {
    var payload = provider.extract(composeEl);
    console.log(LOG, 'payload', payload);
    var result = await sendToApi(payload);
    console.log(LOG, 'api result', result);
    var config = await new Promise(function (resolve) {
      try { chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, resolve); }
      catch (err) { resolve(null); }
    });

    if (result && !result.error) {
      var bodyEl = provider.body(composeEl);
      var ok = injectIntoBody(bodyEl, result, config);
      console.log(LOG, 'injected into body?', ok, bodyEl ? (bodyEl.id || bodyEl.className) : 'NO BODY');
      if (PLATFORM === 'qqmail') broadcastInjection(result, config);
    } else {
      console.warn(LOG, 'no result / error, sending without tracking', result && result.error);
    }
  } catch (err) {
    console.error(LOG, 'Failed to track:', err);
  }
}

/** 送信ボタンのクリックを捕捉（既存動作） */
function attachClickIntercept(controller) {
  var sendBtn = controller.sendBtn;

  sendBtn.addEventListener(
    'click',
    async function (e) {
      if (controller.skipNext) { controller.skipNext = false; return; }  // 我々が再発行したクリックは素通し
      if (controller.sending) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!controller.state.tracking) return;                            // Track OFF はそのまま送信

      controller.sending = true;
      e.preventDefault();
      e.stopImmediatePropagation();
      console.log(LOG, 'send intercepted (click)');

      await runTracking(controller);

      // 追跡成否に関わらず、必ず元の送信を発火させる（メールが消えないように）
      setTimeout(function () {
        controller.skipNext = true;
        try {
          sendBtn.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, view: window,
          }));
        } catch (err) {
          console.warn(LOG, 'dispatchEvent failed, fallback .click()', err);
          sendBtn.click();
        }
        controller.sending = false;
      }, 0);
    },
    { capture: true },
  );
}

/**
 * Ctrl/Cmd+Enter のショートカット送信を捕捉する。
 * アプリ側の keydown ハンドラより先に capture で掴み、追跡注入が終わるまで
 * 送信を止める。注入後に keydown を再ディスパッチして本来の送信を発火させる。
 */
function installSendShortcut() {
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
    if (!(e.key === 'Enter' || e.key === '\r' || e.keyCode === 13)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    // 我々が再ディスパッチしたイベントは素通し（無限ループ防止）
    if (!e.isTrusted) return;

    var controller = findActiveController(e.target);
    if (!controller) return;                                  // 編集中の compose が見つからない
    if (controller.sending) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!controller.state.tracking) return;                   // Track OFF → アプリに任せる

    controller.sending = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    console.log(LOG, 'send intercepted (Ctrl/Cmd+Enter)');

    var sendBtn = controller.sendBtn;
    runTracking(controller).then(function () {
      // フレームワークが DOM を読み切る前に再発火しないよう 1 tick 待つ。
      // ショートカットの送信は「送信ボタンの click」で発火させる —
      // アプリが Ctrl+Enter をどのイベント(keydown/keypress)で拾っているかに関わらず、
      // ボタン click は確認済みの送信経路なので確実にメールが出る。
      setTimeout(function () {
        controller.skipNext = true; // 我々が再発行した click は intercept を素通しさせる
        try {
          sendBtn.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, view: window,
          }));
        } catch (err) {
          console.warn(LOG, 'send btn dispatch failed, fallback .click()', err);
          sendBtn.click();
        }
        controller.sending = false;
      }, 0);
    });
  }, true); // capture — アプリのハンドラより先に動く
}

/** 現在編集中の compose に対応する controller を返す */
function findActiveController(target) {
  // まずイベント発生要素が属する compose を優先
  if (target && target.nodeType === 1) {
    for (var i = 0; i < controllers.length; i++) {
      var c = controllers[i];
      try {
        var compose = c.provider.compose(c.sendBtn);
        if (compose && compose.contains(target) && document.contains(c.sendBtn)) return c;
      } catch (e) { /* ignore */ }
    }
  }
  // フォールバック: DOM に残っている（=まだ送信されていない）最新の controller
  for (var j = controllers.length - 1; j >= 0; j--) {
    if (controllers[j].sendBtn && document.contains(controllers[j].sendBtn)) return controllers[j];
  }
  return null;
}

// ============================================================
// Extract email data — provider 固有
// ============================================================
function extractGmail(composeEl) {
  if (!composeEl) return { subject: '', recipient: 'support@example.com' };

  var subjectEl = composeEl.querySelector('input[name="subjectbox"]');
  var subject = subjectEl ? subjectEl.value : '';

  var toEls = composeEl.querySelectorAll('[name="to"], [data-hovercard-id]');
  var recipients = [];
  for (var i = 0; i < toEls.length; i++) {
    var el = toEls[i];
    var email = el.getAttribute('data-hovercard-id') || el.value || el.textContent;
    if (email && email.indexOf('@') !== -1) recipients.push(email.trim());
  }
  var recipient = recipients[0] || 'support@example.com';

  var bodyEl = composeEl.querySelector('[role="textbox"][contenteditable="true"]');
  var urls = collectUrls(bodyEl);

  return {
    subject: subject,
    recipient: recipient,
    recipientName: recipients[0] ? recipients[0].split('@')[0] : undefined,
    urls: urls.length > 0 ? urls : undefined,
  };
}

function extractQmail(composeEl) {
  var subject = '';
  var recipient = '';

  // XMail の件名/宛先は contenteditable のことが多い。input と両方を試す。
  var subjectEl = firstMatch([
    'input[name="subject"]', '#subject',
    '.xmail-cmp-subject input', '[class*="subject"] input',
    '[placeholder*="主题"]', '[aria-label*="主题"]',
    '.xmail-cmp-subject [contenteditable="true"]',
  ]);
  if (subjectEl) subject = subjectEl.value || subjectEl.textContent || '';

  // 宛先: 複数あるので @ を含む最初の値を採用
  var toEls = document.querySelectorAll(
    'input[aria-label*="收件人"], #to_input, input[name="to"], [placeholder*="收件人"], ' +
    '[class*="receiver"] input, [class*="receiver"] [contenteditable="true"], [class*="recipient"] [contenteditable="true"]'
  );
  var emails = [];
  for (var i = 0; i < toEls.length; i++) {
    var v = (toEls[i].value || toEls[i].textContent || '').trim();
    var parts = v.split(/[,;，；\s]+/);
    for (var j = 0; j < parts.length; j++) {
      if (parts[j].indexOf('@') !== -1) emails.push(parts[j]);
    }
  }
  recipient = emails[0] || '';

  var bodyEl = PROVIDERS.qqmail.body(composeEl);
  var urls = collectUrls(bodyEl);

  console.log(LOG, 'extractQmail', {
    subject: subject.trim(), recipient: recipient, bodyFound: !!bodyEl,
    urls: urls.map(function (u) { return u.url; }),
  });

  return {
    subject: subject.trim(),
    recipient: recipient || 'support@example.com',
    recipientName: recipient ? recipient.split('@')[0] : undefined,
    urls: urls.length > 0 ? urls : undefined,
  };
}

/**
 * QQ 邮箱 (XMail) 会在正文末尾自动插入 HTML 名片：
 *   <xm-signature signature-id="2" contenteditable="false"> ... <a href="..."> ... </a>
 * 这类链接不是用户写进正文的，绝不能当作追踪链接回传服务端。
 * 这里沿祖先链判断链接是否位于「框架插入的不可编辑块」内。
 */
function isInsideInsertedBlock(el, root) {
  // xm-signature = QQ 邮箱 HTML 名片；contenteditable=false = 框架插入、用户不可编辑的内容
  var BLOCK_SELECTOR = 'xm-signature, xm-card, [signature-id], [contenteditable="false"]';
  var p = el;
  while (p && p !== root && p.nodeType === 1) {
    try {
      if (p.matches && p.matches(BLOCK_SELECTOR)) return true;
    } catch (e) { /* old browser — ignore */ }
    p = p.parentElement;
  }
  return false;
}

function collectUrls(bodyEl) {
  var urls = [];
  if (!bodyEl) return urls;
  var anchors = bodyEl.querySelectorAll('a[href]');
  var skipped = 0;
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    if (isInsideInsertedBlock(a, bodyEl)) { skipped++; continue; }
    var href = a.getAttribute('href');
    if (href && href.indexOf('http') === 0 && href.indexOf('mailto:') === -1) {
      urls.push({ url: href, label: a.textContent || undefined });
    }
  }
  if (skipped > 0) console.log(LOG, 'collectUrls: skipped', skipped, 'link(s) from HTML signature/card');
  return urls;
}

function sendToApi(payload) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage({ type: 'TRACK_EMAIL', payload: payload }, function (response) {
      resolve(response);
    });
  });
}

// ============================================================
// Body 操作 — FR-EXT-03, 04 (iframe の document にも対応)
// ============================================================

/**
 * リッチテキストエディタ (QQ XMail 等) は contenteditable の生 DOM ではなく
 * 内部データモデルを送信するため、単純な appendChild は送信時に捨てられる。
 * execCommand('insertHTML') を使うとエディタ自身の入力パイプラインを通り、
 * モデルにも反映される。selection を末尾に移してから挿入し、元に戻す。
 */
function insertHtmlIntoEditor(bodyEl, html) {
  if (!bodyEl) return false;
  var doc = bodyEl.ownerDocument || document;
  var win = doc.defaultView || window;
  var sel = win.getSelection();

  // 現在の selection を保存（ユーザーのカーソル位置を壊さないため）
  var savedRange = null;
  try {
    if (sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      if (bodyEl.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
    }
  } catch (e) { /* ignore */ }

  var ok = false;
  try {
    bodyEl.focus();
    var range = doc.createRange();
    range.selectNodeContents(bodyEl);
    range.collapse(false); // 末尾へ
    sel.removeAllRanges();
    sel.addRange(range);

    if (doc.execCommand) {
      ok = doc.execCommand('insertHTML', false, html);
    }
  } catch (e) {
    console.warn(LOG, 'execCommand insertHTML failed', e);
    ok = false;
  }

  // selection を元に戻す
  try {
    sel.removeAllRanges();
    if (savedRange) sel.addRange(savedRange);
  } catch (e) { /* ignore */ }

  console.log(LOG, 'insertHtmlIntoEditor execCommand ok?', ok);
  return ok;
}

/** contenteditable に DOM 変更を通知し、フレームワークのデータモデルに反映させる（保険） */
function notifyEditorInput(bodyEl) {
  if (!bodyEl) return;
  var doc = bodyEl.ownerDocument || document;
  try {
    bodyEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    bodyEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  } catch (e) {
    console.warn(LOG, 'notifyEditorInput failed', e);
  }
}

/** 1 つの body に対して pixel / link / optout をまとめて注入（去重付き） */
function injectIntoBody(bodyEl, result, config) {
  if (!bodyEl || !result) return false;
  var injected = injectPixel(bodyEl, result.pixelUrl);
  var linksChanged = rewriteLinks(bodyEl, result.links || []);
  var footerChanged = false;
  if (result.optoutHtml && (result.forceOptoutFooter || (config && config.showOptoutFooter))) {
    footerChanged = injectOptoutFooter(bodyEl, result.optoutHtml);
  }
  if (injected || linksChanged || footerChanged) notifyEditorInput(bodyEl);
  return injected;
}

/** pixel を data-mt-pixel 属性または src で探す（エディタがデータ属性を洗浄するケースに対応） */
function findPixel(bodyEl, pixelUrl) {
  if (!bodyEl) return null;
  var imgs = bodyEl.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var d = imgs[i].getAttribute('data-mt-pixel');
    var s = imgs[i].getAttribute('src');
    if (d === pixelUrl || s === pixelUrl) return imgs[i];
  }
  return null;
}

function injectPixel(bodyEl, pixelUrl) {
  if (!bodyEl || !pixelUrl) return false;
  // 同一 pixel が既にあれば二重注入しない（複数 frame からの Broadcast 対策）
  if (findPixel(bodyEl, pixelUrl)) return false;
  var doc = bodyEl.ownerDocument || document;
  var pixelHtml = '<img src="' + pixelUrl + '" width="1" height="1" ' +
    'data-mt-pixel="' + pixelUrl.replace(/"/g, '&quot;') + '" ' +
    'style="display:block;width:1px;height:1px;overflow:hidden;opacity:0;" alt="">';

  // 1) エディタの入力パイプラインを通す（QQ XMail 等でこれが必須）
  var ok = insertHtmlIntoEditor(bodyEl, pixelHtml);
  // 2) execCommand が効かなかった / 洗浄された場合は生 DOM に追加して input を飛ばす
  if (!findPixel(bodyEl, pixelUrl)) {
    var pixel = doc.createElement('img');
    pixel.src = pixelUrl;
    pixel.width = 1;
    pixel.height = 1;
    pixel.setAttribute('data-mt-pixel', pixelUrl);
    pixel.setAttribute('style', 'display:block;width:1px;height:1px;overflow:hidden;opacity:0;');
    pixel.setAttribute('data-mt-note', 'pixletter tracking pixel');
    pixel.alt = '';
    bodyEl.appendChild(pixel);
  }
  // 実際に DOM に存在するか最終確認
  var present = findPixel(bodyEl, pixelUrl);
  console.log(LOG, 'injectPixel present in DOM?', !!present);
  return !!present;
}

function rewriteLinks(bodyEl, trackedLinks) {
  if (!bodyEl || !trackedLinks || trackedLinks.length === 0) return false;
  var urlMap = {};
  for (var i = 0; i < trackedLinks.length; i++) {
    if (trackedLinks[i].originalUrl) urlMap[trackedLinks[i].originalUrl] = trackedLinks[i].trackingUrl;
  }
  var anchors = bodyEl.querySelectorAll('a[href]');
  var changed = false;
  for (var j = 0; j < anchors.length; j++) {
    var href = anchors[j].getAttribute('href');
    if (urlMap[href]) { anchors[j].setAttribute('href', urlMap[href]); changed = true; }
  }
  return changed;
}

function injectOptoutFooter(bodyEl, html) {
  if (!bodyEl || !html) return false;
  var doc = bodyEl.ownerDocument || document;
  // 既に挿入済みなら二重に入れない
  if (bodyEl.querySelector('[data-mt-optout]')) return false;
  var ok = insertHtmlIntoEditor(bodyEl, '<div data-mt-optout="1">' + html + '</div>');
  if (!ok) {
    if (bodyEl.querySelector('[data-mt-optout]')) return false;
    var div = doc.createElement('div');
    div.setAttribute('data-mt-optout', '1');
    div.innerHTML = html;
    bodyEl.appendChild(div);
  }
  return true;
}

// ============================================================
// Sent Folder Status Icons — FR-EXT-05
// ============================================================
function injectStatusIcons(provider) {
  var rows = provider.statusRows();
  if (rows.length === 0) return;

  chrome.storage.local.get('trackedEmails', function (stored) {
    var trackedEmails = stored.trackedEmails || {};
    var keys = Object.keys(trackedEmails);

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector('.mt-status')) continue;

      var subject = provider.statusSubject(row);
      if (!subject) continue;

      var tracked = null;
      for (var j = 0; j < keys.length; j++) {
        if (trackedEmails[keys[j]].subject === subject) {
          tracked = trackedEmails[keys[j]];
          break;
        }
      }
      if (!tracked) continue;

      var statusEl = document.createElement('span');
      statusEl.setAttribute('style', 'display:inline-block;margin-left:4px;font-size:11px;vertical-align:middle;');
      if (tracked.opened) {
        statusEl.style.color = '#4caf50';
        statusEl.textContent = '\u2713\u2713';
        statusEl.title = '已打开 ' + (tracked.openCount || 1) + ' 次';
      } else {
        statusEl.style.color = '#9e9e9e';
        statusEl.textContent = '\u2713';
        statusEl.title = '已发送，尚未打开';
      }
      statusEl.className = 'mt-status';

      var target = provider.statusTarget(row);
      if (target) target.appendChild(statusEl);
    }
  });
}

async function refreshTrackingStatus() {
  try {
    // content script から直接 fetch すると origin がメールサイト (wx.mail.qq.com 等) になり
    // CORS で弾かれる。background 経由の GET に切り替えた（拡張オリジンで送信される）。
    var body = await new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'API_GET', path: '/api/emails?limit=50' }, resolve);
      } catch (err) {
        console.warn(LOG, 'API_GET message failed', err);
        resolve(null);
      }
    });
    if (!body || body.error || !Array.isArray(body.data)) return;

    var trackedEmails = {};
    for (var i = 0; i < body.data.length; i++) {
      var email = body.data[i];
      trackedEmails[email.id] = {
        subject: email.subject,
        recipient: email.recipient,
        opened: (email.openCount || 0) > 0,
        openCount: email.openCount || 0,
        trackingId: email.trackingId,
      };
    }
    await chrome.storage.local.set({ trackedEmails: trackedEmails });
  } catch (err) {
    console.error('[pixletter] Failed to refresh tracking status:', err);
  }
}

// ============================================================
// 同一タブ内の全フレームへ注入を配る（QQメール用）
// 親 frame が送ボタンを持ち、本文が別 iframe にある場合に対応。
// ============================================================
function broadcastInjection(result, config) {
  try {
    chrome.runtime.sendMessage({
      type: 'BROADCAST_INJECTION',
      pixelUrl: result.pixelUrl,
      links: result.links || [],
      optoutHtml: result.optoutHtml || '',
      forceOptoutFooter: !!result.forceOptoutFooter,
      showOptoutFooter: !!(config && config.showOptoutFooter),
    });
  } catch (e) { /* ignore */ }
}

// background 経由で届いた注入リクエストを処理（自分自身の document に対してのみ）
chrome.runtime.onMessage.addListener(function (d) {
  if (!d || d.__pixletter !== true || d.type !== 'INJECT_TRACKING') return;
  if (PLATFORM !== 'qqmail') return;

  var bodyEl = PROVIDERS.qqmail.body(null);
  console.log(LOG, 'INJECT_TRACKING received', bodyEl ? (bodyEl.id || bodyEl.className) : 'NO BODY');
  if (!bodyEl) return;

  var injected = injectPixel(bodyEl, d.pixelUrl);
  var linksChanged = rewriteLinks(bodyEl, d.links || []);
  var footerChanged = false;
  if (d.optoutHtml && (d.forceOptoutFooter || d.showOptoutFooter)) {
    footerChanged = injectOptoutFooter(bodyEl, d.optoutHtml);
  }
  if (injected || linksChanged || footerChanged) notifyEditorInput(bodyEl);
});

// ============================================================
// Init
// ============================================================
init();
