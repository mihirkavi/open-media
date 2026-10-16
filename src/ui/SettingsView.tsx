import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { applyContactCleanup, scanDeviceContacts } from '../contacts/deviceContacts';
import { ConnectedMailAccount, MailAccountConfiguration, MailProtocol, connectMailAccount, disconnectMailAccount, listMailAccounts, syncMailAccount } from '../connectors/mailApiConnector';
import { defaultSmtpPort, presetForEmail, SmtpSecurity } from '../domain/mailPresets';
import { ContactCleanupSuggestion } from '../domain/contactCleaning';
import { colors, radii } from '../theme';

interface SettingsViewProps { isCompact: boolean; onClose: () => void; onMailSynced: () => void; }

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

/** Fills server settings from a known provider unless the person already edited them. */
function withEmail(form: MailForm, email: string): MailForm {
  const next = { ...form, email, username: form.username && form.username !== form.email ? form.username : email };
  const preset = presetForEmail(email);
  if (!preset || form.serversEdited) return next;
  return { ...next, protocol: 'imap', host: preset.imap.host, port: preset.imap.port, smtpHost: preset.smtp.host, smtpPort: preset.smtp.port, smtpSecurity: preset.smtp.security };
}

function toConfiguration(form: MailForm): MailAccountConfiguration {
  const { sendEnabled, smtpHost, smtpPort, smtpSecurity, serversEdited: _edited, ...account } = form;
  return { ...account, email: account.email.trim(), username: account.username.trim(), host: account.host.trim(), ...(sendEnabled ? { smtp: { host: smtpHost.trim(), port: smtpPort, security: smtpSecurity } } : {}) };
}

