import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { AlertTriangle, Check, ChevronDown, ExternalLink, Loader2, LogOut, Smartphone, Trash2, Zap } from 'lucide-react';
import {
  SERVICE_INFO,
  validateClientId,
  validateClientSecret,
  validateRedirectUri,
  validateScopes,
  type ConnectionProblem,
  type MusicService,
  type ServiceConnection,
  type TestConnectionResult,
} from '@headunit/shared';
import { beginLogin, formatDate, hintOf, pasteLogin, saveConnection, signOut, statusOf, testConnection, timeAgo } from '../../lib/connections';
import { useHeadUnit } from '../../store';
import { CopyButton } from '../CopyButton';
import { DrivingGate } from '../ui';
import { QrCode } from '../QrCode';

const messageOf = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.');

/** Phone keyboards must not "fix" an ID: no capital letters, no autocorrect, no red squiggles. */
const RAW_TEXT = { autoCapitalize: 'off', autoCorrect: 'off', autoComplete: 'off', spellCheck: false, inputMode: 'text' } as const;

type Busy = null | 'save' | 'phone' | 'finish' | 'test' | 'out' | 'forget' | 'redirect' | 'scopes';

const PROBLEMS: Record<ConnectionProblem, { title: (label: string) => string; body: (label: string, service: MusicService) => string }> = {
  'login-expired': {
    title: () => 'Your sign-in expired',
    body: (label) => `${label} signed you out. Sign in again to carry on.`,
  },
  permissions: {
    title: () => 'More permissions are needed',
    body: () => 'You are signed in, but the app was not allowed to do everything it needs. Sign in again and approve every permission it asks for.',
  },
  rejected: {
    title: (label) => `${label} rejected this app`,
    body: (_label, service) =>
      `${service === 'tidal' ? 'The Client ID, the Client Secret or the Redirect URI' : 'The Client ID or the Redirect URI'} does not match your developer app. Check steps 2 and 3 below, then use Test connection.`,
  },
};

function Step({ n, title, done, stepRef, children }: { n: number; title: string; done?: boolean; stepRef?: Ref<HTMLLIElement>; children: ReactNode }) {
  return (
    <li className="svc-step" data-done={done || undefined} ref={stepRef}>
      <span className="svc-num" aria-hidden="true">
        {done ? <Check size={16} /> : n}
      </span>
      <div className="svc-step-body">
        <h4>{title}</h4>
        {children}
      </div>
    </li>
  );
}

function Pill({ conn }: { conn: ServiceConnection }) {
  const s = statusOf(conn);
  return (
    <span className="svc-pill" data-tone={s.tone}>
      {s.label}
    </span>
  );
}

interface CardProps {
  conn: ServiceConnection;
  /** Called after any change, with the fresh state where the server returned one; the parent should show it and reload. */
  onChanged(conn?: ServiceConnection): void;
  /** Wrap the card in a <details> that can be folded away (Settings). Without it the card is always open (sheets). */
  collapsible?: boolean;
  defaultOpen?: boolean;
}

/** Everything needed to connect one music service: the steps, the Client ID, signing in (here or from a phone), testing, signing out. */
export function ServiceCard({ conn, onChanged, collapsible = false, defaultOpen = false }: CardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = statusOf(conn).tone;
  const head = (
    <>
      <span className="svc-title">
        <b>{conn.label}</b>
        <span className="svc-sub">{hintOf(conn)}</span>
      </span>
      <Pill conn={conn} />
    </>
  );

  if (!collapsible) {
    return (
      <section className="svc" data-tone={tone} aria-label={`${conn.label} setup`}>
        <div className="svc-head">{head}</div>
        <CardBody conn={conn} onChanged={onChanged} />
      </section>
    );
  }
  return (
    <details className="svc" data-tone={tone} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="svc-head">
        {head}
        <ChevronDown className="svc-chev" size={22} aria-hidden="true" />
      </summary>
      <CardBody conn={conn} onChanged={onChanged} />
    </details>
  );
}

