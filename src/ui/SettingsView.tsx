import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { applyContactCleanup, scanDeviceContacts } from '../contacts/deviceContacts';
import { ConnectedMailAccount, MailAccountConfiguration, MailProtocol, connectMailAccount, disconnectMailAccount, listMailAccounts, syncMailAccount } from '../connectors/mailApiConnector';
import { DetectedMailProvider, detectMailProvider } from '../connectors/mailAutoconfig';
import { ContactCleanupSuggestion } from '../domain/contactCleaning';
import { defaultSmtpPort, MailProviderPreset, SmtpSecurity } from '../domain/mailPresets';
import { radii, ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';

interface SettingsViewProps { onClose: () => void; onMailSynced: () => void; }

/** Form state: the account plus whether to send mail and whether servers were typed by hand. */
interface MailForm extends Omit<MailAccountConfiguration, 'smtp'> {
  sendEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  serversEdited: boolean;
}

const emptyMailForm: MailForm = {
  email: '', protocol: 'imap', host: '', port: 993, secure: true, username: '', password: '',
  sendEnabled: true, smtpHost: '', smtpPort: 587, smtpSecurity: 'starttls', serversEdited: false,
};

const socialNetworks: Array<{ icon: keyof typeof Ionicons.glyphMap; name: string; reason: string }> = [
  { icon: 'logo-whatsapp', name: 'WhatsApp', reason: 'Official API covers business numbers only' },
  { icon: 'logo-facebook', name: 'Messenger', reason: 'Official API covers Facebook Pages only' },
  { icon: 'logo-instagram', name: 'Instagram', reason: 'Official API covers professional accounts only' },
  { icon: 'logo-linkedin', name: 'LinkedIn', reason: 'Messaging is limited to approved partners' },
];

function withEmail(form: MailForm, email: string): MailForm {
  return { ...form, email, username: form.username && form.username !== form.email ? form.username : email };
}

/** Fills server settings from a detected provider unless the person already edited them. */
function withPreset(form: MailForm, preset: MailProviderPreset): MailForm {
  if (form.serversEdited) return form;
  return { ...form, protocol: 'imap', host: preset.imap.host, port: preset.imap.port, smtpHost: preset.smtp.host, smtpPort: preset.smtp.port, smtpSecurity: preset.smtp.security };
}

/** Plain-language list of what is still needed before connecting. */
function missingFields(form: MailForm): string[] {
  const missing: string[] = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) missing.push('email address');
  if (!form.username.trim()) missing.push('username');
  if (!form.password) missing.push('password');
  if (!form.host.trim()) missing.push('incoming server');
  if (!(form.port > 0 && form.port < 65536)) missing.push('incoming port');
  if (form.sendEnabled && !form.smtpHost.trim()) missing.push('outgoing server');
  if (form.sendEnabled && !(form.smtpPort > 0 && form.smtpPort < 65536)) missing.push('outgoing port');
  return missing;
}

function toConfiguration(form: MailForm): MailAccountConfiguration {
  const { sendEnabled, smtpHost, smtpPort, smtpSecurity, serversEdited: _edited, ...account } = form;
  return { ...account, email: account.email.trim(), username: account.username.trim(), host: account.host.trim(), ...(sendEnabled ? { smtp: { host: smtpHost.trim(), port: smtpPort, security: smtpSecurity } } : {}) };
}

