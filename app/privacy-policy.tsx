// SWISH Privacy Policy — In-App Screen
// Public — no authentication required.
// Mirrors the content served at the public HTTPS URL.

import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';

const CONTACT_EMAIL   = 'privacy@swish.app'; // ← replace with real email
const EFFECTIVE_DATE  = '10 September 2026';
const PUBLIC_URL      = 'https://iwgaqieyoahmcjfziwga.backend.onspace.ai/functions/v1/swish-privacy-policy';
const EBAY_CALLBACK   = 'https://iwgaqieyoahmcjfziwga.backend.onspace.ai/functions/v1/swish-ebay-oauth?route=callback';

// ── Mini components ──────────────────────────────────────────────────────────

function SectionHeader({ num, title }: { num: string; title: string }) {
  return (
    <View style={sh.wrap}>
      <View style={sh.numBadge}><Text style={sh.num}>{num}</Text></View>
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}
const sh = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md, marginTop: Spacing.xl },
  numBadge: { backgroundColor: Colors.primaryDim, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
  num: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.5 },
  title: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary, flex: 1 },
});

function Callout({
  icon, children, type = 'info',
}: { icon: string; children: React.ReactNode; type?: 'info' | 'warn' | 'secure' | 'ebay' }) {
  const bg = {
    info: Colors.infoDim,
    warn: Colors.warningDim,
    secure: Colors.successDim,
    ebay: '#E5323812',
  }[type];
  const border = {
    info: Colors.info + '30',
    warn: Colors.warning + '30',
    secure: Colors.success + '30',
    ebay: '#E5323830',
  }[type];
  return (
    <View style={[co.box, { backgroundColor: bg, borderColor: border }]}>
      <Text style={co.icon}>{icon}</Text>
      <View style={co.body}>{children}</View>
    </View>
  );
}
const co = StyleSheet.create({
  box: { flexDirection: 'row', gap: Spacing.md, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, marginVertical: Spacing.sm },
  icon: { fontSize: 18, marginTop: 1 },
  body: { flex: 1, gap: 4 },
});

function Bullet({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: 5 }}>
      <Text style={{ color: Colors.primary, marginTop: 3 }}>•</Text>
      <Text style={{ flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

function DataRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={dr.row}>
      <Text style={dr.label}>{label}</Text>
      <View style={dr.right}>
        <Text style={dr.value}>{value}</Text>
        {note ? <Text style={dr.note}>{note}</Text> : null}
      </View>
    </View>
  );
}
const dr = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  label: { width: 130, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 18 },
  right: { flex: 1, gap: 2 },
  value: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 18 },
  note: { fontSize: 11, color: Colors.textTertiary },
});

