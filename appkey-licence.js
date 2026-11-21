/*!
 * AppKey licence helper, v1 — © 2026 Anderson Jones. All rights reserved.
 *
 * Copy this one file into an app and add:
 *   <script src="appkey-licence.js"></script>
 *   const licence = AppKeyLicence.create({ product: 'odd-disciple', trialDays: 14 })
 *   const s = await licence.status()      // { state, tier, expiresAt, trialDaysLeft, message }
 *   if (licence.allows(s, 'premium')) { ...unlock premium... }
 *   licence.openKeyScreen()               // built-in "Enter your licence key" screen
 *
 * How it works: activating a key registers this install as one device and
 * saves a signed proof from AppKey's server. The proof lets the app work
 * offline for a few days; after that it re-checks online. No secrets live
 * in this file.
 */
(function (global) {
  'use strict'

  var DEFAULT_API = 'https://vdzkmswmbacdrpfjiwot.supabase.co/functions/v1/licence-api'
  // Public key for checking proofs. Public by design.
  var DEFAULT_PUBLIC_KEY = {
    kty: 'EC', crv: 'P-256',
    x: 'WdddZ5TpNEgpDoXM1RJlFJ3UA3rcc-aKe1E1Qa3CC-A',
    y: 'D8NpZgDdkgw_S7zmDGe93xdWi79xHQXtmnWHfpEaaoo',
  }
  var DAY = 86400000
  var TIERS = ['basic', 'premium', 'organisation']

  var MESSAGES = {
    invalid_key: 'We couldn’t find that key for this app. Check it and try again.',
    device_limit: 'This key is already in use on its full number of devices. Remove one below, then try again.',
    expired: 'This plan has ended. Renew it to unlock again — your data is safe.',
    suspended: 'This licence is paused. Please contact support.',
    revoked: 'This licence is no longer valid.',
    not_activated: 'This device is no longer registered for this key. Enter the key again.',
    rate_limited: 'Too many tries. Please wait ten minutes and try again.',
    offline: 'You appear to be offline. Connect to the internet and try again.',
    needs_online: 'Connect to the internet once to confirm your licence.',
    server_error: 'Something went wrong on our side. Please try again shortly.',
    bad_request: 'That doesn’t look like a licence key.',
  }

  function bytesFromB64u(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/')
    while (s.length % 4) s += '='
    var bin = atob(s), out = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  function randomId() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID()
    var a = new Uint8Array(16)
    crypto.getRandomValues(a)
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2) }).join('')
  }

  function deviceLabel() {
    var ua = navigator.userAgent || ''
    var device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : 'Device'
    var standalone = navigator.standalone === true || (global.matchMedia && matchMedia('(display-mode: standalone)').matches)
    var browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser'
    return device + ' · ' + (standalone ? 'Home Screen app' : browser)
  }

  function create(options) {
    options = options || {}
    if (!options.product) throw new Error('AppKeyLicence: "product" is required')
    var product = String(options.product).toLowerCase()
    var api = options.apiUrl || DEFAULT_API
    var publicJwk = options.publicKey || DEFAULT_PUBLIC_KEY
    var prefix = 'appkey:' + product + ':'
    var listeners = []
    var memory = {} // used if storage is unavailable (private mode)

    function read(name) {
      try { var v = localStorage.getItem(prefix + name); return v ? JSON.parse(v) : null } catch (e) { return memory[name] || null }
    }
    function write(name, value) {
      memory[name] = value
      try { if (value === null) localStorage.removeItem(prefix + name); else localStorage.setItem(prefix + name, JSON.stringify(value)) } catch (e) { /* keep in memory */ }
    }

    var deviceId = read('device')
    if (!deviceId) { deviceId = randomId(); write('device', deviceId) }

    // A key can arrive in a link:  https://your-app/?licence=XXXX-XXXX-XXXX-XXXX
    var pendingKey = null
    try {
      var url = new URL(global.location.href)
      pendingKey = url.searchParams.get('licence')
      if (pendingKey) {
        url.searchParams.delete('licence')
        history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash)
      }
    } catch (e) { /* ignore */ }

    function call(body) {
      body.product = product
      body.device_id = deviceId
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
      var timer = ctrl && setTimeout(function () { ctrl.abort() }, 12000)
      return fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) { return res.json() })
        .catch(function () { return { ok: false, code: 'offline' } })
        .then(function (r) { if (timer) clearTimeout(timer); return r })
    }

    var verifyKey = null
    function verify(saved) {
      if (!saved || !saved.proof || !saved.sig || !global.crypto || !crypto.subtle) return Promise.resolve(null)
      verifyKey = verifyKey || crypto.subtle.importKey('jwk', { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      var bytes = bytesFromB64u(saved.proof)
      return verifyKey
        .then(function (key) { return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytesFromB64u(saved.sig), bytes) })
        .then(function (good) { return good ? JSON.parse(new TextDecoder().decode(bytes)) : null })
        .catch(function () { return null })
    }

    function licensed(p) {
      return { state: 'licensed', tier: p.tier, plan: p.plan, type: p.type, expiresAt: p.exp, complimentary: !!p.comp, message: '' }
    }
    function trialOrFree(reason) {
      var out = { state: reason || 'free', tier: null, expiresAt: null, message: reason ? MESSAGES[reason] || '' : '' }
      if (options.trialDays > 0 && !read('hadLicence')) {
        var start = read('trial')
        if (!start) { start = Date.now(); write('trial', start) }
        var left = Math.ceil((start + options.trialDays * DAY - Date.now()) / DAY)
        if (left > 0) return { state: 'trial', tier: options.trialTier || 'premium', trialDaysLeft: left, expiresAt: null, message: '' }
        if (!reason) out.state = 'trial_ended'
      }
      return out
    }
    function emit(s) { listeners.forEach(function (fn) { try { fn(s) } catch (e) { /* ignore */ } }); return s }

    function save(key, r) {
      write('proof', { key: key, proof: r.proof, sig: r.sig })
      write('hadLicence', true)
    }

    /** Asks the server about the saved key. Updates the saved proof. */
    function refresh() {
      var saved = read('proof')
      if (!saved) return Promise.resolve(trialOrFree())
      return call({ action: 'check', key: saved.key }).then(function (r) {
        if (r.ok && r.proof) {
          save(saved.key, r)
          return verify(read('proof')).then(function (p) { return emit(p ? licensed(p) : trialOrFree('server_error')) })
        }
        if (r.code === 'offline' || r.code === 'server_error' || r.code === 'rate_limited') return null // keep what we have
        write('proof', null)
        if (r.code === 'expired') write('lastKey', saved.key)
        return emit(trialOrFree(r.code))
      })
    }

    /** The current licence state. Works offline while the saved proof is fresh. */
    function status() {
      var saved = read('proof')
      if (!saved) return Promise.resolve(trialOrFree())
      return verify(saved).then(function (p) {
        var now = Date.now()
        var seen = read('seen') || 0
        if (now > seen) write('seen', now)
        var clockOk = now > seen - DAY // the clock hasn't been wound back
        if (p && p.dev === deviceId && p.product === product && now < p.until && clockOk) {
          if (now - p.iat > DAY && navigator.onLine !== false) refresh() // quiet daily re-check
          return licensed(p)
        }
        return refresh().then(function (s) {
          if (s) return s
          return { state: 'needs_online', tier: null, expiresAt: p ? p.exp : null, message: MESSAGES.needs_online }
        })
      })
    }

    /** Activates a key on this device. Resolves to { ok, code, message, devices?, status? }. */
    function activate(key) {
      key = String(key || '').trim()
      if (key.length < 8) return Promise.resolve({ ok: false, code: 'bad_request', message: MESSAGES.bad_request })
      return call({ action: 'activate', key: key, device_label: deviceLabel() }).then(function (r) {
        if (r.ok && r.proof) {
          save(key, r)
          return verify(read('proof')).then(function (p) {
            if (!p) return { ok: false, code: 'server_error', message: MESSAGES.server_error }
            return { ok: true, status: emit(licensed(p)) }
          })
        }
        r.message = MESSAGES[r.code] || MESSAGES.server_error
        return r
      })
    }

    /** Frees a device slot. With no id, removes this device and forgets the key. */
    function removeDevice(key, targetDeviceId) {
      return call({ action: 'deactivate', key: key, target_device_id: targetDeviceId || deviceId })
    }
    function deactivate() {
      var saved = read('proof')
      if (!saved) return Promise.resolve(trialOrFree())
      return removeDevice(saved.key).then(function (r) {
        if (!r.ok) return null
        write('proof', null)
        return emit(trialOrFree())
      })
    }

    /** True if the status includes at least this tier ("basic" < "premium" < "organisation"). */
    function allows(s, tier) {
      return !!s && (s.state === 'licensed' || s.state === 'trial') && TIERS.indexOf(s.tier) >= TIERS.indexOf(tier || 'basic')
    }

    // ---------- Built-in "Enter your licence key" screen ----------
    function openKeyScreen(opts) {
      opts = opts || {}
      var host = opts.container || document.body
      var dark = global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
      var c = dark
        ? { bg: '#121723', ink: '#e8ebf1', muted: '#98a1b3', line: '#2a3244', field: '#181e2c', accent: '#d9b26f', onAccent: '#1b1408', danger: '#ea6b70' }
        : { bg: '#ffffff', ink: '#15171d', muted: '#5c6271', line: '#d6d2c9', field: '#f6f5f1', accent: '#9c6f22', onAccent: '#ffffff', danger: '#c3363c' }
      var el = function (tag, css, text) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (text) n.textContent = text; return n }
      var font = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'

      var scrim = el('div', 'position:' + (opts.container ? 'absolute' : 'fixed') + ';inset:0;z-index:2147483000;background:rgba(3,5,10,.6);display:flex;align-items:flex-end;justify-content:center;' + font)
      var card = el('div', 'box-sizing:border-box;width:100%;max-width:440px;max-height:92%;overflow:auto;background:' + c.bg + ';color:' + c.ink + ';border-radius:22px 22px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 40px rgba(0,0,0,.35)')
      var title = el('div', 'font-size:20px;font-weight:650;letter-spacing:-.02em', opts.title || 'Enter your licence key')
      var sub = el('div', 'font-size:14px;color:' + c.muted + ';margin:6px 0 16px;line-height:1.4', opts.subtitle || 'You’ll find it in your purchase email. It looks like ABCD-1234-ABCD-1234.')
      var input = el('input', 'box-sizing:border-box;width:100%;height:50px;border-radius:14px;border:1px solid ' + c.line + ';background:' + c.field + ';color:' + c.ink + ';padding:0 14px;font-size:17px;letter-spacing:.04em;font-family:ui-monospace,Menlo,monospace;text-transform:uppercase;outline:none')
      input.setAttribute('autocapitalize', 'characters'); input.setAttribute('autocorrect', 'off'); input.setAttribute('autocomplete', 'off'); input.spellcheck = false
      input.setAttribute('aria-label', 'Licence key'); input.placeholder = 'XXXX-XXXX-XXXX-XXXX'
      input.value = opts.key || pendingKey || read('lastKey') || ''
      var msg = el('div', 'min-height:20px;font-size:13.5px;margin:10px 2px;line-height:1.4;color:' + c.danger)
      var list = el('div', '')
      var go = el('button', 'width:100%;margin:0;height:50px;border:0;border-radius:14px;background:' + c.accent + ';color:' + c.onAccent + ';font-size:16px;font-weight:650;cursor:pointer;' + font, 'Activate')
      var cancel = el('button', 'width:100%;height:46px;border:0;background:transparent;color:' + c.muted + ';font-size:15px;margin:6px 0 0;cursor:pointer;' + font, 'Not now')
      var note = el('div', 'font-size:12px;color:' + c.muted + ';text-align:center;margin-top:6px;line-height:1.4', 'Each install counts as one device. On iPhone, activate in the Home Screen app.')
      ;[title, sub, input, msg, list, go, cancel, note].forEach(function (n) { card.appendChild(n) })
      scrim.appendChild(card); host.appendChild(scrim)

      function close(result) { if (scrim.parentNode) scrim.parentNode.removeChild(scrim); if (opts.onClose) opts.onClose(result || null) }
      function busy(on) { go.disabled = on; go.style.opacity = on ? '.6' : '1'; go.textContent = on ? 'Checking…' : 'Activate' }
      function showDevices(devices) {
        list.textContent = ''
        ;(devices || []).forEach(function (d) {
          var row = el('div', 'display:flex;align-items:center;gap:10px;border:1px solid ' + c.line + ';border-radius:12px;padding:8px 8px 8px 12px;margin-bottom:8px')
          var name = el('div', 'font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', d.label || 'Device')
          var when = el('div', 'font-size:12px;color:' + c.muted, 'Added ' + new Date(d.activated_at).toLocaleDateString())
          var left = el('div', 'flex:1;min-width:0'); left.appendChild(name); left.appendChild(when)
          var rm = el('button', 'width:auto;flex:0 0 auto;margin:0;height:40px;padding:0 12px;border-radius:10px;border:1px solid ' + c.line + ';background:transparent;color:' + c.ink + ';font-size:14px;cursor:pointer;' + font, 'Remove')
          rm.onclick = function () {
            rm.disabled = true; rm.textContent = '…'
            removeDevice(input.value, d.device_id).then(function (r) {
              if (r.ok) { showDevices(r.devices); msg.style.color = c.muted; msg.textContent = 'Removed. Tap Activate to use this device.' }
              else { rm.disabled = false; rm.textContent = 'Remove'; msg.textContent = MESSAGES[r.code] || MESSAGES.server_error }
            })
          }
          row.appendChild(left); row.appendChild(rm); list.appendChild(row)
        })
      }
      go.onclick = function () {
        msg.style.color = c.danger; msg.textContent = ''; list.textContent = ''; busy(true)
        activate(input.value).then(function (r) {
          busy(false)
          if (r.ok) { pendingKey = null; write('lastKey', null); close(r.status); return }
          msg.textContent = r.message
          if (r.code === 'device_limit') showDevices(r.devices)
        })
      }
      input.onkeydown = function (e) { if (e.key === 'Enter') go.onclick() }
      cancel.onclick = function () { close(null) }
      return { close: close }
    }

    return {
      product: product,
      deviceId: deviceId,
      get pendingKey() { return pendingKey },
      status: status,
      refresh: refresh,
      activate: activate,
      deactivate: deactivate,
      removeDevice: removeDevice,
      allows: allows,
      openKeyScreen: openKeyScreen,
      onChange: function (fn) { listeners.push(fn) },
      messages: MESSAGES,
    }
  }

  global.AppKeyLicence = { create: create, version: 1 }
})(typeof window !== 'undefined' ? window : this)