export function SettingsView({ onClose, onMailSynced }: SettingsViewProps) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mailForm, setMailForm] = useState<MailForm>();
  const [detected, setDetected] = useState<DetectedMailProvider>();
  const [detecting, setDetecting] = useState(false);
  const [showServers, setShowServers] = useState(false);
  const [mailAccounts, setMailAccounts] = useState<ConnectedMailAccount[]>([]);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string>();
  const [syncedCounts, setSyncedCounts] = useState<Record<string, number>>({});
  const [contactSuggestions, setContactSuggestions] = useState<ContactCleanupSuggestion[]>([]);
  const [contactsBusy, setContactsBusy] = useState(false);
  const [contactsConnected, setContactsConnected] = useState(false);
  const [contactsError, setContactsError] = useState('');

  useEffect(() => {
    let active = true;
    listMailAccounts().then((accounts) => active && setMailAccounts(accounts)).catch((error) => active && setMailError(error instanceof Error ? error.message : 'Could not load connected mailboxes.'));
    return () => { active = false; };
  }, []);

  // Detect the provider (including custom domains via MX) shortly after the address is typed.
  const formEmail = mailForm?.email.trim().toLowerCase() ?? '';
  useEffect(() => {
    setDetected(undefined);
    // Auto-filled servers belong to the previous address; typed-in servers are kept.
    setMailForm((current) => current && !current.serversEdited && current.host
      ? { ...current, protocol: 'imap', host: '', port: 993, smtpHost: '', smtpPort: 587, smtpSecurity: 'starttls' }
      : current);
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(formEmail)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setDetecting(true);
      detectMailProvider(formEmail, controller.signal)
        .then((result) => {
          if (controller.signal.aborted || !result) return;
          setDetected(result);
          setMailForm((current) => current && withPreset(current, result.preset));
        })
        .finally(() => { if (!controller.signal.aborted) setDetecting(false); });
    }, 450);
    return () => { controller.abort(); clearTimeout(timer); setDetecting(false); };
  }, [formEmail]);

  const openForm = () => { setMailError(''); setDetected(undefined); setShowServers(false); setMailForm({ ...emptyMailForm }); };
  const closeForm = () => { setMailForm(undefined); setMailError(''); };

  const submitMail = async () => {
    if (!mailForm) return;
    setMailBusy(true);
    setMailError('');
    try {
      const account = await connectMailAccount(toConfiguration(mailForm));
      setMailAccounts((current) => [account, ...current.filter((item) => item.id !== account.id)]);
      const messages = await syncMailAccount(account.id);
      setSyncedCounts((current) => ({ ...current, [account.id]: messages.length }));
      onMailSynced();
      setMailForm(undefined);
    } catch (error) {
      setMailError(error instanceof Error ? error.message : 'Could not connect this mailbox.');
    } finally {
      setMailBusy(false);
    }
  };

  const syncExisting = async (account: ConnectedMailAccount) => {
    setMailBusy(true);
    setMailError('');
    try {
      const messages = await syncMailAccount(account.id);
      setSyncedCounts((current) => ({ ...current, [account.id]: messages.length }));
      onMailSynced();
    } catch (error) {
      setMailError(error instanceof Error ? error.message : 'Mailbox sync failed.');
    } finally {
      setMailBusy(false);
    }
  };

  const disconnect = async (account: ConnectedMailAccount) => {
    setMailBusy(true);
    setMailError('');
    try {
      await disconnectMailAccount(account.id);
      setMailAccounts((current) => current.filter((item) => item.id !== account.id));
      setSyncedCounts((current) => { const next = { ...current }; delete next[account.id]; return next; });
      setConfirmRemove(undefined);
      onMailSynced();
    } catch (error) {
      setMailError(error instanceof Error ? error.message : 'Could not disconnect this mailbox.');
    } finally {
      setMailBusy(false);
    }
  };

  const connectContacts = async () => {
    setContactsBusy(true);
    setContactsError('');
    try {
      setContactSuggestions(await scanDeviceContacts());
      setContactsConnected(true);
    } catch (error) {
      setContactsError(error instanceof Error ? error.message : 'Could not read Contacts.');
    } finally {
      setContactsBusy(false);
    }
  };

  const applySuggestion = async (suggestion: ContactCleanupSuggestion) => {
    setContactsBusy(true);
    setContactsError('');
    try {
      await applyContactCleanup(suggestion);
      setContactSuggestions((current) => current.filter((item) => item.contactId !== suggestion.contactId));
    } catch (error) {
      setContactsError(error instanceof Error ? error.message : 'Could not update this contact.');
    } finally {
      setContactsBusy(false);
    }
  };

  const statusFor = (account: ConnectedMailAccount) => {
    const count = syncedCounts[account.id];
    const synced = count == null ? '' : ` · ${count} ${count === 1 ? 'message' : 'messages'} synced`;
    return `${account.canSend ? 'Receive and reply' : 'Receive only'}${synced}`;
  };
  const missing = mailForm ? missingFields(mailForm) : [];
  const serversCollapsed = Boolean(detected) && !showServers && !mailForm?.serversEdited;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Settings" onPress={onClose} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
        <Text style={styles.title}>Email & connections</Text>
      </View>

      <Text style={styles.sectionTitle}>Email</Text>
      <Text style={styles.sectionCopy}>Your email shows up in Messages next to everyone else, and you can reply from there.</Text>
      <View style={styles.card}>
        {mailAccounts.map((account) => (
          <View key={account.id} style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="mail-outline" size={18} color={colors.text} /></View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle} numberOfLines={1}>{account.email}</Text>
              <Text style={styles.rowDetail}>{confirmRemove === account.id ? 'Remove this mailbox and its imported email from Open Media? Your mailbox itself is not changed.' : statusFor(account)}</Text>
            </View>
            {confirmRemove === account.id ? <>
              <TextButton label="Cancel" onPress={() => setConfirmRemove(undefined)} disabled={mailBusy} />
              <TextButton label="Remove" danger onPress={() => disconnect(account)} disabled={mailBusy} />
            </> : <>
              <TextButton label="Sync" onPress={() => syncExisting(account)} disabled={mailBusy} />
              <TextButton label="Remove" onPress={() => setConfirmRemove(account.id)} disabled={mailBusy} />
            </>}
          </View>
        ))}
        <Pressable accessibilityRole="button" onPress={openForm} style={[styles.row, mailAccounts.length > 0 && styles.rowDivider]}>
          <View style={styles.rowIcon}><Ionicons name="add" size={20} color={colors.text} /></View>
          <View style={styles.rowCopy}><Text style={styles.rowTitle}>Add email account</Text><Text style={styles.rowDetail}>Gmail, iCloud, Yahoo, Fastmail, Zoho, or any IMAP/SMTP provider</Text></View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>
      </View>
      {mailBusy && !mailForm ? <ActivityIndicator style={styles.inlineSpinner} color={colors.text} /> : null}
      {mailError && !mailForm ? <Text accessibilityRole="alert" style={styles.error}>{mailError}</Text> : null}
      <Text style={styles.footnote}>Passwords are encrypted by the mail service and never stored in the app.</Text>

      {Platform.OS !== 'web' ? <>
        <Text style={styles.sectionTitle}>Contacts</Text>
        <Text style={styles.sectionCopy}>Tidy email and phone formatting on this device. Every change is shown for review first.</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="person-outline" size={18} color={colors.text} /></View>
            <View style={styles.rowCopy}><Text style={styles.rowTitle}>Contacts on this device</Text><Text style={styles.rowDetail}>{contactsConnected ? `${contactSuggestions.length} suggestions` : 'Stays on this device'}</Text></View>
            {contactsBusy ? <ActivityIndicator color={colors.text} /> : <Switch accessibilityLabel="Review Contacts" value={contactsConnected} onValueChange={(enabled) => enabled ? connectContacts() : (setContactsConnected(false), setContactSuggestions([]))} trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} />}
          </View>
          {contactSuggestions.map((suggestion) => (
            <View key={suggestion.contactId} style={[styles.row, styles.rowDivider]}>
              <View style={styles.rowCopy}><Text style={styles.rowTitle}>{suggestion.contactName}</Text><Text style={styles.rowDetail}>{suggestion.changes.join(' · ')}</Text></View>
              <TextButton label="Update" onPress={() => applySuggestion(suggestion)} disabled={contactsBusy} />
            </View>
          ))}
        </View>
        {contactsError ? <Text style={styles.error}>{contactsError}</Text> : null}
      </> : null}

      <Text style={styles.sectionTitle}>Social messaging</Text>
      <Text style={styles.sectionCopy}>These join Messages only through official APIs. Today none of them let apps read personal chats, so they stay off instead of relying on scraping.</Text>
      <View style={styles.card}>
        {socialNetworks.map((network, index) => (
          <View key={network.name} style={[styles.row, index > 0 && styles.rowDivider]}>
            <View style={styles.rowIcon}><Ionicons name={network.icon} size={18} color={colors.textTertiary} /></View>
            <View style={styles.rowCopy}><Text style={[styles.rowTitle, styles.muted]}>{network.name}</Text><Text style={styles.rowDetail}>{network.reason}</Text></View>
            <Text style={styles.badge}>Not available</Text>
          </View>
        ))}
      </View>

      <Modal visible={Boolean(mailForm)} animationType="fade" transparent onRequestClose={closeForm}>
        <View style={styles.backdrop}><View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Add email account</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={closeForm} style={styles.back}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
            <Field label="Email address" value={mailForm?.email ?? ''} onChangeText={(email) => setMailForm((current) => current && withEmail(current, email))} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" />
            {detecting ? <Text style={styles.hint}>Looking up mail settings…</Text> : null}
            {detected ? <View style={styles.note}>
              <Text style={styles.noteTitle}>{detected.preset.label}{detected.customDomain ? ' (custom domain)' : ''}</Text>
              {detected.customDomain && detected.preset.customDomainNote ? <Text style={styles.noteText}>{detected.preset.customDomainNote}</Text> : null}
              <Text style={styles.noteText}>{detected.preset.passwordHelp}</Text>
              {detected.preset.caution ? <Text style={[styles.noteText, styles.caution]}>{detected.preset.caution}</Text> : null}
            </View> : null}
            <Field label="Username" value={mailForm?.username ?? ''} onChangeText={(username) => setMailForm((current) => current && ({ ...current, username }))} autoCapitalize="none" />
            <Field label="App password" value={mailForm?.password ?? ''} onChangeText={(password) => setMailForm((current) => current && ({ ...current, password }))} secureTextEntry autoComplete="off" />

            <View style={styles.switchRow}>
              <View style={styles.rowCopy}><Text style={styles.rowTitle}>Reply from Open Media</Text><Text style={styles.rowDetail}>Sends through your provider’s SMTP server with the same sign-in.</Text></View>
              <Switch accessibilityLabel="Reply from Open Media" value={mailForm?.sendEnabled ?? true} onValueChange={(sendEnabled) => setMailForm((current) => current && ({ ...current, sendEnabled }))} trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} />
            </View>

            {serversCollapsed ? (
              <Pressable accessibilityRole="button" onPress={() => setShowServers(true)} style={styles.disclosure}>
                <Text style={styles.rowDetail}>Servers: {mailForm?.host}{mailForm?.sendEnabled ? ` · ${mailForm.smtpHost}` : ''}</Text>
                <Text style={styles.link}>Edit server settings</Text>
              </Pressable>
            ) : <>
              <Text style={styles.groupLabel}>Incoming mail</Text>
              <View style={styles.segment}>
                <SegmentButton label="IMAP" active={mailForm?.protocol === 'imap'} onPress={() => setMailForm((current) => current && ({ ...current, protocol: 'imap' as MailProtocol, port: 993, serversEdited: true }))} />
                <SegmentButton label="POP" active={mailForm?.protocol === 'pop3'} onPress={() => setMailForm((current) => current && ({ ...current, protocol: 'pop3' as MailProtocol, port: 995, serversEdited: true }))} />
              </View>
              <View style={styles.serverRow}>
                <View style={styles.serverHost}><Field label="Server" placeholder={mailForm?.protocol === 'pop3' ? 'pop.example.com' : 'imap.example.com'} value={mailForm?.host ?? ''} onChangeText={(host) => setMailForm((current) => current && ({ ...current, host, serversEdited: true }))} autoCapitalize="none" /></View>
                <View style={styles.port}><Field label="Port" value={String(mailForm?.port || '')} onChangeText={(port) => setMailForm((current) => current && ({ ...current, port: Number(port) || 0, serversEdited: true }))} keyboardType="number-pad" /></View>
              </View>
              {mailForm?.sendEnabled ? <>
                <Text style={styles.groupLabel}>Outgoing mail (SMTP)</Text>
                <View style={styles.segment}>
                  {(['starttls', 'tls'] as const).map((security) => <SegmentButton key={security} label={security === 'starttls' ? 'STARTTLS · 587' : 'TLS · 465'} active={mailForm.smtpSecurity === security} onPress={() => setMailForm((current) => current && ({ ...current, smtpSecurity: security, smtpPort: defaultSmtpPort(security), serversEdited: true }))} />)}
                </View>
                <View style={styles.serverRow}>
                  <View style={styles.serverHost}><Field label="Server" placeholder="smtp.example.com" value={mailForm.smtpHost} onChangeText={(smtpHost) => setMailForm((current) => current && ({ ...current, smtpHost, serversEdited: true }))} autoCapitalize="none" /></View>
                  <View style={styles.port}><Field label="Port" value={String(mailForm.smtpPort || '')} onChangeText={(port) => setMailForm((current) => current && ({ ...current, smtpPort: Number(port) || 0, serversEdited: true }))} keyboardType="number-pad" /></View>
                </View>
              </> : null}
              <Text style={styles.hint}>Connections always use encryption (TLS).</Text>
            </>}
          </ScrollView>
          <View style={styles.sheetFooter}>
            {mailError ? <Text accessibilityRole="alert" style={styles.error}>{mailError}</Text> : null}
            {missing.length ? <Text style={styles.hint}>Still needed: {missing.join(', ')}.</Text> : null}
            <Pressable accessibilityRole="button" disabled={mailBusy || missing.length > 0} onPress={submitMail} style={[styles.primary, (mailBusy || missing.length > 0) && styles.primaryDisabled]}>
              {mailBusy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryText}>Connect</Text>}
            </Pressable>
            <Text style={styles.footnote}>We test the sign-in with your provider before saving.</Text>
          </View>
        </View></View>
      </Modal>
    </ScrollView>
  );
}