export function SettingsView({ isCompact, onClose, onMailSynced }: SettingsViewProps) {
  const [mailForm, setMailForm] = useState<MailForm>();
  const [mailAccounts, setMailAccounts] = useState<ConnectedMailAccount[]>([]);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState('');
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

  const confirmDisconnect = (account: ConnectedMailAccount) => Alert.alert(
    'Disconnect mailbox?',
    `This removes ${account.email}'s saved credential and imported messages from Open Media. It does not change the mailbox itself.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect(account) },
    ],
  );

  const disconnect = async (account: ConnectedMailAccount) => {
    setMailBusy(true);
    setMailError('');
    try {
      await disconnectMailAccount(account.id);
      setMailAccounts((current) => current.filter((item) => item.id !== account.id));
      setSyncedCounts((current) => { const next = { ...current }; delete next[account.id]; return next; });
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
      const suggestions = await scanDeviceContacts();
      setContactSuggestions(suggestions);
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

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerLeading}>
          {isCompact ? <IconButton label="Back to people" icon="chevron-back" onPress={onClose} /> : null}
          <View><Text style={styles.eyebrow}>OPEN MEDIA</Text><Text style={styles.title}>Email & connections</Text></View>
        </View>
        {!isCompact ? <IconButton label="Close settings" icon="close" onPress={onClose} /> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle title="Open Media account" copy="Signed in. Mailboxes are isolated to this account." />
        <View style={styles.sectionGap} />
        <SectionTitle title="Email" copy="Connect any mailbox that supports IMAP (or POP) for receiving and SMTP for sending. Your email shows up in Messages next to everyone else, and you can reply from there." />
        <View style={styles.card}>
          <ConnectionRow icon="mail-outline" color="#55616F" title="Add an email account" detail="Gmail, iCloud, Yahoo, Fastmail, Zoho, or any IMAP/SMTP provider" connected={mailAccounts.length > 0} onPress={() => { setMailError(''); setMailForm({ ...emptyMailForm }); }} />
        </View>
        <View style={styles.note}><Ionicons name="lock-closed-outline" size={17} color={colors.textSecondary} /><Text style={styles.noteText}>Your password goes over HTTPS to the mail-sync service, is encrypted there, and is never saved in the app or logs.</Text></View>
        {mailError ? <Text accessibilityRole="alert" style={styles.error}>{mailError}</Text> : null}
        {mailAccounts.map((account) => (
          <View key={account.id} style={styles.mailAccountCard}>
            <View style={styles.connectionCopy}>
              <Text style={styles.connectionName}>{account.email}</Text>
              <Text style={[styles.connectionStatus, styles.activeText]}>{account.protocol.toUpperCase()}{account.canSend ? ' + SMTP · can reply' : ' · receive only'} · {syncedCounts[account.id] == null ? 'Connected' : `${syncedCounts[account.id]} messages synced`}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Sync ${account.email}`} disabled={mailBusy} onPress={() => syncExisting(account)} style={styles.mailAction}><Text style={styles.mailActionText}>Sync</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Disconnect ${account.email}`} disabled={mailBusy} onPress={() => confirmDisconnect(account)} style={[styles.mailAction, styles.disconnectAction]}><Text style={styles.disconnectText}>Disconnect</Text></Pressable>
          </View>
        ))}

        <View style={styles.sectionGap} />
        <SectionTitle title="Apple Contacts" copy="Open Media can privately normalize email and phone formatting. Every phone update stays reviewable—nothing is silently changed." />
        <View style={styles.card}>
          <View style={styles.connectionRow}>
            <View style={[styles.providerIcon, { backgroundColor: colors.accent }]}><Ionicons name="person" size={19} color={colors.surface} /></View>
            <View style={styles.connectionCopy}><Text style={styles.connectionName}>Contacts on this phone</Text><Text style={[styles.connectionStatus, contactsConnected && styles.activeText]}>{contactsConnected ? `${contactSuggestions.length} cleanup suggestions` : 'On-device only'}</Text></View>
            {contactsBusy ? <ActivityIndicator color={colors.accent} /> : <Switch accessibilityLabel="Connect Apple Contacts" value={contactsConnected} onValueChange={(enabled) => enabled ? connectContacts() : (setContactsConnected(false), setContactSuggestions([]))} trackColor={{ false: '#D7D9DE', true: colors.accent }} />}
          </View>
        </View>
        {contactsError ? <Text style={styles.error}>{contactsError}</Text> : null}
        {contactSuggestions.map((suggestion) => (
          <View key={suggestion.contactId} style={styles.suggestionCard}>
            <View style={styles.suggestionCopy}><Text style={styles.connectionName}>{suggestion.contactName}</Text><Text style={styles.connectionStatus}>{suggestion.changes.join(' · ')}</Text></View>
            <Pressable disabled={contactsBusy} onPress={() => applySuggestion(suggestion)} style={styles.reviewButton}><Text style={styles.reviewButtonText}>Update</Text></Pressable>
          </View>
        ))}

        <View style={styles.sectionGap} />
        <SectionTitle title="Social messaging" copy="Open Media joins these conversations into Messages only through official APIs. Today their APIs don’t give apps access to personal chats, so they stay off rather than relying on scraping or unofficial bridges." />
        <View style={[styles.card, styles.disabledCard]}><ConnectionRow icon="logo-whatsapp" color="#25D366" title="WhatsApp" detail="Official API covers business numbers only, not personal chats" disabled /><View style={styles.divider} /><ConnectionRow icon="logo-facebook" color="#0866FF" title="Facebook Messenger" detail="Official API covers Facebook Pages only, not personal inboxes" disabled /><View style={styles.divider} /><ConnectionRow icon="logo-instagram" color="#C13584" title="Instagram" detail="Official API covers professional accounts only" disabled /><View style={styles.divider} /><ConnectionRow icon="logo-linkedin" color="#0A66C2" title="LinkedIn" detail="Messaging API is restricted to approved partners" disabled /></View>
      </ScrollView>

      <Modal visible={Boolean(mailForm)} animationType="slide" transparent onRequestClose={() => setMailForm(undefined)}>
        <View style={styles.modalBackdrop}><View style={styles.mailCard}>
          <Text style={styles.modalTitle}>Connect email</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
          <Field label="Email address" value={mailForm?.email ?? ''} onChangeText={(email) => setMailForm((current) => current && withEmail(current, email))} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
          {mailForm && presetForEmail(mailForm.email) ? <View style={styles.note}><Ionicons name="information-circle-outline" size={17} color={colors.textSecondary} /><Text style={styles.noteText}>{presetForEmail(mailForm.email)!.label} settings filled in. {presetForEmail(mailForm.email)!.passwordHelp}{presetForEmail(mailForm.email)!.caution ? `\n\n${presetForEmail(mailForm.email)!.caution}` : ''}</Text></View> : null}
          <Field label="Username" value={mailForm?.username ?? ''} onChangeText={(username) => setMailForm((current) => current && ({ ...current, username }))} autoCapitalize="none" />
          <Field label="Password (usually an app password)" value={mailForm?.password ?? ''} onChangeText={(password) => setMailForm((current) => current && ({ ...current, password }))} secureTextEntry autoComplete="off" />
          <Text style={[styles.fieldLabel, styles.groupLabel]}>Incoming mail</Text>
          <View style={styles.protocolRow}><ProtocolButton value="imap" active={mailForm?.protocol === 'imap'} onPress={() => setMailForm((current) => current && ({ ...current, protocol: 'imap', port: 993, serversEdited: true }))} /><ProtocolButton value="pop3" active={mailForm?.protocol === 'pop3'} onPress={() => setMailForm((current) => current && ({ ...current, protocol: 'pop3', port: 995, serversEdited: true }))} /></View>
          <View style={styles.serverRow}><View style={styles.serverHost}><Field label="Server" placeholder={mailForm?.protocol === 'pop3' ? 'pop.example.com' : 'imap.example.com'} value={mailForm?.host ?? ''} onChangeText={(host) => setMailForm((current) => current && ({ ...current, host, serversEdited: true }))} autoCapitalize="none" /></View><View style={styles.port}><Field label="Port" value={String(mailForm?.port ?? '')} onChangeText={(port) => setMailForm((current) => current && ({ ...current, port: Number(port) || 0, serversEdited: true }))} keyboardType="number-pad" /></View></View>
          <View style={styles.secureRow}><View style={styles.connectionCopy}><Text style={styles.fieldLabel}>Send email from Open Media (SMTP)</Text><Text style={styles.connectionStatus}>Reply to email right from Messages. Uses the same username and password.</Text></View><Switch accessibilityLabel="Send email with SMTP" value={mailForm?.sendEnabled ?? true} onValueChange={(sendEnabled) => setMailForm((current) => current && ({ ...current, sendEnabled }))} /></View>
          {mailForm?.sendEnabled ? <>
            <View style={styles.serverRow}><View style={styles.serverHost}><Field label="Outgoing server" placeholder="smtp.example.com" value={mailForm.smtpHost} onChangeText={(smtpHost) => setMailForm((current) => current && ({ ...current, smtpHost, serversEdited: true }))} autoCapitalize="none" /></View><View style={styles.port}><Field label="Port" value={String(mailForm.smtpPort || '')} onChangeText={(port) => setMailForm((current) => current && ({ ...current, smtpPort: Number(port) || 0, serversEdited: true }))} keyboardType="number-pad" /></View></View>
            <View style={[styles.protocolRow, styles.field]}>{(['starttls', 'tls'] as const).map((security) => <Pressable key={security} accessibilityRole="radio" accessibilityState={{ checked: mailForm.smtpSecurity === security }} onPress={() => setMailForm((current) => current && ({ ...current, smtpSecurity: security, smtpPort: defaultSmtpPort(security), serversEdited: true }))} style={[styles.protocolButton, mailForm.smtpSecurity === security && styles.protocolButtonActive]}><Text style={[styles.protocolText, mailForm.smtpSecurity === security && styles.protocolTextActive]}>{security === 'starttls' ? 'STARTTLS (587)' : 'TLS (465)'}</Text></Pressable>)}</View>
          </> : null}
          <View style={styles.secureRow}><View><Text style={styles.fieldLabel}>Encrypted connection</Text><Text style={styles.connectionStatus}>TLS is required and cannot be disabled</Text></View><Switch accessibilityLabel="Encrypted connection required" disabled value /></View>
          </ScrollView>
          {mailError ? <Text accessibilityRole="alert" style={styles.error}>{mailError}</Text> : null}
          <Pressable disabled={mailBusy} onPress={submitMail} style={styles.primaryButton}>{mailBusy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryButtonText}>{mailForm?.sendEnabled ? 'Test incoming & outgoing, then connect' : 'Test & connect'}</Text>}</Pressable>
          <Pressable disabled={mailBusy} onPress={() => { setMailForm(undefined); setMailError(''); }} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

function SectionTitle({ title, copy }: { title: string; copy: string }) { return <View style={styles.intro}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionCopy}>{copy}</Text></View>; }
function IconButton({ label, icon, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}><Ionicons name={icon} size={22} color={colors.textSecondary} /></Pressable>; }
function ConnectionRow({ icon, color, title, detail, connected, disabled, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; detail: string; connected?: boolean; disabled?: boolean; onPress?: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={styles.connectionRow}><View style={[styles.providerIcon, { backgroundColor: color }]}><Ionicons name={icon} size={19} color={colors.surface} /></View><View style={styles.connectionCopy}><Text style={styles.connectionName}>{title}</Text><Text style={[styles.connectionStatus, connected && styles.activeText]}>{connected ? 'Connected · ' : ''}{detail}</Text></View><Ionicons name={disabled ? 'lock-closed-outline' : 'chevron-forward'} size={18} color={colors.textTertiary} /></Pressable>; }
function ProtocolButton({ value, active, onPress }: { value: MailProtocol; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.protocolButton, active && styles.protocolButtonActive]}><Text style={[styles.protocolText, active && styles.protocolTextActive]}>{value === 'imap' ? 'IMAP sync' : 'POP import'}</Text></Pressable>; }
function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { const { label, ...inputProps } = props; return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...inputProps} placeholderTextColor={colors.textTertiary} style={styles.input} /></View>; }

const styles = StyleSheet.create({
  panel: { flex: 1, minWidth: 0, backgroundColor: colors.surfaceAlt }, header: { minHeight: 82, paddingHorizontal: 22, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }, headerLeading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, eyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.4, fontWeight: '800' }, title: { color: colors.text, fontSize: 24, fontWeight: '700' }, iconButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 42 }, intro: { marginBottom: 14 }, sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' }, sectionCopy: { marginTop: 6, color: colors.textSecondary, fontSize: 13, lineHeight: 19 }, sectionGap: { height: 30 },
  card: { overflow: 'hidden', borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, disabledCard: { opacity: 0.58 }, divider: { height: 1, marginLeft: 67, backgroundColor: colors.border }, connectionRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 13 }, providerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, connectionCopy: { flex: 1 }, connectionName: { color: colors.text, fontSize: 14, fontWeight: '600' }, connectionStatus: { marginTop: 3, color: colors.textTertiary, fontSize: 11 }, activeText: { color: colors.success, fontWeight: '600' },
  note: { marginTop: 13, flexDirection: 'row', gap: 9, padding: 13, borderRadius: radii.medium, backgroundColor: colors.chrome }, noteText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 }, error: { marginTop: 10, color: '#B42318', fontSize: 11, lineHeight: 16 }, suggestionCard: { marginTop: 9, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, suggestionCopy: { flex: 1 }, reviewButton: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.accentSoft }, reviewButtonText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  mailAccountCard: { marginTop: 9, minHeight: 64, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, mailAction: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.accentSoft }, mailActionText: { color: colors.accent, fontSize: 11, fontWeight: '700' }, disconnectAction: { backgroundColor: '#FFF0EE' }, disconnectText: { color: '#B42318', fontSize: 11, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,22,26,0.34)' }, mailCard: { width: '100%', maxWidth: 620, maxHeight: '94%', alignSelf: 'center', padding: 22, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface }, modalTitle: { marginBottom: 16, color: colors.text, fontSize: 20, fontWeight: '700' }, protocolRow: { marginBottom: 10, flexDirection: 'row', gap: 8 }, protocolButton: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, protocolButtonActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent }, protocolText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, protocolTextActive: { color: colors.accent }, field: { marginTop: 10 }, fieldLabel: { marginBottom: 5, color: colors.textSecondary, fontSize: 10, fontWeight: '600' }, input: { height: 43, paddingHorizontal: 12, color: colors.text, fontSize: 13, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }, serverRow: { flexDirection: 'row', gap: 9 }, serverHost: { flex: 1 }, port: { width: 85 }, secureRow: { marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, primaryButton: { marginTop: 18, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: colors.accent }, primaryButtonText: { color: colors.surface, fontSize: 14, fontWeight: '700' }, cancelButton: { alignItems: 'center', paddingVertical: 12 }, cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' }, groupLabel: { marginTop: 16 },
});
