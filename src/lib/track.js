const SUPABASE_URL = 'https://dsmbppzvembacitwdrsj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jqiREpSEu8ItzSEcjTypsQ_41EivRsM';

function getSessionId() {
  try {
    let id = localStorage.getItem('chiefeo_session_id');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('chiefeo_session_id', id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

function isInternal() {
  try {
    if (/[#?&]internal\b/.test(location.hash + location.search)) {
      localStorage.setItem("chiefeo_internal", "1");
    }
    return localStorage.getItem("chiefeo_internal") === "1";
  } catch (e) { return false; }
}

// Shared request builder so the fire-and-forget and awaitable paths post the
// exact same event shape to the same endpoint. May throw (e.g. no `window` in
// a non-browser context) — callers wrap it.
function buildRequest(app, event, properties) {
  const body = JSON.stringify({
    app,
    event,
    session_id: getSessionId(),
    properties: Object.assign({}, properties || {}, isInternal() ? { internal: true } : {}),
    path: window.location.pathname,
    user_agent: navigator.userAgent,
  });
  return {
    url: `${SUPABASE_URL}/rest/v1/app_events`,
    options: {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body,
      keepalive: true,
    },
  };
}

// Fire-and-forget page/usage event. Deliberately silent: analytics must never
// block the UI or throw, so errors are swallowed. Do NOT use this for anything
// the user is told succeeded — use trackSend for that.
export function track(app, event, properties = {}) {
  try {
    const { url, options } = buildRequest(app, event, properties);
    fetch(url, options).catch(() => {});
  } catch {
    // never throw — analytics must never break the app
  }
}

// Awaitable variant for user-initiated sends (the feedback widget) where the
// UI reports the outcome. Resolves `true` only when the endpoint accepted the
// row (response.ok); resolves `false` on an HTTP error status, a network
// failure, or once `timeoutMs` elapses (the request is aborted). It NEVER
// rejects and never throws, so callers can `await` it bare.
export function trackSend(app, event, properties = {}, { timeoutMs = 10000 } = {}) {
  try {
    const { url, options } = buildRequest(app, event, properties);
    let controller = null;
    let timer = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      options.signal = controller.signal;
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    return fetch(url, options)
      .then((res) => Boolean(res && res.ok))
      .catch(() => false)
      .finally(() => { if (timer) clearTimeout(timer); });
  } catch {
    return Promise.resolve(false);
  }
}