function useStyles() {
  const { colors } = useOpenMediaTheme();
  return { colors, styles: useMemo(() => createStyles(colors), [colors]) };
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { colors, styles } = useStyles();
  const { label, ...inputProps } = props;
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...inputProps} placeholderTextColor={colors.textTertiary} style={styles.input} /></View>;
}

function TextButton({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const { styles } = useStyles();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={styles.textButton}><Text style={[styles.textButtonLabel, danger && styles.danger]}>{label}</Text></Pressable>;
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { styles } = useStyles();
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={onPress} style={[styles.segmentButton, active && styles.segmentActive]}><Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text></Pressable>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 64 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, marginLeft: -10 },
    back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
    sectionTitle: { marginTop: 28, color: colors.text, fontSize: 16, fontWeight: '700' },
    sectionCopy: { marginTop: 4, marginBottom: 12, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    card: { borderRadius: radii.medium, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface },
    row: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    rowDetail: { marginTop: 2, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
    muted: { color: colors.textSecondary },
    badge: { color: colors.textTertiary, fontSize: 11, fontWeight: '600' },
    textButton: { minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radii.pill },
    textButtonLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
    danger: { color: colors.danger },
    inlineSpinner: { marginTop: 10 },
    error: { marginTop: 10, color: colors.danger, fontSize: 12, lineHeight: 18 },
    footnote: { marginTop: 10, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
    backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { width: '100%', maxWidth: 520, maxHeight: '94%', borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 22, paddingRight: 8, paddingTop: 10 },
    sheetTitle: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
    sheetBody: { paddingHorizontal: 22, paddingBottom: 8 },
    sheetFooter: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 18, borderTopWidth: 1, borderTopColor: colors.border },
    field: { marginTop: 12 },
    fieldLabel: { marginBottom: 6, color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    input: { minHeight: 46, paddingHorizontal: 14, color: colors.text, fontSize: 15, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, outlineStyle: 'none' } as object,
    hint: { marginTop: 8, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
    note: { marginTop: 12, padding: 14, gap: 6, borderRadius: 12, backgroundColor: colors.chrome },
    noteTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
    noteText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
    caution: { color: colors.danger },
    switchRow: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
    disclosure: { marginTop: 14, gap: 4 },
    link: { color: colors.text, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
    groupLabel: { marginTop: 20, marginBottom: 8, color: colors.text, fontSize: 13, fontWeight: '700' },
    segment: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: radii.pill, backgroundColor: colors.chrome },
    segmentButton: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
    segmentActive: { backgroundColor: colors.text },
    segmentText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    segmentTextActive: { color: colors.surface },
    serverRow: { flexDirection: 'row', gap: 10 },
    serverHost: { flex: 1 },
    port: { width: 92 },
    primary: { marginTop: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.text },
    primaryDisabled: { opacity: 0.35 },
    primaryText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  });
}