function CardBody({ conn, onChanged }: { conn: ServiceConnection; onChanged(conn?: ServiceConnection): void }) {
  const service = conn.service;
  const label = conn.label;
  const info = SERVICE_INFO[service];
  const tidal = service === 'tidal';
  const toast = useHeadUnit((s) => s.showToast);

  const [busy, setBusy] = useState<Busy>(null);
  const working = busy !== null;

  // Client ID (+ Client Secret for TIDAL): step 3 for Spotify, step 2 for TIDAL
  const [editingId, setEditingId] = useState(false);
  const [idText, setIdText] = useState(conn.configured ? '' : conn.clientId);
  const [secretText, setSecretText] = useState('');
  const [idError, setIdError] = useState('');
  const [secretError, setSecretError] = useState('');
  const idStep = useRef<HTMLLIElement>(null);
  const showIdInput = !conn.configured || editingId;

  // Signing in: step 4 for Spotify; for TIDAL it is the optional last step
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [loginError, setLoginError] = useState('');
  const [pasteError, setPasteError] = useState('');

  // Footer
  const [test, setTest] = useState<TestConnectionResult | null>(null);
  const [confirm, setConfirm] = useState<'out' | 'forget' | null>(null);
  const [actionError, setActionError] = useState('');

  // Advanced
  const [redirectText, setRedirectText] = useState(conn.redirectUri);
  const [scopesText, setScopesText] = useState(conn.requestedScopes ?? '');
  const [advError, setAdvError] = useState('');
  useEffect(() => setRedirectText(conn.redirectUri), [conn.redirectUri]);
  useEffect(() => setScopesText(conn.requestedScopes ?? ''), [conn.requestedScopes]);

  // Close the phone panel when a new sign-in lands (approved elsewhere, or by pasting).
  const signIn = `${conn.connected}:${conn.connectedAt ?? ''}`;
  const lastSignIn = useRef(signIn);
  useEffect(() => {
    if (lastSignIn.current === signIn) return;
    lastSignIn.current = signIn;
    setPhoneUrl(null);
    setPasteText('');
    setPasteError('');
  }, [signIn]);

  // A "tap again" confirmation lapses on its own.
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(null), 5000);
    return () => window.clearTimeout(t);
  }, [confirm]);

  const saveId = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateClientId(service, idText);
    if (!v.ok) return setIdError(v.error);
    setIdError('');
    let clientSecret: string | undefined;
    if (tidal) {
      const secret = validateClientSecret(service, secretText);
      if (!secret.ok) return setSecretError(secret.error);
      clientSecret = secret.value;
    }
    setSecretError('');
    setBusy('save');
    try {
      const next = await saveConnection(service, { clientId: v.value, ...(clientSecret ? { clientSecret } : {}) });
      setEditingId(false);
      setIdText('');
      setSecretText('');
      setTest(null);
      setPhoneUrl(null);
      onChanged(next);
      toast(tidal ? 'TIDAL developer credentials saved' : 'Client ID saved');
    } catch (err) {
      setIdError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  const startPhone = async () => {
    setLoginError('');
    setPasteError('');
    setBusy('phone');
    try {
      setPhoneUrl(await beginLogin(service));
      setPasteText('');
      onChanged();
    } catch (err) {
      setLoginError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  const finishPhone = async (e: FormEvent) => {
    e.preventDefault();
    setPasteError('');
    setBusy('finish');
    try {
      const next = await pasteLogin(service, pasteText);
      setPhoneUrl(null);
      setPasteText('');
      onChanged(next);
      toast(next.connected ? `Signed in to ${label}` : 'Sign-in saved');
    } catch (err) {
      setPasteError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setActionError('');
    setTest(null);
    setBusy('test');
    try {
      setTest(await testConnection(service));
    } catch (err) {
      setTest({ ok: false, message: messageOf(err) });
    } finally {
      setBusy(null);
    }
  };

  const leave = async (forget: boolean) => {
    if (confirm !== (forget ? 'forget' : 'out')) return setConfirm(forget ? 'forget' : 'out');
    setConfirm(null);
    setActionError('');
    setBusy(forget ? 'forget' : 'out');
    try {
      const next = await signOut(service, forget);
      setTest(null);
      setPhoneUrl(null);
      setPasteText('');
      if (forget) {
        setEditingId(false);
        setIdText('');
        setSecretText('');
        setSecretError('');
      }
      onChanged(next);
      toast(forget ? `${label} developer credentials forgotten` : `Signed out of ${label}`);
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  /** Advanced settings are saved together with the Client ID that is already saved (the server needs it in every save). */
  const saveAdvanced = async (which: 'redirect' | 'scopes', e?: FormEvent, reset = false) => {
    e?.preventDefault();
    setAdvError('');
    const body: { clientId: string; redirectUri?: string | null; scopes?: string | null } = { clientId: conn.clientId };
    if (which === 'redirect') {
      if (reset) body.redirectUri = null;
      else {
        const v = validateRedirectUri(service, redirectText);
        if (!v.ok) return setAdvError(v.error);
        body.redirectUri = v.value;
      }
    } else {
      const v = validateScopes(scopesText);
      if (!v.ok) return setAdvError(v.error);
      body.scopes = v.value === '' ? null : v.value;
    }
    setBusy(which);
    try {
      const next = await saveConnection(service, body);
      setTest(null);
      onChanged(next);
      toast(reset ? 'Redirect URI reset to the default' : 'Saved');
    } catch (err) {
      setAdvError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  const checkClientId = () => {
    setIdText(conn.clientId);
    setSecretText('');
    setEditingId(true);
    window.setTimeout(() => idStep.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 50);
  };

  const problem = conn.problem ? PROBLEMS[conn.problem] : null;
  const loginHref = `/auth/${service}/login`;
  const expiryLine =
    conn.loginExpiresAt === undefined
      ? null
      : service === 'spotify'
        ? `Spotify sign-ins last about six months — due around ${formatDate(conn.loginExpiresAt)}.`
        : `This sign-in is expected to last until around ${formatDate(conn.loginExpiresAt)}.`;

  return (
    <div className="svc-body">
      {problem && (
        <div className="notice warn svc-banner" data-problem={conn.problem}>
          <AlertTriangle size={20} aria-hidden="true" />
          <div className="svc-banner-text">
            <b>{problem.title(label)}</b>
            <span>{conn.message ?? problem.body(label, service)}</span>
          </div>
          {conn.problem === 'rejected' ? (
            <button type="button" className="btn small" onClick={checkClientId}>
              Check Client ID
            </button>
          ) : (
            conn.available && (
              <a className="btn small primary" href={loginHref}>
                Sign in again
              </a>
            )
          )}
        </div>
      )}
      {!problem && conn.message && <div className="notice">{conn.message}</div>}

      <ol className="svc-steps">
        <Step n={1} title="Create an app">
          <p>
            Open the {label} developer dashboard, sign in and create an app. Any name will do.
            {service === 'spotify' && ' If it asks which APIs you plan to use, tick “Web API”.'}
            {tidal && ' TIDAL shows the app’s Client ID and Client Secret on its page.'}
          </p>
          <div className="copy-row">
            <code className="copy-box">{info.dashboardUrl}</code>
            <CopyButton text={info.dashboardUrl} what="dashboard address" />
            {/* A new window inside the chrome-less kiosk has no way back, so it is hidden there (html.kiosk .svc-open); Copy stays. */}
            <a className="btn small svc-open" href={info.dashboardUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Open
            </a>
          </div>
        </Step>

        {!tidal && (
          <Step n={2} title="Add this Redirect URI">
            <p>In your app’s settings, add this address as a Redirect URI and save. It has to match exactly — every letter and slash.</p>
            <div className="copy-row">
              <code className="copy-box">{conn.redirectUri}</code>
              <CopyButton text={conn.redirectUri} what="Redirect URI" />
            </div>
          </Step>
        )}

        <Step n={tidal ? 2 : 3} title={tidal ? 'Paste Client ID + Client Secret' : 'Paste your Client ID'} done={conn.configured && !editingId} stepRef={idStep}>
          {!showIdInput ? (
            <>
              <div className="copy-row">
                <code className="copy-box" aria-label="Saved Client ID">
                  {conn.clientId}
                </code>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setIdText(conn.clientId);
                    setSecretText('');
                    setEditingId(true);
                  }}
                >
                  Change
                </button>
              </div>
              {conn.clientIdSource === 'env' && (
                <div className="dim small">This one is set in the head unit’s environment settings. Saving a different one here replaces it.</div>
              )}
              {tidal && conn.clientSecretConfigured && (
                <div className="svc-reassure">Client Secret saved securely on the head unit{conn.clientSecretSource === 'env' ? ' from environment settings' : ''}. It is never returned to this browser.</div>
              )}
            </>
          ) : (
            <>
              <p>
                {tidal
                  ? 'Copy both the Client ID and Client Secret from your TIDAL developer app. The catalog/search API uses these app credentials.'
                  : 'Copy the Client ID from your app’s page in the dashboard and paste it here.'}
              </p>
              <DrivingGate what={tidal ? 'Entering your Client ID and Client Secret' : 'Entering your Client ID'}>
                <form className="svc-form" onSubmit={(e) => void saveId(e)}>
                  <input
                    className="svc-input"
                    value={idText}
                    onChange={(e) => {
                      setIdText(e.target.value);
                      setIdError('');
                    }}
                    placeholder="Paste your Client ID"
                    aria-label={`${label} Client ID`}
                    aria-invalid={idError !== ''}
                    autoFocus={editingId}
                    {...RAW_TEXT}
                  />
                  {tidal && (
                    <input
                      className="svc-input"
                      type="password"
                      value={secretText}
                      onChange={(e) => {
                        setSecretText(e.target.value);
                        setSecretError('');
                      }}
                      placeholder="Paste your Client Secret"
                      aria-label="TIDAL Client Secret"
                      aria-invalid={secretError !== ''}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  )}
                  <button type="submit" className="btn primary" disabled={working || idText.trim() === '' || (tidal && secretText.trim() === '')}>
                    {busy === 'save' && <Loader2 size={18} className="spin" />} Save
                  </button>
                  {conn.configured && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setEditingId(false);
                        setIdText('');
                        setIdError('');
                        setSecretText('');
                        setSecretError('');
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </form>
              </DrivingGate>
              {idError && (
                <div className="svc-error" role="alert">
                  {idError}
                </div>
              )}
              {secretError && (
                <div className="svc-error" role="alert">
                  {secretError}
                </div>
              )}
              <div className="dim small">{info.clientIdHint}</div>
              {conn.connected && editingId && <div className="dim small">Changing the Client ID signs you out — a sign-in belongs to one Client ID.</div>}
            </>
          )}
          <div className="svc-reassure">
            {tidal
              ? 'TIDAL catalog access uses Client Credentials. The Client Secret is stored server-side on this head unit and is never returned by the settings API.'
              : 'You do not need the Client secret — this app never asks for it.'}
          </div>
        </Step>

        {conn.available ? (
          <Step n={tidal ? 3 : 4} title={tidal ? 'Optional: sign in to your TIDAL account' : 'Sign in'} done={conn.connected}>
            {!conn.configured ? (
              <p className="dim">{tidal ? 'Save your Client ID and Client Secret first (step 2). Search and playback do not need a sign-in.' : 'Save your Client ID first (step 3), then sign in.'}</p>
            ) : tidal ? (
              <p>Search and playback already work. Signing in is optional and is only used for account features TIDAL permits third-party apps to access.</p>
            ) : (
              <p>Approve access once and the head unit stays signed in. If signing in with your phone, use the phone option below: 127.0.0.1 points to the phone, not the Pi.</p>
            )}
            {tidal && (
              <>
                <p>To sign in, first add this address as a Redirect URI in your TIDAL app’s settings and save. It has to match exactly — every letter and slash.</p>
                <div className="copy-row">
                  <code className="copy-box">{conn.redirectUri}</code>
                  <CopyButton text={conn.redirectUri} what="Redirect URI" />
                </div>
              </>
            )}
            {conn.connected && (
              <div className="svc-meta">
                <span>{conn.connectedAt ? `Signed in ${timeAgo(conn.connectedAt)}.` : 'Signed in.'}</span>
                {expiryLine && <span>{expiryLine}</span>}
              </div>
            )}
            <div className="svc-actions">
              {conn.configured ? (
                <a className={conn.connected ? 'btn' : 'btn primary'} href={loginHref}>
                  Sign in on this screen
                </a>
              ) : (
                <button type="button" className="btn primary" disabled>
                  Sign in on this screen
                </button>
              )}
              <button type="button" className="btn" disabled={!conn.configured || working} onClick={() => void startPhone()}>
                {busy === 'phone' ? <Loader2 size={18} className="spin" /> : <Smartphone size={18} />} Sign in with your phone
              </button>
            </div>
            {loginError && (
              <div className="svc-error" role="alert">
                {loginError}
              </div>
            )}
            {phoneUrl && (
              <div className="svc-phone">
                <div className="svc-phone-top">
                  <div className="qr-frame">
                    <QrCode value={phoneUrl} label={`QR code to sign in to ${label}`} />
                  </div>
                  <div className="svc-phone-text">
                    <p>
                      <b>1.</b> Point your phone’s camera at the code and approve access.
                    </p>
                    <p className="dim small">No camera? Copy this address and open it in your phone’s browser:</p>
                    <div className="copy-row">
                      <div className="copy-box copy-long">{phoneUrl}</div>
                      <CopyButton text={phoneUrl} what="sign-in address" />
                    </div>
                  </div>
                </div>
                <p>
                  <b>2.</b> The 127.0.0.1 callback may fail to load on your phone — that is expected. Copy its full address (including code and state) into the box below. Never share that address with anyone else.
                </p>
                <DrivingGate what="Pasting the address">
                  <form className="svc-form" onSubmit={(e) => void finishPhone(e)}>
                    <input
                      className="svc-input"
                      value={pasteText}
                      onChange={(e) => {
                        setPasteText(e.target.value);
                        setPasteError('');
                      }}
                      placeholder="Paste the address here"
                      aria-label="Address copied from your phone"
                      {...RAW_TEXT}
                    />
                    <button type="submit" className="btn primary" disabled={working || pasteText.trim() === ''}>
                      {busy === 'finish' && <Loader2 size={18} className="spin" />} Finish sign-in
                    </button>
                  </form>
                </DrivingGate>
                {pasteError && (
                  <div className="svc-error" role="alert">
                    {pasteError}
                  </div>
                )}
              </div>
            )}
          </Step>
        ) : (
          <li className="svc-step svc-step-note">
            <span className="svc-num" aria-hidden="true">
              {tidal ? 3 : 4}
            </span>
            <div className="svc-step-body">
              <h4>{tidal ? 'Optional: sign in to your TIDAL account' : 'Sign in'}</h4>
              <div className="notice">
                Signing in to {label} is not available in this version yet. You can save your Client ID now so it is ready.
              </div>
            </div>
          </li>
        )}
      </ol>

      {conn.configured && (
        <div className="svc-foot">
          <div className="svc-actions">
            {conn.available && (
              <button type="button" className="btn" disabled={working} onClick={() => void runTest()}>
                {busy === 'test' ? <Loader2 size={18} className="spin" /> : <Zap size={18} />} Test connection
              </button>
            )}
            {conn.available && (
              <button
                type="button"
                className="btn danger"
                disabled={working || !(conn.connected || conn.loginPending || conn.problem)}
                onClick={() => void leave(false)}
              >
                {busy === 'out' ? <Loader2 size={18} className="spin" /> : <LogOut size={18} />} {confirm === 'out' ? 'Tap again to sign out' : 'Sign out'}
              </button>
            )}
            {conn.clientIdSource === 'saved' && (
              <button type="button" className="btn danger" disabled={working} onClick={() => void leave(true)}>
                {busy === 'forget' ? <Loader2 size={18} className="spin" /> : <Trash2 size={18} />} {confirm === 'forget' ? 'Tap again to forget' : service === 'tidal' ? 'Forget credentials' : 'Forget Client ID'}
              </button>
            )}
          </div>
          {confirm === 'forget' && <div className="notice warn">This removes your saved {service === 'tidal' ? 'developer credentials' : 'Client ID'} and signs you out of {label}. You can add it again any time.</div>}
          {test && (
            <div className="svc-chip" data-tone={test.ok ? 'ok' : 'bad'} role="status">
              {test.ok ? <Check size={16} /> : <AlertTriangle size={16} />}
              <span>{test.message}</span>
            </div>
          )}
          {actionError && (
            <div className="svc-error" role="alert">
              {actionError}
            </div>
          )}
        </div>
      )}

      <details className="svc-adv">
        <summary>Advanced</summary>
        {!conn.configured ? (
          <p className="dim small">Save your {service === 'tidal' ? 'developer credentials' : 'Client ID'} first, then you can change these.</p>
        ) : (
          <DrivingGate what="Changing these settings">
            <form className="svc-field" onSubmit={(e) => void saveAdvanced('redirect', e)}>
              <label htmlFor={`${service}-redirect`}>Redirect URI</label>
              <div className="dim small">
                Only change this if you registered a different address in your {label} app. It must match there exactly.
                {conn.redirectUriSource === 'env' && ' Currently set in the head unit’s environment settings; saving here replaces it.'}
              </div>
              <div className="svc-form">
                <input id={`${service}-redirect`} className="svc-input" value={redirectText} onChange={(e) => setRedirectText(e.target.value)} {...RAW_TEXT} />
                <button type="submit" className="btn" disabled={working || redirectText.trim() === ''}>
                  {busy === 'redirect' && <Loader2 size={18} className="spin" />} Save
                </button>
                {conn.redirectUriSource !== 'default' && (
                  <button type="button" className="btn" disabled={working} onClick={() => void saveAdvanced('redirect', undefined, true)}>
                    Reset to default
                  </button>
                )}
              </div>
            </form>
            {service === 'tidal' && (
              <form className="svc-field" onSubmit={(e) => void saveAdvanced('scopes', e)}>
                <label htmlFor="tidal-scopes">Permissions to ask for</label>
                <div className="dim small">Separate them with spaces. Leave it blank to use the default permissions.</div>
                <div className="svc-form">
                  <input id="tidal-scopes" className="svc-input" value={scopesText} onChange={(e) => setScopesText(e.target.value)} placeholder="Default" {...RAW_TEXT} />
                  <button type="submit" className="btn" disabled={working}>
                    {busy === 'scopes' && <Loader2 size={18} className="spin" />} Save
                  </button>
                </div>
              </form>
            )}
            {advError && (
              <div className="svc-error" role="alert">
                {advError}
              </div>
            )}
          </DrivingGate>
        )}
      </details>
    </div>
  );
}