function LinkText({ href, children }: { href: string; children: string }) {
  return (
    <Text
      style={{ color: Colors.primary, fontSize: Typography.size.sm }}
      onPress={() => Linking.openURL(href)}
    >
      {children}
    </Text>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const openWeb = useCallback(() => Linking.openURL(PUBLIC_URL), []);
  const openMail = useCallback(() => Linking.openURL(`mailto:${CONTACT_EMAIL}`), []);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.headerTitle}>Privacy Policy</Text>
          <Text style={s.headerSub}>Effective {EFFECTIVE_DATE}</Text>
        </View>
        <Pressable onPress={openWeb} style={s.webBtn} hitSlop={8}>
          <MaterialIcons name="open-in-new" size={14} color={Colors.primary} />
          <Text style={s.webBtnText}>Web</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary */}
        <Callout icon="ℹ️" type="info">
          <Text style={{ fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 }}>
            <Text style={{ color: Colors.textPrimary, fontWeight: Typography.weight.semibold }}>Plain-English Summary: </Text>
            When you connect your eBay account, SWISH uses eBay&apos;s official OAuth 2.0 flow — you authorise access directly on eBay&apos;s website. SWISH never sees your eBay password. OAuth tokens are stored server-side only and never exposed to the app. We use your data only to provide the service.
          </Text>
        </Callout>

        {/* 1. Who We Are */}
        <SectionHeader num="01" title="Who We Are" />
        <Text style={s.body}>
          SWISH is an autonomous commerce operating system that enables resellers to manage acquisitions, identify and value items, generate marketplace listings, and track profits. This Policy explains how SWISH collects, uses, stores, and protects your data — including data obtained via eBay&apos;s OAuth 2.0 service.
        </Text>

        {/* 2. Data We Collect */}
        <SectionHeader num="02" title="Data We Collect" />
        <Text style={s.subhead}>Account Data</Text>
        <Bullet text="Email address and password hash (bcrypt — never plain text)" />
        <Bullet text="Account creation timestamp" />
        <Text style={s.subhead}>Business &amp; Inventory Data</Text>
        <Bullet text="Business configuration: capital, limits, automation level, categories" />
        <Bullet text="Inventory: item titles, descriptions, valuations, attributes, photographs" />
        <Bullet text="Listings, orders, sale outcomes, and profit records" />
        <Text style={s.subhead}>Images</Text>
        <Text style={s.body}>
          When you scan an item, photographs are sent to the SWISH AI identification service (OnSpace AI) for inference. Images are processed transiently and are not retained beyond the identification request.
        </Text>

        {/* 3. eBay OAuth */}
        <SectionHeader num="03" title="eBay OAuth &amp; Account Data" />
        <Callout icon="🛒" type="ebay">
          <Text style={{ fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 }}>
            SWISH integrates with eBay using the official{' '}
            <Text style={{ color: Colors.textPrimary, fontWeight: Typography.weight.semibold }}>OAuth 2.0 Authorization Code Grant flow</Text>.
            Your eBay password is never visible to SWISH.
          </Text>
        </Callout>

        <Text style={s.subhead}>How the eBay Connection Works</Text>
        {[
          'You enter your eBay Developer Portal credentials (App ID, Cert ID, RuName) in the SWISH Marketplaces wizard. These are transmitted securely to the SWISH backend over TLS and never stored in the app.',
          "The SWISH backend generates an eBay consent URL and opens it in your device's system browser — directly on eBay's own website.",
          'You sign in to eBay and review the requested permissions. If you approve, eBay redirects to the SWISH secure callback endpoint.',
          "The SWISH backend exchanges the one-time authorisation code for an access token and refresh token via a server-to-server request to eBay. Tokens are never sent to the app.",
          'Tokens are stored encrypted in your private tenant database partition and used only for eBay API calls you authorise.',
        ].map((t, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.sm }}>
            <View style={s.stepNum}><Text style={s.stepNumText}>{i + 1}</Text></View>
            <Text style={{ flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 }}>{t}</Text>
          </View>
        ))}

        <Callout icon="🔒" type="secure">
          <Text style={{ fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 }}>
            <Text style={{ color: Colors.textPrimary, fontWeight: Typography.weight.semibold }}>Tokens are never in the app. </Text>
            eBay OAuth access and refresh tokens exist exclusively on the SWISH backend server and are never transmitted to or stored in the mobile application.
          </Text>
        </Callout>

        <Text style={s.subhead}>eBay Data SWISH Accesses</Text>
        <View style={s.dataTable}>
          <DataRow label="Listing management" value="sell.inventory scope" note="Create, update, manage eBay listings" />
          <DataRow label="Order information" value="sell.fulfillment scope" note="Read and update orders, tracking" />
          <DataRow label="Seller account settings" value="sell.account scope" note="Shipping, returns, payment policies" />
          <DataRow label="Seller identity" value="commerce.identity.readonly" note="Confirm connected account" />
        </View>
        <Text style={[s.body, { marginTop: Spacing.sm }]}>
          SWISH does not request access to eBay buyer data, eBay messages, eBay financial account data, or any scope beyond those listed above.
        </Text>

        <Text style={s.subhead}>Voluntary Authorisation</Text>
        <Text style={s.body}>
          Connecting your eBay account is entirely voluntary. You may revoke access at any time via{' '}
          <Text
            style={{ color: Colors.primary }}
            onPress={() => Linking.openURL('https://signin.ebay.com/ws/eBayISAPI.dll?ThirdPartyAuthSuiteGrant')}
          >
            eBay&apos;s Connected Applications page
          </Text>
          {' '}or by emailing{' '}
          <Text style={{ color: Colors.primary }} onPress={openMail}>{CONTACT_EMAIL}</Text>.
        </Text>

        <Text style={s.subhead}>How eBay Data is Used</Text>
        <Bullet text="Create, update, and manage eBay listings for items in your SWISH inventory" />
        <Bullet text="Retrieve and record order information for fulfilment tracking and profit recording" />
        <Bullet text="Update shipping and tracking details on eBay orders" />
        <Bullet text="Apply repricing rules within floor/ceiling limits you configure" />
        <Bullet text="Display eBay listing performance data (views, watchers) in your dashboard" />
        <Text style={s.body}>eBay data is never sold, shared with third parties for marketing, or used for any purpose unrelated to providing the SWISH service.</Text>

        {/* 4. How We Use Data */}
        <SectionHeader num="04" title="How We Use Your Data" />
        <View style={s.dataTable}>
          <DataRow label="Providing SWISH" value="Contract" note="Account, inventory, marketplace data" />
          <DataRow label="AI identification" value="Contract" note="Item images (transient processing)" />
          <DataRow label="eBay listing & orders" value="Contract" note="OAuth tokens, item and listing data" />
          <DataRow label="Prediction learning" value="Contract" note="Predicted vs actual outcomes within your account" />
          <DataRow label="Security & fraud" value="Legitimate Interest" note="Server logs, request metadata" />
          <DataRow label="Legal compliance" value="Legal Obligation" note="Account and transaction records" />
        </View>

        {/* 5. Data Storage & Security */}
        <SectionHeader num="05" title="Data Storage &amp; Security" />
        <Text style={s.body}>
          SWISH backend services are hosted on OnSpace Cloud infrastructure. All data is encrypted at rest (AES-256) and in transit (TLS 1.2+). Each account operates in a private tenant partition enforced by database-level Row Level Security policies — no user can access another user&apos;s data.
        </Text>
        <Bullet text="Passwords stored as bcrypt hashes (cost factor ≥12) — never in plain text" />
        <Bullet text="Session tokens short-lived and rotated on every authentication event" />
        <Bullet text="OAuth tokens and API keys stored in encrypted columns, never exposed in logs or API responses" />
        <Bullet text="No direct database access from client applications" />

        {/* 6. Token Security */}
        <SectionHeader num="06" title="Token &amp; Credential Security" />
        <Callout icon="🔐" type="secure">
          <Text style={{ fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 }}>
            eBay OAuth access and refresh tokens are stored server-side only, in an encrypted column in your private tenant partition. They are never written to logs, error reports, or any external system.
          </Text>
        </Callout>
        <Text style={s.body}>
          eBay access tokens expire approximately every 2 hours. SWISH refreshes them server-side before expiry using the stored refresh token. Your eBay App ID and Cert ID are stored in the same encrypted field and are not visible in the app after setup completes.
        </Text>
        <Text style={s.body}>
          eBay callback URL registered with this application:{'\n'}
          <Text style={{ color: Colors.primary, fontSize: Typography.size.xs }}>{EBAY_CALLBACK}</Text>
        </Text>

        {/* 7. Retention */}
        <SectionHeader num="07" title="Data Retention &amp; Deletion" />
        <View style={s.dataTable}>
          <DataRow label="Account data" value="Until account deletion" />
          <DataRow label="eBay OAuth tokens" value="Until connector disconnected or account deleted" />
          <DataRow label="eBay developer credentials" value="Until connector disconnected or account deleted" />
          <DataRow label="Order & sales records" value="7 years from transaction" note="Required for tax compliance" />
          <DataRow label="Audit / decision log" value="2 years from event date" />
          <DataRow label="Server access logs" value="90 days — auto-purged" />
        </View>
        <Text style={s.body}>
          To delete your account and all associated data, email{' '}
          <Text style={{ color: Colors.primary }} onPress={openMail}>{CONTACT_EMAIL}</Text>
          {' '}with subject <Text style={{ color: Colors.textPrimary }}>&quot;Account Deletion Request&quot;</Text>. We will confirm deletion within 30 days.
        </Text>

        {/* 8. Third Parties */}
        <SectionHeader num="08" title="Third-Party Services" />
        <View style={s.dataTable}>
          <DataRow label="eBay" value="Marketplace listing & orders" note="eBay API — item data, listing content, order data" />
          <DataRow label="OnSpace AI" value="AI identification (Gemini 3 Flash)" note="Item images — transient, not retained" />
          <DataRow label="OnSpace Cloud" value="Database, auth, storage, edge functions" note="All application data as described in this Policy" />
        </View>
        <Text style={s.body}>
          SWISH does not share your data with advertising networks, data brokers, analytics companies, or other third parties.
        </Text>
        <Callout icon="🛒" type="ebay">
          <Text style={{ fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 }}>
            SWISH&apos;s use of the eBay API is governed by the{' '}
            <Text style={{ color: Colors.primary }} onPress={() => Linking.openURL('https://developer.ebay.com/join/api-license-agreement')}>eBay API License Agreement</Text>
            . eBay account data is used exclusively for the purposes described in this Policy.
          </Text>
        </Callout>

        {/* 9. Your Rights */}
        <SectionHeader num="09" title="Your Rights" />
        <View style={s.dataTable}>
          <DataRow label="Access" value="Request a copy of your data" note="Email: Data Access Request" />
          <DataRow label="Rectification" value="Correct inaccurate data" note="Update in app or email us" />
          <DataRow label="Erasure" value="Delete your account and data" note="Email: Account Deletion Request" />
          <DataRow label="Portability" value="Receive your data in structured format" note="Email: Data Export Request" />
          <DataRow label="Withdraw eBay consent" value="Revoke eBay OAuth authorisation" note="eBay Connected Apps page or email us" />
        </View>
        <Text style={s.body}>
          We respond to all valid requests within 30 days. If unsatisfied, you may lodge a complaint with your local data protection authority (e.g. ICO in the UK).
        </Text>

        {/* 10–11 */}
        <SectionHeader num="10" title="Cookies &amp; Analytics" />
        <Text style={s.body}>
          The SWISH mobile app does not use cookies, advertising identifiers, or third-party analytics SDKs.
        </Text>

        <SectionHeader num="11" title="Children" />
        <Text style={s.body}>
          SWISH is intended for adults aged 18 and over. We do not knowingly collect data from children under 18. Contact us if you believe a child has provided us with data.
        </Text>

        {/* 12. Changes */}
        <SectionHeader num="12" title="Changes to This Policy" />
        <Text style={s.body}>
          We may update this Policy from time to time. For material changes — including changes to how eBay account data is used — we will notify you by email at least 14 days before the change takes effect. The effective date at the top always reflects the latest update.
        </Text>

        {/* 13. Contact */}
        <SectionHeader num="13" title="Contact Us" />
        <View style={s.contactCard}>
          <View style={s.contactRow}>
            <MaterialIcons name="business" size={16} color={Colors.primary} />
            <Text style={s.contactText}>SWISH — Autonomous Commerce Platform</Text>
          </View>
          <Pressable style={s.contactRow} onPress={openMail}>
            <MaterialIcons name="email" size={16} color={Colors.primary} />
            <Text style={[s.contactText, { color: Colors.primary }]}>{CONTACT_EMAIL}</Text>
          </Pressable>
          <Pressable style={s.contactRow} onPress={openWeb}>
            <MaterialIcons name="language" size={16} color={Colors.primary} />
            <Text style={[s.contactText, { color: Colors.primary }]} numberOfLines={1}>View full policy online</Text>
          </Pressable>
        </View>

        <Text style={s.footer}>
          © {new Date().getFullYear()} SWISH · Effective {EFFECTIVE_DATE}
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  webBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  webBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.primary },

  content: { paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, gap: 0 },

  body: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 22, marginBottom: Spacing.sm },
  subhead: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, marginTop: Spacing.md, marginBottom: Spacing.sm },

  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  stepNumText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.primary },

  dataTable: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 0, marginVertical: Spacing.sm },

  contactCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  contactText: { fontSize: Typography.size.sm, color: Colors.textSecondary },

  footer: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', paddingVertical: Spacing.xl },
});
