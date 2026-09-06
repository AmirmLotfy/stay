'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  HouseholdProfile,
  NotificationPreference,
  Permission,
  CircleMember,
  SafetyWindow,
  HelpRequest,
  Incident,
} from '@stay/contracts';
import {
  beginSignIn,
  completeSignIn,
  getAuthenticatedSession,
  signOut,
  type StayRuntimeConfig,
} from './auth';
import { residentDateTimeToUtc } from '@stay/domain';
import { connectDemoUpdates } from './demo-api';

type Preference = NotificationPreference;
type Session = {
  subject: string;
  role: string;
  circleMemberId?: string;
  permissions: Permission[];
};
type View = {
  profile: HouseholdProfile;
  preferences: Preference;
  session: Session;
  circle: CircleMember[];
  windows: SafetyWindow[];
  help: HelpRequest[];
  incidents: Incident[];
};

export function PilotApp({ config }: { config: StayRuntimeConfig }) {
  const [view, setView] = useState<View | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Sign in with the invitation from your STAY operator.');
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<'today' | 'settings'>('today');
  const request = useCallback(
    async <T,>(group: string, body?: Record<string, unknown>): Promise<T> => {
      const session = await getAuthenticatedSession(config);
      if (!session) {
        setView(null);
        setSignedIn(false);
        throw new Error('Your session ended. Sign in again.');
      }
      let pendingKey: string | undefined;
      let commandKey: string | undefined;
      if (body) {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify({ group, body })),
        );
        pendingKey = `stay.pending-command.${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        commandKey = sessionStorage.getItem(pendingKey) ?? crypto.randomUUID();
        sessionStorage.setItem(pendingKey, commandKey);
      }
      const result = await fetch(`${config.apiUrl}/v1/${group}`, {
        method: body ? 'POST' : 'GET',
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          ...(body ? { 'content-type': 'application/json', 'idempotency-key': commandKey! } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await result.json();
      if (pendingKey && (result.ok || (result.status >= 400 && result.status < 500)))
        sessionStorage.removeItem(pendingKey);
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) setView(null);
        throw new Error(
          json.message ?? 'The update could not be saved. Refresh before trying again.',
        );
      }
      return (body ? json.entity : json.data) as T;
    },
    [config],
  );
  const refresh = useCallback(async () => {
    const session = await request<Session>('session');
    const [profile, preferences, circle, windows, help, incidents] = await Promise.all([
      request<HouseholdProfile>('profile'),
      request<Preference>('notification-preferences'),
      request<CircleMember[]>('circle'),
      request<SafetyWindow[]>('safety-windows'),
      request<HelpRequest[]>('help-requests'),
      session.permissions.includes('incident:read')
        ? request<Incident[]>('incidents')
        : Promise.resolve([]),
    ]);
    setView({ session, profile, preferences, circle, windows, help, incidents });
    setSignedIn(true);
  }, [request]);
  useEffect(() => {
    let cancelled = false;
    void completeSignIn(config)
      .then(async (ok) => {
        if (ok && !cancelled) {
          await refresh();
          setNotice('Your household is up to date.');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Sign-in failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [config, refresh]);
  useEffect(() => {
    if (!signedIn) return;
    let disconnect: (() => void) | undefined;
    let cancelled = false;
    const reconcile = () => {
      void refresh()
        .then(() => setNotice('Updates reconnected. Your household is up to date.'))
        .catch((e) => setError(e instanceof Error ? e.message : 'Updates unavailable.'));
    };
    void getAuthenticatedSession(config).then((session) => {
      if (session && !cancelled) disconnect = connectDemoUpdates(config, session, reconcile);
    });
    const offline = () => {
      setError('You are offline. Actions need a connection; no request has been sent.');
    };
    window.addEventListener('online', reconcile);
    window.addEventListener('offline', offline);
    const timer = window.setInterval(reconcile, 60_000);
    return () => {
      cancelled = true;
      disconnect?.();
      window.clearInterval(timer);
      window.removeEventListener('online', reconcile);
      window.removeEventListener('offline', offline);
    };
  }, [config, signedIn, refresh]);
  const run = async (group: string, body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await request(group, body);
      await refresh();
      setNotice(
        group === 'notification-preferences'
          ? 'Your email preference is saved.'
          : group === 'profile'
            ? 'Your profile is saved.'
            : 'Saved. Your Circle sees the same update.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action did not complete.');
    } finally {
      setBusy(false);
    }
  };
  const submit = (
    event: FormEvent<HTMLFormElement>,
    group: string,
    values: (form: FormData) => Record<string, unknown>,
  ) => {
    event.preventDefault();
    try {
      void run(group, values(new FormData(event.currentTarget)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the form values.');
    }
  };
  const can = (permission: Permission) => Boolean(view?.session.permissions.includes(permission));
  return (
    <main className="pilot-shell" id="main-content">
      <a href="#pilot-content" className="skip-link">
        Skip to household
      </a>
      <header className="pilot-header">
        <div>
          <p className="eyebrow">STAY · private pilot</p>
          <h1>{view ? `${view.profile.firstName}’s home` : 'Welcome home'}</h1>
        </div>
        {signedIn ? (
          <button
            onClick={() =>
              void signOut(config).catch(() =>
                setError('Sign-out could not finish. Close this tab.'),
              )
            }
          >
            Sign out
          </button>
        ) : (
          <button onClick={() => void beginSignIn(config)}>Sign in</button>
        )}
      </header>
      <p>
        STAY helps your trusted Circle coordinate. It does not contact emergency services or provide
        emergency monitoring.
      </p>
      <p role="status" aria-live="polite">
        {notice}
      </p>
      {error && (
        <p role="alert" className="pilot-error">
          {error}
        </p>
      )}
      {!view ? (
        <section id="pilot-content" tabIndex={-1}>
          <h2>Your invitation is personal</h2>
          <p>
            Your operator sets up your household and verifies each Circle member. Public signup is
            closed.
          </p>
          {signedIn && (
            <button onClick={() => void refresh().catch((e) => setError(e.message))}>
              Reconnect to my household
            </button>
          )}
        </section>
      ) : (
        <>
          <nav aria-label="Household">
            <button
              aria-current={section === 'today' ? 'page' : undefined}
              onClick={() => setSection('today')}
            >
              Today
            </button>
            <button
              aria-current={section === 'settings' ? 'page' : undefined}
              onClick={() => setSection('settings')}
            >
              Profile and email
            </button>
            <button
              disabled={busy}
              onClick={() => void refresh().catch((e) => setError(e.message))}
            >
              Refresh
            </button>
          </nav>
          <div id="pilot-content" tabIndex={-1} aria-busy={busy}>
            {section === 'settings' ? (
              <>
                <section>
                  <h2>Resident profile</h2>
                  <form
                    onSubmit={(e) =>
                      submit(e, 'profile', (f) => ({
                        action: 'update',
                        expectedVersion: view.profile.version,
                        name: f.get('name'),
                        firstName: f.get('firstName'),
                        timezone: f.get('timezone'),
                      }))
                    }
                  >
                    <fieldset disabled={busy || view.session.role !== 'resident'}>
                      <label>
                        Full name
                        <input
                          name="name"
                          key={`name-${view.profile.version}`}
                          autoComplete="name"
                          required
                          maxLength={120}
                          defaultValue={view.profile.name}
                        />
                      </label>
                      <label>
                        Name used at home
                        <input
                          name="firstName"
                          key={`first-${view.profile.version}`}
                          required
                          maxLength={80}
                          defaultValue={view.profile.firstName}
                        />
                      </label>
                      <label>
                        Home time zone
                        <input
                          name="timezone"
                          key={`zone-${view.profile.version}`}
                          required
                          defaultValue={view.profile.timezone}
                          aria-describedby="timezone-help"
                        />
                      </label>
                      <p id="timezone-help">
                        Use your home’s IANA time zone, such as Africa/Cairo. Existing scheduled
                        checks keep their saved time.
                      </p>
                      <button type="submit">Save profile</button>
                    </fieldset>
                  </form>
                </section>
                <section>
                  <h2>Your email updates</h2>
                  <p>
                    Receive a neutral sign-in prompt when your household has a coordination update.
                    Sensitive details stay inside STAY.
                  </p>
                  <form
                    onSubmit={(e) =>
                      submit(e, 'notification-preferences', (f) => ({
                        action: 'update',
                        expectedVersion: view.preferences.version,
                        enabled: f.get('enabled') === 'on',
                      }))
                    }
                  >
                    <fieldset disabled={busy || view.preferences.suppression !== 'none'}>
                      <label className="pilot-checkbox">
                        <input
                          key={`${view.preferences.version}`}
                          type="checkbox"
                          name="enabled"
                          defaultChecked={view.preferences.enabled}
                        />
                        I want household updates at my verified email address.
                      </label>
                      <button type="submit">Save email preference</button>
                    </fieldset>
                  </form>
                  {view.preferences.suppression !== 'none' && (
                    <p>
                      Email is suppressed. Ask your operator to review the address before enabling
                      it.
                    </p>
                  )}
                  <p>
                    Contact your operator to change your email address, export your information, or
                    leave the pilot.
                  </p>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h2>Your Circle</h2>
                  {!view.circle.length ? (
                    <p>Your operator can help invite your first trusted helper.</p>
                  ) : (
                    <ul>
                      {view.circle.map((member) => (
                        <li key={member.id}>
                          {member.name} · {member.availability}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h2>Safety Windows</h2>
                  {!view.windows.length && (
                    <p>
                      No checks are scheduled. Choose a time and a Circle order together with your
                      operator.
                    </p>
                  )}
                  {view.windows.map((window) => (
                    <article key={window.id}>
                      <h3>{window.title}</h3>
                      <p>
                        {new Date(window.expectedBy).toLocaleString('en', {
                          timeZone: view.profile.timezone,
                        })}{' '}
                        · {window.state}
                      </p>
                      {can('safety-window:manage') &&
                        ['open', 'first-check-missed', 'grace'].includes(window.state) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run('safety-windows', {
                                action: 'check-in',
                                entityId: window.id,
                                expectedVersion: window.version,
                              })
                            }
                          >
                            Check in for {window.title}
                          </button>
                        )}
                    </article>
                  ))}
                  {can('safety-window:manage') && view.circle.length > 0 && (
                    <form
                      onSubmit={(e) =>
                        submit(e, 'safety-windows', (f) => ({
                          action: 'create',
                          title: f.get('title'),
                          template: 'custom',
                          startsAt: residentDateTimeToUtc(
                            String(f.get('startsAt')),
                            view.profile.timezone,
                          ),
                          expectedBy: residentDateTimeToUtc(
                            String(f.get('expectedBy')),
                            view.profile.timezone,
                          ),
                          graceMinutes: 10,
                          escalationMemberIds: f.getAll('members'),
                        }))
                      }
                    >
                      <fieldset disabled={busy}>
                        <legend>Schedule a check</legend>
                        <label>
                          Title
                          <input name="title" required maxLength={120} />
                        </label>
                        <label>
                          Starts at ({view.profile.timezone})
                          <input name="startsAt" type="datetime-local" required />
                        </label>
                        <label>
                          Check in by ({view.profile.timezone})
                          <input name="expectedBy" type="datetime-local" required />
                        </label>
                        <p>
                          Choose the saved Circle order. Two missed checks, ten minutes apart,
                          prepare coordination with this Circle.
                        </p>
                        {[...view.circle]
                          .sort((a, b) => a.priority - b.priority)
                          .map((m) => (
                            <label className="pilot-checkbox" key={m.id}>
                              <input name="members" value={m.id} type="checkbox" /> {m.name}
                            </label>
                          ))}
                        <button type="submit">Schedule Safety Window</button>
                      </fieldset>
                    </form>
                  )}
                </section>
                <section>
                  <h2>Help Board</h2>
                  {!view.help.length && (
                    <p>No open requests. Ask your Circle for an ordinary favor.</p>
                  )}
                  {view.help.map((help) => (
                    <article key={help.id}>
                      <h3>{help.title}</h3>
                      <p>{help.detail}</p>
                      <p>{help.state}</p>
                      {view.session.circleMemberId && help.state === 'open' && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run('help-requests', {
                              action: 'accept',
                              entityId: help.id,
                              expectedVersion: help.version,
                              memberId: view.session.circleMemberId,
                            })
                          }
                        >
                          I can help with {help.title}
                        </button>
                      )}
                    </article>
                  ))}
                  {can('help:request') && (
                    <form
                      onSubmit={(e) =>
                        submit(e, 'help-requests', (f) => ({
                          action: 'create',
                          title: f.get('title'),
                          detail: f.get('detail'),
                          urgency: 'normal',
                        }))
                      }
                    >
                      <fieldset disabled={busy}>
                        <legend>Ask your Circle</legend>
                        <label>
                          What would help?
                          <input name="title" required maxLength={120} />
                        </label>
                        <label>
                          Details
                          <textarea name="detail" required maxLength={500} />
                        </label>
                        <button type="submit">Ask for help</button>
                      </fieldset>
                    </form>
                  )}
                </section>
                <section>
                  <h2>Coordination</h2>
                  {!view.incidents.length && <p>No active incidents.</p>}
                  {view.incidents.map((incident) => (
                    <article key={incident.id}>
                      <h3>{incident.title}</h3>
                      <p>{incident.state}</p>
                      <ul>
                        {incident.timeline.map((item) => (
                          <li key={item.id}>
                            {item.title} · {item.detail}
                          </li>
                        ))}
                      </ul>
                      {can('incident:coordinate') &&
                        ['active', 'coordinating'].includes(incident.state) &&
                        view.circle.map((member) => (
                          <button
                            key={member.id}
                            disabled={busy}
                            onClick={() =>
                              void run('incidents', {
                                action: 'ask-responder',
                                entityId: incident.id,
                                expectedVersion: incident.version,
                                memberId: member.id,
                              })
                            }
                          >
                            Ask {member.name}
                          </button>
                        ))}
                      {can('incident:coordinate') &&
                        view.session.circleMemberId &&
                        ['active', 'coordinating'].includes(incident.state) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run('incidents', {
                                action: 'accept',
                                entityId: incident.id,
                                expectedVersion: incident.version,
                                memberId: view.session.circleMemberId,
                              })
                            }
                          >
                            I’m on the way
                          </button>
                        )}
                      {can('incident:resolve') && incident.state === 'responding' && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run('incidents', {
                              action: 'resolve',
                              entityId: incident.id,
                              expectedVersion: incident.version,
                            })
                          }
                        >
                          Resolve incident
                        </button>
                      )}
                    </article>
                  ))}
                </section>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
