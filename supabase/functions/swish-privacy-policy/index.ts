// SWISH Privacy Policy — Public Edge Function
// Serves a fully-rendered HTML privacy policy page at:
//   GET https://iwgaqieyoahmcjfziwga.backend.onspace.ai/functions/v1/swish-privacy-policy
//
// No authentication required. Suitable for submission to the eBay Developer Program.

const EFFECTIVE_DATE = '10 September 2026';
const CONTACT_EMAIL  = 'privacy@swish.app'; // ← REPLACE with your real contact email

function html(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — SWISH</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #09090E;
      --surface:   #111218;
      --border:    #1E2028;
      --primary:   #4F8EF7;
      --text:      #F1F2F4;
      --muted:     #8B8FA8;
      --faint:     #50535E;
      --success:   #22C55E;
      --warning:   #F59E0B;
      --danger:    #EF4444;
      --info:      #06B6D4;
      --ebay-red:  #E53238;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      font-size: 16px;
    }

    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Layout ── */
    .page-wrap {
      max-width: 860px;
      margin: 0 auto;
      padding: 0 24px 80px;
    }

    /* ── Hero ── */
    .hero {
      padding: 56px 0 40px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 40px;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(79,142,247,.12);
      border: 1px solid rgba(79,142,247,.25);
      border-radius: 100px;
      padding: 4px 14px;
      font-size: 12px;
      font-weight: 600;
      color: var(--primary);
      letter-spacing: .4px;
      text-transform: uppercase;
      margin-bottom: 20px;
    }
    .hero h1 {
      font-size: clamp(28px, 5vw, 40px);
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--text);
      margin-bottom: 12px;
    }
    .hero-meta {
      font-size: 14px;
      color: var(--faint);
    }
    .hero-meta span { color: var(--muted); }

    /* ── Table of Contents ── */
    .toc {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px 28px;
      margin-bottom: 48px;
    }
    .toc-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .8px;
      color: var(--faint);
      margin-bottom: 14px;
    }
    .toc ol {
      padding-left: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 6px 24px;
    }
    .toc li { font-size: 14px; color: var(--muted); }
    .toc a { color: var(--primary); }

    /* ── Sections ── */
    section {
      margin-bottom: 56px;
      scroll-margin-top: 24px;
    }
    .section-num {
      display: inline-block;
      background: rgba(79,142,247,.14);
      color: var(--primary);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .5px;
      border-radius: 6px;
      padding: 2px 8px;
      margin-bottom: 10px;
    }
    h2 {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }
    h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
      margin: 20px 0 8px;
    }
    p { color: var(--muted); margin-bottom: 14px; }
    p:last-child { margin-bottom: 0; }
    ul, ol {
      color: var(--muted);
      padding-left: 22px;
      margin-bottom: 14px;
    }
    li { margin-bottom: 6px; line-height: 1.65; }

    /* ── Call-out boxes ── */
    .callout {
      display: flex;
      gap: 12px;
      border-radius: 12px;
      padding: 16px 18px;
      margin: 20px 0;
      border-width: 1px;
      border-style: solid;
      font-size: 14px;
      line-height: 1.6;
    }
    .callout-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .callout-body { color: var(--muted); flex: 1; }
    .callout-body strong { color: var(--text); }
    .callout.info   { background: rgba(6,182,212,.08);  border-color: rgba(6,182,212,.25);  }
    .callout.warn   { background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.25); }
    .callout.ebay   { background: rgba(229,50,56,.08);  border-color: rgba(229,50,56,.25);  }
    .callout.secure { background: rgba(34,197,94,.08);  border-color: rgba(34,197,94,.25);  }

    /* ── Data table ── */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      margin: 16px 0 24px;
      background: var(--surface);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .data-table th {
      background: rgba(79,142,247,.1);
      color: var(--text);
      font-weight: 600;
      text-align: left;
      padding: 10px 16px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .5px;
    }
    .data-table td {
      padding: 10px 16px;
      color: var(--muted);
      border-top: 1px solid var(--border);
      vertical-align: top;
    }
    .data-table tr:first-child td { border-top: none; }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 100px;
      font-size: 11px;
      font-weight: 600;
    }
    .tag-green  { background: rgba(34,197,94,.15);  color: var(--success); }
    .tag-blue   { background: rgba(79,142,247,.15);  color: var(--primary); }
    .tag-orange { background: rgba(245,158,11,.15); color: var(--warning); }
    .tag-red    { background: rgba(229,50,56,.15);   color: var(--ebay-red); }

    /* ── eBay badge ── */
    .ebay-header {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(229,50,56,.08);
      border: 1px solid rgba(229,50,56,.25);
      border-radius: 12px;
      padding: 14px 18px;
      margin-bottom: 20px;
    }
    .ebay-dot {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(229,50,56,.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    .ebay-header-text strong { color: var(--text); font-size: 15px; }
    .ebay-header-text span   { display: block; font-size: 13px; color: var(--muted); margin-top: 2px; }

    /* ── Contact card ── */
    .contact-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .contact-row { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--muted); }
    .contact-icon { color: var(--primary); font-size: 16px; }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 32px 24px;
      text-align: center;
    }
    footer p { font-size: 13px; color: var(--faint); margin-bottom: 6px; }
    footer .links { display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; margin-top: 12px; }
    footer .links a { font-size: 13px; color: var(--muted); }

    @media (max-width: 600px) {
      .hero { padding: 36px 0 28px; }
      .toc ol { grid-template-columns: 1fr; }
      .data-table { font-size: 13px; }
      .data-table th, .data-table td { padding: 8px 12px; }
    }
  </style>
