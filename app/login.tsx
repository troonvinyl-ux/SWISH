// SWISH Login Screen
// OTP + Password authentication for subscribers.
// Handles both login (existing users) and registration (new users).

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuth, useAlert } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { getBrandArtwork } from '@/constants/brandArtwork';
import { useApp } from '@/hooks/useApp';

type AuthMode = 'login' | 'register';
type RegisterStep = 'email_password' | 'verify_otp';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { activeNicheId, fixedNicheId } = useApp();
  const isThreadsFlip = (fixedNicheId ?? activeNicheId) === 'clothing';
  const threads = { background: '#0C080C', surface: '#160E16', border: '#301830', pink: '#E91E8C', cream: '#FFF0F5', muted: '#9A7090' };
  const { sendOTP, verifyOTPAndLogin, signInWithPassword, operationLoading } = useAuth();
  const { showAlert } = useAlert();
  const router = useRouter();

  const [showWelcome, setShowWelcome] = useState(isThreadsFlip);
  const [mode, setMode] = useState<AuthMode>('login');
  const [registerStep, setRegisterStep] = useState<RegisterStep>('email_password');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isValidEmail = email.includes('@') && email.includes('.');

  // ── LOGIN ─────────────────────────────────────────────────────────────
  const handleLogin = useCallback(async () => {
    if (!isValidEmail || !password) {
      showAlert('Please enter your email and password.', undefined, [{ text: 'OK' }]);
      return;
    }
    const { error } = await signInWithPassword(email.trim().toLowerCase(), password);
    if (error) showAlert('Login Failed', error, [{ text: 'OK', style: 'destructive' }]);
  }, [email, password, isValidEmail, signInWithPassword, showAlert]);

  // ── REGISTER STEP 1: Send OTP ─────────────────────────────────────────
  const handleSendOTP = useCallback(async () => {
    if (!isValidEmail) {
      showAlert('Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 6) {
      showAlert('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Passwords do not match.');
      return;
    }
    const { error } = await sendOTP(email.trim().toLowerCase());
    if (error) {
      showAlert('Could not send verification code', error, [{ text: 'OK', style: 'destructive' }]);
      return;
    }
    setRegisterStep('verify_otp');
    showAlert('Verification Code Sent', `Check ${email} for your 4-digit code.`);
  }, [email, password, confirmPassword, isValidEmail, sendOTP, showAlert]);

  // ── REGISTER STEP 2: Verify OTP & create account ──────────────────────
  const handleVerifyOTP = useCallback(async () => {
    if (otp.length !== 4) {
      showAlert('Please enter the 4-digit verification code.');
      return;
    }
    const { error } = await verifyOTPAndLogin(email.trim().toLowerCase(), otp, { password });
    if (error) {
      showAlert('Verification Failed', error, [{ text: 'OK', style: 'destructive' }]);
      return;
    }
    // AuthRouter handles navigation automatically
  }, [email, otp, password, verifyOTPAndLogin, showAlert]);

  const handleResendOTP = useCallback(async () => {
    const { error } = await sendOTP(email.trim().toLowerCase());
    if (!error) showAlert('New code sent', `Check ${email} for your new 4-digit code.`);
  }, [email, sendOTP, showAlert]);

  if (isThreadsFlip && showWelcome) {
    return (
      <View testID="threads-flip-screen-01" accessibilityLabel="Threads Flip screen 01 splash and welcome" style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: threads.background }]}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg }}>
          <Text style={{ color: threads.cream, fontSize: 13, fontWeight: Typography.weight.extrabold, letterSpacing: 3 }}>SWISHFLIP</Text>
          <Image source={getBrandArtwork('clothing')!} contentFit="contain" style={{ width: '100%', height: 250 }} />
          <View style={{ alignItems: 'center', gap: 5 }}>
            <Text style={{ color: threads.cream, fontSize: 34, fontWeight: Typography.weight.extrabold, letterSpacing: 1 }}>THREADS <Text style={{ color: threads.pink }}>FLIP</Text></Text>
            <Text style={{ color: threads.muted, fontSize: 12, fontWeight: Typography.weight.bold, letterSpacing: 1.5 }}>THE CLOTHING RESELLER APP</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 26 }}>
            {(['checkroom', 'checkroom', 'style', 'shopping-bag'] as const).map((name, i) => <MaterialIcons key={i} name={name as any} size={24} color={threads.pink} />)}
          </View>
          <Text style={{ color: threads.cream, fontSize: 11, fontWeight: Typography.weight.bold, letterSpacing: 1, textAlign: 'center' }}>IDENTIFY · VALUE · LIST · FLIP · PROFIT</Text>
          <Pressable onPress={() => { setMode('register'); setRegisterStep('email_password'); setShowWelcome(false); }} style={{ width: '100%', backgroundColor: '#F5C842', borderRadius: Radius.xl, paddingVertical: Spacing.lg, alignItems: 'center' }}>
            <Text style={{ color: threads.background, fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold }}>Get Started →</Text>
          </Pressable>
          <Pressable onPress={() => { setMode('login'); setShowWelcome(false); }} hitSlop={10}>
            <Text style={{ color: threads.cream, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold }}>Sign In</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View testID={isThreadsFlip ? 'threads-flip-auth' : undefined} style={[styles.container, { paddingTop: insets.top }, isThreadsFlip && { backgroundColor: threads.background }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand header */}
          <View style={styles.brand}>
            <View style={styles.logoWrap}>
              <View style={[styles.logoMark, isThreadsFlip && { backgroundColor: threads.pink }]}>
                <Text style={[styles.logoS, isThreadsFlip && { color: threads.background }]}>{isThreadsFlip ? 'T' : 'S'}</Text>
              </View>
              <View style={styles.logoGlow} />
            </View>
            <Text style={[styles.appName, isThreadsFlip && { color: threads.cream }]}>{isThreadsFlip ? 'THREADS FLIP' : 'SWISH'}</Text>
            <Text style={[styles.appTagline, isThreadsFlip && { color: threads.muted }]}>{isThreadsFlip ? 'IDENTIFY · VALUE · STYLE · SELL' : 'Commerce Intelligence Platform'}</Text>
          </View>

          {/* Mode selector */}
          <View style={[styles.modeTabs, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
            <Pressable
              style={[styles.modeTab, mode === 'login' && styles.modeTabActive, isThreadsFlip && mode === 'login' && { backgroundColor: threads.pink }]}
              onPress={() => { setMode('login'); setRegisterStep('email_password'); }}
            >
              <Text style={[styles.modeTabText, mode === 'login' && styles.modeTabTextActive, isThreadsFlip && mode === 'login' && { color: threads.background }]}>
                Sign In
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeTab, mode === 'register' && styles.modeTabActive, isThreadsFlip && mode === 'register' && { backgroundColor: threads.pink }]}
              onPress={() => { setMode('register'); setRegisterStep('email_password'); }}
            >
              <Text style={[styles.modeTabText, mode === 'register' && styles.modeTabTextActive, isThreadsFlip && mode === 'register' && { color: threads.background }]}>
                Create Account
              </Text>
            </Pressable>
          </View>

          {/* ── LOGIN FORM ── */}
          {mode === 'login' ? (
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, isThreadsFlip && { color: threads.cream }]}>Email Address</Text>
                <View style={[styles.inputWrap, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
                  <MaterialIcons name="email" size={18} color={Colors.textTertiary} />
                  <TextInput
                    style={[styles.input, isThreadsFlip && { color: threads.cream }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, isThreadsFlip && { color: threads.cream }]}>Password</Text>
                <View style={[styles.inputWrap, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
                  <MaterialIcons name="lock" size={18} color={Colors.textTertiary} />
                  <TextInput
                    style={[styles.input, isThreadsFlip && { color: threads.cream }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Your password"
                    placeholderTextColor={Colors.textTertiary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                    <MaterialIcons
                      name={showPassword ? 'visibility-off' : 'visibility'}
                      size={18}
                      color={Colors.textTertiary}
                    />
                  </Pressable>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  isThreadsFlip && { backgroundColor: threads.pink, shadowColor: threads.pink },
                  (operationLoading || !isValidEmail || !password) && styles.btnDisabled,
                  pressed && { opacity: 0.88 },
                ]}
                onPress={handleLogin}
                disabled={operationLoading || !isValidEmail || !password}
              >
                {operationLoading ? (
                  <ActivityIndicator color={Colors.background} size="small" />
                ) : (
                  <>
                    <Text style={[styles.primaryBtnText, isThreadsFlip && { color: threads.background }]}>Sign In to {isThreadsFlip ? 'Threads Flip' : 'SWISH'}</Text>
                    <MaterialIcons name="arrow-forward" size={18} color={Colors.background} />
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {/* ── REGISTER: Step 1 — Email + Password ── */}
          {mode === 'register' && registerStep === 'email_password' ? (
            <View style={styles.form}>
              <View style={[styles.infoBox, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
                <MaterialIcons name="info-outline" size={14} color={Colors.info} />
                <Text style={[styles.infoText, isThreadsFlip && { color: threads.muted }]}>
                  A verification code will be sent to your email to confirm your account.
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, isThreadsFlip && { color: threads.cream }]}>Email Address</Text>
                <View style={[styles.inputWrap, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
                  <MaterialIcons name="email" size={18} color={Colors.textTertiary} />
                  <TextInput
                    style={[styles.input, isThreadsFlip && { color: threads.cream }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, isThreadsFlip && { color: threads.cream }]}>Password</Text>
                <View style={[styles.inputWrap, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
                  <MaterialIcons name="lock" size={18} color={Colors.textTertiary} />
                  <TextInput
                    style={[styles.input, isThreadsFlip && { color: threads.cream }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="At least 6 characters"
                    placeholderTextColor={Colors.textTertiary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                    <MaterialIcons
                      name={showPassword ? 'visibility-off' : 'visibility'}
                      size={18}
                      color={Colors.textTertiary}
                    />
                  </Pressable>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, isThreadsFlip && { color: threads.cream }]}>Confirm Password</Text>
                <View style={[
                  styles.inputWrap,
                  confirmPassword && confirmPassword !== password && { borderColor: Colors.danger }
                ]}>
                  <MaterialIcons name="lock-outline" size={18} color={Colors.textTertiary} />
                  <TextInput
                    style={[styles.input, isThreadsFlip && { color: threads.cream }]}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Repeat your password"
                    placeholderTextColor={Colors.textTertiary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                {confirmPassword && confirmPassword !== password ? (
                  <Text style={[styles.fieldError, isThreadsFlip && { color: threads.pink }]}>Passwords do not match</Text>
                ) : null}
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  isThreadsFlip && { backgroundColor: threads.pink, shadowColor: threads.pink },
                  (operationLoading || !isValidEmail || !password || password !== confirmPassword) && styles.btnDisabled,
                  pressed && { opacity: 0.88 },
                ]}
                onPress={handleSendOTP}
                disabled={operationLoading || !isValidEmail || !password || password !== confirmPassword}
              >
                {operationLoading ? (
                  <ActivityIndicator color={Colors.background} size="small" />
                ) : (
                  <>
                    <Text style={[styles.primaryBtnText, isThreadsFlip && { color: threads.background }]}>Send Verification Code</Text>
                    <MaterialIcons name="send" size={18} color={Colors.background} />
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {/* ── REGISTER: Step 2 — Verify OTP ── */}
          {mode === 'register' && registerStep === 'verify_otp' ? (
            <View style={styles.form}>
              <View style={styles.otpHeader}>
                <View style={[styles.otpIconWrap, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.pink + '60' }]}>
                  <MaterialIcons name="mark-email-read" size={32} color={Colors.primary} />
                </View>
                <Text style={[styles.otpTitle, isThreadsFlip && { color: threads.cream }]}>Check Your Email</Text>
                <Text style={[styles.otpSubtitle, isThreadsFlip && { color: threads.muted }]}>
                  We sent a 4-digit code to{'\n'}
                  <Text style={{ color: Colors.textPrimary, fontWeight: Typography.weight.semibold }}>
                    {email}
                  </Text>
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, isThreadsFlip && { color: threads.cream }]}>Verification Code</Text>
                <View style={[styles.inputWrap, styles.otpInputWrap, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border } ]}>
                  <MaterialIcons name="pin" size={18} color={Colors.primary} />
                  <TextInput
                    style={[styles.input, styles.otpInput]}
                    value={otp}
                    onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="number-pad"
                    maxLength={4}
                    autoFocus
                  />
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  isThreadsFlip && { backgroundColor: threads.pink, shadowColor: threads.pink },
                  (operationLoading || otp.length !== 4) && styles.btnDisabled,
                  pressed && { opacity: 0.88 },
                ]}
                onPress={handleVerifyOTP}
                disabled={operationLoading || otp.length !== 4}
              >
                {operationLoading ? (
                  <ActivityIndicator color={Colors.background} size="small" />
                ) : (
                  <>
                    <Text style={[styles.primaryBtnText, isThreadsFlip && { color: threads.background }]}>Create My Account</Text>
                    <MaterialIcons name="check" size={18} color={Colors.background} />
                  </>
                )}
              </Pressable>

              <View style={styles.resendRow}>
                <Text style={[styles.resendText, isThreadsFlip && { color: threads.muted }]}>Did not receive the code?</Text>
                <Pressable onPress={handleResendOTP} disabled={operationLoading}>
                  <Text style={[styles.resendLink, isThreadsFlip && { color: threads.pink }]}>Resend Code</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => setRegisterStep('email_password')}
                style={styles.backLink}
              >
                <MaterialIcons name="arrow-back" size={14} color={Colors.textTertiary} />
                <Text style={[styles.backLinkText, isThreadsFlip && { color: threads.muted }]}>Change email or password</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Footer */}
          <View style={styles.footer}>
            <View style={[styles.footerDivider, isThreadsFlip && { backgroundColor: threads.border }]} />
            <Text style={styles.footerText}>
              By continuing you agree to the SWISH Terms of Service and{' '}
              <Text
                style={styles.footerLink}
                onPress={() => router.push('/privacy-policy' as any)}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    padding: Spacing.xl,
    gap: Spacing.xl,
  },

  // Brand
  brand: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.md },
  logoWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: Radius.xl,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.glow,
  },
  logoGlow: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary + '20',
  },
  logoS: {
    fontSize: 32,
    fontWeight: Typography.weight.extrabold,
    color: Colors.textPrimary,
  },
  appName: {
    fontSize: 28,
    fontWeight: Typography.weight.extrabold,
    color: Colors.textPrimary,
    letterSpacing: 4,
    marginTop: Spacing.sm,
  },
  appTagline: {
    fontSize: Typography.size.sm,
    color: Colors.textTertiary,
    letterSpacing: 0.5,
  },

  // Mode tabs
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  modeTab: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderRadius: Radius.md,
  },
  modeTabActive: { backgroundColor: Colors.primary },
  modeTabText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textTertiary,
  },
  modeTabTextActive: { color: Colors.background },

  // Form
  form: { gap: Spacing.lg },
  field: { gap: Spacing.xs },
  fieldLabel: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldError: {
    fontSize: Typography.size.xs,
    color: Colors.danger,
    marginTop: 2,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  input: {
    flex: 1,
    fontSize: Typography.size.base,
    color: Colors.textPrimary,
    includeFontPadding: false,
  },

  // OTP
  otpHeader: { alignItems: 'center', gap: Spacing.sm },
  otpIconWrap: {
    width: 64,
    height: 64,
    borderRadius: Radius.xl,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  otpTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  otpSubtitle: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  otpInputWrap: { borderColor: Colors.primary, borderWidth: 1.5 },
  otpInput: {
    fontSize: Typography.size.xxl,
    fontWeight: Typography.weight.bold,
    letterSpacing: 12,
    textAlign: 'center',
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xs,
    alignItems: 'center',
  },
  resendText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  resendLink: { fontSize: Typography.size.sm, color: Colors.primary, fontWeight: Typography.weight.semibold },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  backLinkText: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  // Buttons
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.base,
    minHeight: 52,
    ...Shadow.glow,
  },
  btnDisabled: { opacity: 0.4 },
  primaryBtnText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    color: Colors.background,
  },

  // Info
  infoBox: {
    flexDirection: 'row',
    gap: Spacing.xs,
    backgroundColor: Colors.infoDim,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.info + '30',
  },
  infoText: {
    flex: 1,
    fontSize: Typography.size.xs,
    color: Colors.info,
    lineHeight: 16,
  },

  // Footer
  footer: { alignItems: 'center', gap: Spacing.md, marginTop: Spacing.md },
  footerDivider: {
    width: 40,
    height: 1,
    backgroundColor: Colors.surfaceBorder,
  },
  footerText: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },
  footerLink: {
    fontSize: Typography.size.xs,
    color: Colors.primary,
    textDecorationLine: 'underline',
  },
});