</head>
<body>

<div class="page-wrap">

  <!-- ── Hero ── -->
  <div class="hero">
    <div class="hero-badge">📄 Legal</div>
    <h1>Privacy Policy</h1>
    <p class="hero-meta">
      <span>Effective date:</span> ${EFFECTIVE_DATE} &nbsp;·&nbsp;
      <span>Service:</span> SWISH Autonomous Commerce Platform &nbsp;·&nbsp;
      <span>Version:</span> 2.0
    </p>
  </div>

  <!-- ── Summary callout ── -->
  <div class="callout info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Plain-English Summary:</strong>
      SWISH is a commerce management platform that helps you run your resale business.
      When you connect your eBay account, SWISH uses eBay's official OAuth 2.0 flow — you
      authorise access directly on eBay's website. SWISH never sees your eBay password.
      OAuth tokens are stored server-side only, encrypted at rest, and are never exposed
      to the mobile app. We use your data only to provide the service. We do not sell it.
    </div>
  </div>

  <!-- ── Table of Contents ── -->
  <div class="toc">
    <div class="toc-title">Contents</div>
    <ol>
      <li><a href="#s1">Who We Are</a></li>
      <li><a href="#s2">Data We Collect</a></li>
      <li><a href="#s3">eBay OAuth &amp; Account Data</a></li>
      <li><a href="#s4">How We Use Your Data</a></li>
      <li><a href="#s5">Data Storage &amp; Security</a></li>
      <li><a href="#s6">Token &amp; Credential Security</a></li>
      <li><a href="#s7">Data Retention &amp; Deletion</a></li>
      <li><a href="#s8">Third-Party Services</a></li>
      <li><a href="#s9">Your Rights</a></li>
      <li><a href="#s10">Cookies &amp; Analytics</a></li>
      <li><a href="#s11">Children</a></li>
      <li><a href="#s12">Changes to This Policy</a></li>
      <li><a href="#s13">Contact Us</a></li>
    </ol>
  </div>

  <!-- ── 1. Who We Are ── -->
  <section id="s1">
    <div class="section-num">01</div>
    <h2>Who We Are</h2>
    <p>
      SWISH ("<strong>SWISH</strong>", "we", "us", "our") is an autonomous commerce operating
      system that enables resellers to manage acquisitions, identify and value items, generate
      marketplace listings, and track profits from a single platform.
    </p>
    <p>
      This Privacy Policy explains how SWISH collects, uses, stores, and protects personal
      data and third-party account data — including data obtained via eBay's OAuth 2.0
      authorisation service. It applies to the SWISH mobile application, associated backend
      services, and any connected integrations.
    </p>
    <p>
      By creating an account or connecting a marketplace (including eBay), you agree to the
      practices described in this Policy.
    </p>
    <div class="callout warn">
      <div class="callout-icon">⚠️</div>
      <div class="callout-body">
        <strong>Contact information required:</strong>
        This policy currently uses a placeholder contact email (<code>${CONTACT_EMAIL}</code>).
        Before submitting to the eBay Developer Program, replace it with your verified business
        contact email address. You may also wish to add a company trading name and registered address
        in this section.
      </div>
    </div>
  </section>

  <!-- ── 2. Data We Collect ── -->
  <section id="s2">
    <div class="section-num">02</div>
    <h2>Data We Collect</h2>

    <h3>Account Data</h3>
    <p>When you create a SWISH account:</p>
    <ul>
      <li>Email address</li>
      <li>Password (stored as a salted bcrypt hash — never in plain text)</li>
      <li>Account creation timestamp</li>
    </ul>

    <h3>Business Configuration Data</h3>
    <p>
      Data you enter to configure your business profile: starting capital, spending limits,
      automation level, preferred product categories, target ROI thresholds, and risk
      tolerance settings. This data is essential to the service and stored in your private
      tenant database partition.
    </p>

    <h3>Item &amp; Inventory Data</h3>
    <p>
      Product data you create or import: item titles, descriptions, condition notes, physical
      attributes (weight, dimensions, materials), valuations, photographs, listing data,
      order records, and sale outcomes. This data belongs to you and is only processed to
      provide the SWISH service.
    </p>

    <h3>Images</h3>
    <p>
      When you use the AI scanning feature, photographs are transmitted to the SWISH AI
      identification service (powered by OnSpace AI) for item identification and valuation.
      Images are processed transiently and are not stored by the AI provider beyond the
      inference request.
    </p>

    <h3>Usage &amp; Diagnostic Data</h3>
    <p>
      Standard server logs including request timestamps, error codes, and response times.
      No behavioural tracking, advertising identifiers, or analytics SDKs are used in the
      SWISH mobile application.
    </p>
  </section>

  <!-- ── 3. eBay OAuth ── -->
  <section id="s3">
    <div class="section-num">03</div>
    <h2>eBay OAuth &amp; Account Data</h2>

    <div class="ebay-header">
      <div class="ebay-dot">🛒</div>
      <div class="ebay-header-text">
        <strong>eBay Developer Program Integration</strong>
        <span>SWISH uses the official eBay OAuth 2.0 Authorization Code flow and eBay Selling/Fulfilment APIs.</span>
      </div>
    </div>

    <h3>How the eBay OAuth Flow Works</h3>
    <p>
      SWISH integrates with eBay using eBay's official OAuth 2.0 Authorization Code Grant flow.
      Here is the precise sequence:
    </p>
    <ol>
      <li>You enter your eBay Developer Portal credentials (App ID, Cert ID, RuName) in the SWISH Marketplaces wizard. These are transmitted directly to the SWISH backend over TLS and never stored in the mobile application.</li>
      <li>The SWISH backend generates an eBay consent URL using your credentials and returns it to the app.</li>
      <li>The SWISH app opens the consent URL in your device's system browser. You are taken directly to eBay's website — SWISH never opens a web view that could intercept your eBay login credentials.</li>
      <li>You sign in to eBay and review the requested permissions. If you approve, eBay redirects to SWISH's secure callback endpoint: <code>https://iwgaqieyoahmcjfziwga.backend.onspace.ai/functions/v1/swish-ebay-oauth?route=callback</code></li>
      <li>The SWISH backend exchanges the one-time authorisation code for an OAuth access token and refresh token, using a server-to-server request to eBay's token endpoint. This exchange happens entirely on the server; the authorisation code and resulting tokens are never transmitted to or stored in the mobile app.</li>
      <li>Tokens are stored encrypted in the SWISH backend database and used exclusively to call eBay APIs on your behalf.</li>
    </ol>

    <div class="callout secure">
      <div class="callout-icon">🔒</div>
      <div class="callout-body">
        <strong>Your eBay password is never visible to SWISH.</strong>
        The OAuth flow takes place entirely on eBay's own login pages inside your device's
        system browser. SWISH only receives the authorisation code redirected back from eBay,
        which is immediately exchanged for tokens server-side.
      </div>
    </div>

    <h3>eBay Data SWISH Accesses</h3>
    <p>
      Subject to the permissions you grant, SWISH may access the following eBay account data
      through the eBay API:
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th>Data Category</th>
          <th>OAuth Scope</th>
          <th>Purpose</th>
          <th>Required?</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Listing creation &amp; management</td>
          <td><code>sell.inventory</code></td>
          <td>Create, update, and manage eBay listings for your items</td>
          <td><span class="tag tag-red">Required</span></td>
        </tr>
        <tr>
          <td>Order information</td>
          <td><code>sell.fulfillment</code></td>
          <td>Read and update order status, dispatch information, and tracking</td>
          <td><span class="tag tag-red">Required</span></td>
        </tr>
        <tr>
          <td>Seller account settings</td>
          <td><code>sell.account</code></td>
          <td>Read shipping, returns, and payment policies for listing compliance</td>
          <td><span class="tag tag-red">Required</span></td>
        </tr>
        <tr>
          <td>Seller identity</td>
          <td><code>commerce.identity.readonly</code></td>
          <td>Confirm the seller account linked to the connector</td>
          <td><span class="tag tag-orange">Optional</span></td>
        </tr>
      </tbody>
    </table>

    <p>
      SWISH does not request, store, or use eBay buyer account information, eBay financial
      account data beyond what is required to calculate seller fees, eBay messaging/inbox
      content, or any data beyond the scopes listed above.
    </p>

    <h3>Voluntary Authorisation</h3>
    <p>
      Connecting your eBay account to SWISH is entirely voluntary. SWISH's core item
      management, AI identification, and valuation features function without an eBay connection.
      The eBay integration is only used when you explicitly initiate the connection wizard and
      complete the eBay OAuth consent flow.
    </p>
    <p>
      You may revoke SWISH's access to your eBay account at any time by:
    </p>
    <ul>
      <li>Visiting <a href="https://signin.ebay.com/ws/eBayISAPI.dll?ThirdPartyAuthSuiteGrant" target="_blank" rel="noopener">eBay's Connected Applications</a> page and revoking the SWISH authorisation; or</li>
      <li>Contacting SWISH at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> to request token deletion from our systems.</li>
    </ul>
    <p>
      When access is revoked, SWISH will no longer be able to interact with your eBay account.
      Existing inventory, listings, and order records within SWISH are not automatically deleted
      — see Section 7 for data retention and deletion options.
    </p>

    <h3>How eBay Account Data is Used</h3>
    <p>eBay account data accessed by SWISH is used <strong>solely</strong> to:</p>
    <ul>
      <li>Create, update, and manage eBay listings for items in your SWISH inventory</li>
      <li>Retrieve and record order information so SWISH can track fulfilment and sales outcomes</li>
      <li>Update shipping and tracking details on eBay orders</li>
      <li>Apply repricing rules to active listings within floor/ceiling price limits you set</li>
      <li>Display eBay listing performance data (views, watchers) in the SWISH dashboard</li>
    </ul>
    <p>
      eBay data is never sold, rented, shared with third parties for marketing purposes, or
      used for any purpose unrelated to providing the SWISH service to you.
    </p>
  </section>

  <!-- ── 4. How We Use Your Data ── -->
  <section id="s4">
    <div class="section-num">04</div>
    <h2>How We Use Your Data</h2>
    <p>SWISH processes personal and business data for the following purposes:</p>

    <table class="data-table">
      <thead>
        <tr>
          <th>Purpose</th>
          <th>Legal Basis</th>
          <th>Data Used</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Providing the SWISH service</td>
          <td><span class="tag tag-blue">Contract</span></td>
          <td>Account, inventory, marketplace connector data</td>
        </tr>
        <tr>
          <td>AI identification &amp; valuation</td>
          <td><span class="tag tag-blue">Contract</span></td>
          <td>Item images (transient processing only)</td>
        </tr>
        <tr>
          <td>eBay listing &amp; order management</td>
          <td><span class="tag tag-blue">Contract</span></td>
          <td>eBay OAuth tokens, item data, listing content</td>
        </tr>
        <tr>
          <td>Prediction learning &amp; improvement</td>
          <td><span class="tag tag-blue">Contract</span></td>
          <td>Predicted vs actual price/profit outcomes (anonymised within your account)</td>
        </tr>
        <tr>
          <td>Security &amp; fraud prevention</td>
          <td><span class="tag tag-green">Legitimate Interest</span></td>
          <td>Server logs, request metadata</td>
        </tr>
        <tr>
          <td>Legal compliance</td>
          <td><span class="tag tag-orange">Legal Obligation</span></td>
          <td>Account records, as required by applicable law</td>
        </tr>
      </tbody>
    </table>

    <p>
      We do not use personal data for automated decision-making that produces legal or
      similarly significant effects on you as an individual. The SWISH autonomous commerce
      engine makes decisions about your inventory and listings on your behalf, acting as
      a tool under your explicit configuration and permissions.
    </p>
  </section>

  <!-- ── 5. Data Storage & Security ── -->
  <section id="s5">
    <div class="section-num">05</div>
    <h2>Data Storage &amp; Security</h2>

    <h3>Infrastructure</h3>
    <p>
      SWISH backend services are hosted on OnSpace Cloud (Supabase-compatible PostgreSQL
      infrastructure). All data is stored within the European Economic Area (EEA) or regions
      with equivalent adequacy decisions, using AES-256 encryption at rest and TLS 1.2+
      encryption in transit.
    </p>

    <h3>Multi-Tenant Isolation</h3>
    <p>
      Each SWISH account operates within its own isolated tenant partition, enforced at the
      database level using Row Level Security (RLS) policies. No user can access another
      user's data. All database queries are scoped to the authenticated tenant by a server-side
      security function; client-supplied tenant IDs are validated against the authenticated
      user's JWT claims before any data is returned.
    </p>

    <h3>Access Controls</h3>
    <ul>
      <li>Database access is restricted to authenticated application services only.</li>
      <li>No direct database access is permitted from client applications.</li>
      <li>Administrative access uses separate privileged credentials, not shared with the application service role.</li>
      <li>All administrative actions are logged.</li>
    </ul>

    <h3>Security Practices</h3>
    <ul>
      <li>Passwords are stored using bcrypt hashing with a cost factor of ≥12.</li>
      <li>Session tokens are short-lived and rotated on every authentication event.</li>
      <li>The SWISH backend is regularly reviewed for common vulnerabilities (injection, authentication bypass, IDOR).</li>
      <li>Sensitive fields (OAuth tokens, API keys) are stored in encrypted columns and are not exposed in API responses or application logs.</li>
    </ul>

    <div class="callout info">
      <div class="callout-icon">ℹ️</div>
      <div class="callout-body">
        <strong>Security incident notification:</strong>
        In the event of a personal data breach that is likely to result in a risk to your rights
        and freedoms, we will notify you without undue delay and, where required, notify the
        relevant supervisory authority within 72 hours of becoming aware of the breach.
      </div>
    </div>
  </section>

  <!-- ── 6. Token & Credential Security ── -->
  <section id="s6">
    <div class="section-num">06</div>
    <h2>Token &amp; Credential Security</h2>

    <div class="callout secure">
      <div class="callout-icon">🔐</div>
      <div class="callout-body">
        <strong>eBay OAuth access and refresh tokens are never transmitted to or stored in the SWISH mobile application.</strong>
        They exist exclusively in the SWISH backend database and are used only for server-to-server eBay API calls.
      </div>
    </div>

    <h3>How Tokens Are Stored</h3>
    <p>
      After the eBay OAuth callback completes, the access token and refresh token are stored in
      the <code>marketplace_connectors</code> table in your private tenant partition, in a
      <code>credential_ref</code> column encrypted at rest. The tokens are bound to your tenant ID and
      cannot be accessed by other tenants.
    </p>

    <h3>Token Usage</h3>
    <p>
      Tokens are retrieved by SWISH edge functions (serverless backend functions) when performing
      eBay API operations requested by you. They are used only within the function execution
      context and are not written to logs, error reports, or any external system.
    </p>

    <h3>Token Rotation</h3>
    <p>
      eBay access tokens expire approximately every 2 hours. SWISH uses the stored refresh token
      to obtain a new access token server-side before expiry. Refresh tokens are long-lived
      (typically 18 months) and are rotated on use.
    </p>

    <h3>Your eBay Developer Credentials (App ID / Cert ID)</h3>
    <p>
      Your eBay App ID, Cert ID, and RuName are the credentials you enter in the SWISH
      Marketplaces wizard. These are transmitted to the SWISH backend over TLS and stored
      in the same encrypted <code>credential_ref</code> field alongside the OAuth tokens.
      They are required to generate new OAuth consent URLs and to refresh tokens. They are
      never visible in the SWISH mobile app after the setup step completes.
    </p>
    <p>
      You can delete your stored eBay credentials at any time by disconnecting the eBay
      connector in the SWISH Marketplaces screen or by contacting us at
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
    </p>
  </section>

  <!-- ── 7. Data Retention & Deletion ── -->
  <section id="s7">
    <div class="section-num">07</div>
    <h2>Data Retention &amp; Deletion</h2>

    <table class="data-table">
      <thead>
        <tr>
          <th>Data Type</th>
          <th>Retention Period</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Account (email, password hash)</td>
          <td>Until account deletion</td>
          <td>Deleted immediately on request</td>
        </tr>
        <tr>
          <td>Business configuration &amp; inventory</td>
          <td>Until account deletion</td>
          <td>Exported on request before deletion</td>
        </tr>
        <tr>
          <td>eBay OAuth tokens</td>
          <td>Until connector is disconnected or account is deleted</td>
          <td>Also revocable via eBay Connected Applications</td>
        </tr>
        <tr>
          <td>eBay developer credentials (App ID, Cert ID)</td>
          <td>Until connector is disconnected or account is deleted</td>
          <td>Deleted on disconnect request</td>
        </tr>
        <tr>
          <td>Order &amp; sales records</td>
          <td>7 years from transaction date</td>
          <td>Required for tax compliance in most jurisdictions</td>
        </tr>
        <tr>
          <td>Audit / decision log</td>
          <td>2 years from event date</td>
          <td>Required for autonomous decision transparency</td>
        </tr>
        <tr>
          <td>Server access logs</td>
          <td>90 days</td>
          <td>Automatically purged</td>
        </tr>
        <tr>
          <td>Item images</td>
          <td>Until item is deleted or account is closed</td>
          <td>Stored in your tenant storage bucket</td>
        </tr>
      </tbody>
    </table>

    <h3>Account Deletion</h3>
    <p>
      To request full deletion of your SWISH account and associated data, contact us at
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> with the subject line
      <strong>"Account Deletion Request"</strong>. We will confirm deletion within 30 days.
      Note that transaction records required by law (e.g. VAT/sales records) may be retained
      for the legally required period.
    </p>
  </section>

  <!-- ── 8. Third-Party Services ── -->
  <section id="s8">
    <div class="section-num">08</div>
    <h2>Third-Party Services</h2>

    <table class="data-table">
      <thead>
        <tr>
          <th>Service</th>
          <th>Purpose</th>
          <th>Data Shared</th>
          <th>Privacy Policy</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>eBay</strong></td>
          <td>Marketplace listing, order management, repricing via eBay APIs</td>
          <td>Item titles, descriptions, prices, images, order data (as required to execute API calls)</td>
          <td><a href="https://www.ebay.com/help/policies/member-behaviour-policies/user-privacy-notice-privacy-policy" target="_blank" rel="noopener">eBay Privacy Policy</a></td>
        </tr>
        <tr>
          <td><strong>OnSpace AI</strong></td>
          <td>AI item identification &amp; valuation (Gemini 3 Flash)</td>
          <td>Item images (transient — not retained by provider beyond inference)</td>
          <td><a href="https://onspace.ai/privacy" target="_blank" rel="noopener">OnSpace AI Privacy Policy</a></td>
        </tr>
        <tr>
          <td><strong>OnSpace Cloud (Supabase-compatible)</strong></td>
          <td>Database, authentication, storage, edge functions</td>
          <td>All application data as described in this Policy</td>
          <td><a href="https://supabase.com/privacy" target="_blank" rel="noopener">Supabase Privacy Policy</a></td>
        </tr>
      </tbody>
    </table>

    <div class="callout ebay">
      <div class="callout-icon">🛒</div>
      <div class="callout-body">
        <strong>eBay API compliance:</strong>
        SWISH's use of the eBay API is governed by the
        <a href="https://developer.ebay.com/join/api-license-agreement" target="_blank" rel="noopener">eBay API License Agreement</a>
        and eBay's Developer Program terms. eBay account data accessed through the API is used
        exclusively for the purposes described in this Policy and in accordance with eBay's API
        usage policies.
      </div>
    </div>

    <p>
      SWISH does not share your personal data with any advertising networks, data brokers,
      analytics companies, or other third parties not listed in the table above.
    </p>
  </section>

  <!-- ── 9. Your Rights ── -->
  <section id="s9">
    <div class="section-num">09</div>
    <h2>Your Rights</h2>
    <p>
      Depending on your location, you may have the following rights regarding your personal data.
      To exercise any of these rights, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th>Right</th>
          <th>Description</th>
          <th>How to Exercise</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Access</strong></td>
          <td>Request a copy of the personal data we hold about you</td>
          <td>Email with subject "Data Access Request"</td>
        </tr>
        <tr>
          <td><strong>Rectification</strong></td>
          <td>Correct inaccurate personal data</td>
          <td>Update in app settings or email us</td>
        </tr>
        <tr>
          <td><strong>Erasure</strong></td>
          <td>Request deletion of your account and associated data</td>
          <td>Email with subject "Account Deletion Request"</td>
        </tr>
        <tr>
          <td><strong>Portability</strong></td>
          <td>Receive your inventory and business data in a structured format</td>
          <td>Email with subject "Data Export Request"</td>
        </tr>
        <tr>
          <td><strong>Restriction</strong></td>
          <td>Restrict processing of your data in certain circumstances</td>
          <td>Contact us to discuss</td>
        </tr>
        <tr>
          <td><strong>Objection</strong></td>
          <td>Object to processing based on legitimate interests</td>
          <td>Contact us to discuss</td>
        </tr>
        <tr>
          <td><strong>Withdraw Consent</strong></td>
          <td>Withdraw eBay OAuth authorisation at any time</td>
          <td>eBay Connected Applications page, or email us</td>
        </tr>
      </tbody>
    </table>

    <p>
      We will respond to all valid requests within 30 days. If we are unable to respond within
      that period, we will notify you of the delay and the reason. If you are unsatisfied with
      our response, you have the right to lodge a complaint with your local data protection
      authority (e.g. the ICO in the United Kingdom, or the relevant supervisory authority in
      your EU member state).
    </p>
  </section>

  <!-- ── 10. Cookies & Analytics ── -->
  <section id="s10">
    <div class="section-num">10</div>
    <h2>Cookies &amp; Analytics</h2>
    <p>
      The SWISH mobile application does not use cookies, advertising identifiers, or
      third-party analytics SDKs. Standard session tokens used for authentication are stored
      securely in the device's secure storage and are not accessible to other applications.
    </p>
    <p>
      If SWISH operates any web-based interface in future, a separate cookie notice will be
      provided at that time.
    </p>
  </section>

  <!-- ── 11. Children ── -->
  <section id="s11">
    <div class="section-num">11</div>
    <h2>Children</h2>
    <p>
      SWISH is a business management tool intended for use by adults aged 18 and over.
      We do not knowingly collect personal data from children under 18. If you believe
      a child has provided us with personal data, please contact us at
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and we will promptly delete it.
    </p>
  </section>

  <!-- ── 12. Changes ── -->
  <section id="s12">
    <div class="section-num">12</div>
    <h2>Changes to This Policy</h2>
    <p>
      We may update this Privacy Policy from time to time to reflect changes in our practices,
      technology, legal requirements, or for other operational reasons. The effective date at
      the top of this page will always reflect the date of the most recent update.
    </p>
    <p>
      For material changes — including any changes to how eBay account data is accessed or
      used — we will notify you by email to the address associated with your SWISH account
      and/or by displaying a prominent notice within the SWISH app, at least 14 days before
      the change takes effect.
    </p>
    <p>
      Your continued use of SWISH after the effective date of a revised Policy constitutes
      your acceptance of the updated terms. If you do not agree to the revised Policy, you
      may close your account by contacting us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
    </p>
    <p>
      Previous versions of this Privacy Policy are available on request.
    </p>
  </section>

  <!-- ── 13. Contact ── -->
  <section id="s13">
    <div class="section-num">13</div>
    <h2>Contact Us</h2>
    <p>
      For all privacy-related queries, data requests, eBay token deletion requests, or
      complaints, contact us using the details below:
    </p>
    <div class="contact-card">
      <div class="contact-row">
        <span class="contact-icon">🏢</span>
        <strong>SWISH — Autonomous Commerce Platform</strong>
      </div>
      <div class="contact-row">
        <span class="contact-icon">✉️</span>
        <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
        <span style="color:var(--faint); font-size:13px;">— Privacy, data requests, eBay token deletion</span>
      </div>
      <div class="contact-row" style="color:var(--faint); font-size:13px; margin-top:4px;">
        We aim to respond to all privacy requests within 5 business days and to resolve them within 30 days.
      </div>
    </div>

    <div class="callout warn" style="margin-top:24px;">
      <div class="callout-icon">📋</div>
      <div class="callout-body">
        <strong>For eBay Developer Program reviewers:</strong>
        The eBay OAuth callback URL registered with this application is:
        <code>https://iwgaqieyoahmcjfziwga.backend.onspace.ai/functions/v1/swish-ebay-oauth?route=callback</code>.
        The OAuth flow uses the Authorization Code Grant type. Requested scopes are
        <code>sell.inventory</code>, <code>sell.fulfillment</code>, <code>sell.account</code>,
        and <code>commerce.identity.readonly</code>. Tokens are stored server-side only and are
        never exposed to the client application. For any questions about the integration,
        contact <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
      </div>
    </div>
  </section>

</div><!-- /page-wrap -->

<footer>
  <p>© ${new Date().getFullYear()} SWISH — Autonomous Commerce Platform. All rights reserved.</p>
  <p>Effective date: ${EFFECTIVE_DATE}</p>
  <div class="links">
    <a href="https://iwgaqieyoahmcjfziwga.backend.onspace.ai/functions/v1/swish-privacy-policy">Privacy Policy</a>
  </div>
</footer>

</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  // Allow public GET requests — no auth required
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  return new Response(html(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
