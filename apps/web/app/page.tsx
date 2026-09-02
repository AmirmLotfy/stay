'use client';

import type {
  AccessPreferences,
  ActorContext,
  ConfirmationPurpose,
  ConfirmationToken,
  HelpRequest,
  HouseMemoryItem,
  Incident,
  Playbook,
  SafetyWindow,
  SafetyWindowTemplate,
} from '@stay/contracts';
import {
  createDemoState,
  formatResidentDateTimeInput,
  hasExplicitEmergencyLanguage,
  residentDateTimeToUtc,
  StayEngine,
  type CreatePlaybookInput,
  type CreateSafetyWindowInput,
  type HomeState,
  type PrivacyUpdateInput,
} from '@stay/domain';
import {
  Accessibility,
  BellRing,
  BookHeart,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock3,
  CloudSun,
  Droplets,
  Eye,
  HandHeart,
  Home,
  KeyRound,
  Lightbulb,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  Mic,
  Moon,
  MoreHorizontal,
  Navigation,
  PhoneCall,
  Play,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Sun,
  ThermometerSun,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  beginSignIn,
  completeSignIn,
  hasAuthenticatedSession,
  loadRuntimeConfig,
  signOut,
  type StayRuntimeConfig,
} from './auth';
import {
  connectDemoUpdates,
  createDemoSession,
  hydrateDemoState,
  interpretDemoIntent,
  requestDemoConfirmation,
  runDemoCommand,
  type DemoSessionRecord,
} from './demo-api';

type Surface = 'home' | 'access' | 'windows' | 'circle' | 'playbooks' | 'privacy' | 'memory';
type CircleSurface = 'overview' | 'help' | 'incidents' | 'people' | 'settings';

const residentActor: ActorContext = {
  subject: 'resident-sarah',
  householdId: 'demo-household-sarah',
  residentId: 'resident-sarah',
  role: 'resident',
  correlationId: 'public-demo',
  permissions: [
    'home:read',
    'tasks:write',
    'circle:read',
    'safety-window:read',
    'safety-window:manage',
    'help:request',
    'help:respond',
    'incident:read',
    'incident:coordinate',
    'incident:resolve',
    'access:manage',
    'privacy:manage',
    'memory:read',
    'memory:manage',
    'playbook:execute',
  ],
};

const navigation: Array<{ id: Surface; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Today', icon: Home },
  { id: 'access', label: 'Access', icon: Accessibility },
  { id: 'windows', label: 'Windows', icon: Clock3 },
  { id: 'circle', label: 'Circle', icon: UsersRound },
  { id: 'playbooks', label: 'Plans', icon: BookHeart },
  { id: 'privacy', label: 'Privacy', icon: LockKeyhole },
  { id: 'memory', label: 'House Memory', icon: KeyRound },
];

const circleNavigation: Array<{ id: CircleSurface; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'help', label: 'Help Board' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'people', label: 'People' },
  { id: 'settings', label: 'Circle settings' },
];

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function residentTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value));
}

function browserDemoSession(): { id: string; expiresAt: string } {
  const key = 'stay-browser-demo-v1';
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as { id?: string; expiresAt?: string };
      if (
        typeof parsed.id === 'string' &&
        typeof parsed.expiresAt === 'string' &&
        new Date(parsed.expiresAt).getTime() > Date.now() + 60_000
      ) {
        return { id: parsed.id, expiresAt: parsed.expiresAt };
      }
    }
  } catch {
    window.localStorage.removeItem(key);
  }
  const session = {
    id: uid('browser'),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  };
  window.localStorage.setItem(key, JSON.stringify(session));
  return session;
}

function browserAccessPreferences(fallback: HomeState['access']): HomeState['access'] {
  try {
    const raw = window.localStorage.getItem('stay-access-preferences-v1');
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<HomeState['access']>;
    return {
      ...fallback,
      ...(value.interactionMode &&
      ['voice-first', 'touch-first', 'balanced'].includes(value.interactionMode)
        ? { interactionMode: value.interactionMode }
        : {}),
      ...(typeof value.reducedLoad === 'boolean' ? { reducedLoad: value.reducedLoad } : {}),
      ...(typeof value.highLegibility === 'boolean'
        ? { highLegibility: value.highLegibility }
        : {}),
      ...(typeof value.captions === 'boolean' ? { captions: value.captions } : {}),
      ...(typeof value.extraResponseTime === 'boolean'
        ? { extraResponseTime: value.extraResponseTime }
        : {}),
      ...(typeof value.repeatInformation === 'boolean'
        ? { repeatInformation: value.repeatInformation }
        : {}),
      ...(typeof value.highContrast === 'boolean' ? { highContrast: value.highContrast } : {}),
      ...(typeof value.reducedMotion === 'boolean' ? { reducedMotion: value.reducedMotion } : {}),
      ...(value.textScale && ['default', 'large', 'extra-large'].includes(value.textScale)
        ? { textScale: value.textScale }
        : {}),
    };
  } catch {
    return fallback;
  }
}

export default function StayApp() {
  const engine = useRef(new StayEngine());
  const accessUpdateQueue = useRef(Promise.resolve());
  const explicitThemePreference = useRef(false);
  const [state, setState] = useState<HomeState>(() => createDemoState());
  const [surface, setSurface] = useState<Surface>('home');
  const [circleSurface, setCircleSurface] = useState<CircleSurface>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [demoStep, setDemoStep] = useState(0);
  const [notice, setNotice] = useState('Your home is settled. Sarah is in control.');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsSeen, setNotificationsSeen] = useState(false);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const [transcript, setTranscript] = useState<Array<{ from: 'resident' | 'stay'; text: string }>>([
    { from: 'resident', text: 'Alexa, open STAY.' },
    {
      from: 'stay',
      text: 'Good morning, Sarah. Your home is settled. You have one thing to remember.',
    },
  ]);
  const [phrase, setPhrase] = useState('');
  const [voicePending, setVoicePending] = useState(false);
  const [sessionLabel, setSessionLabel] = useState('Starting isolated demo…');
  const [ready, setReady] = useState(false);
  const [runtimeConfig, setRuntimeConfig] = useState<StayRuntimeConfig | null>(null);
  const [demoSession, setDemoSession] = useState<DemoSessionRecord | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const refresh = useCallback(() => setState(engine.current.snapshot()), []);
  useEffect(() => {
    let cancelled = false;
    const useBrowserFallback = (message?: string) => {
      if (cancelled) return;
      const session = browserDemoSession();
      const next = engine.current.snapshot();
      next.access = browserAccessPreferences(next.access);
      engine.current = new StayEngine(next);
      setState(next);
      setDemoSession(null);
      setSessionLabel(`Browser-only demo · ${session.id.slice(-5)}`);
      setReady(true);
      if (message) setLastError(message);
    };
    void (async () => {
      try {
        const config = await loadRuntimeConfig();
        if (!config) {
          useBrowserFallback();
          return;
        }
        if (cancelled) return;
        setRuntimeConfig(config);
        try {
          setAuthenticated((await completeSignIn(config)) || hasAuthenticatedSession());
        } catch (error) {
          if (!cancelled)
            setLastError(error instanceof Error ? error.message : 'Sign-in setup is unavailable.');
        }
        const session = await createDemoSession(config);
        const hydrated = await hydrateDemoState(config, session, createDemoState());
        if (cancelled) return;
        engine.current = new StayEngine(hydrated);
        setState(hydrated);
        setDemoSession(session);
        setSessionLabel(`Isolated AWS demo · ${session.id.slice(-5)}`);
        setReady(true);
      } catch {
        useBrowserFallback(
          'The cloud demo is temporarily unavailable. This browser-only session still runs the deterministic safety flow.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runtimeConfig || !demoSession || actionPending) return;
    const reconciliationMessage =
      'Live updates paused. STAY will reconcile with the API when the connection returns.';
    let stopped = false;
    let reconciling = false;
    let reconcileQueued = false;
    let reconcileAttempt = 0;
    let reconciliationRetry: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      if (stopped) return;
      if (reconciling) {
        reconcileQueued = true;
        return;
      }
      if (reconciliationRetry) {
        clearTimeout(reconciliationRetry);
        reconciliationRetry = null;
      }
      reconciling = true;
      void hydrateDemoState(runtimeConfig, demoSession, engine.current.snapshot())
        .then((hydrated) => {
          if (stopped) return;
          reconcileAttempt = 0;
          engine.current = new StayEngine(hydrated);
          setState(hydrated);
          setLastError((current) => (current === reconciliationMessage ? null : current));
        })
        .catch(() => {
          if (stopped) return;
          setLastError(reconciliationMessage);
          reconcileAttempt += 1;
          reconciliationRetry = setTimeout(
            reconcile,
            Math.min(10_000, 500 * 2 ** reconcileAttempt),
          );
        })
        .finally(() => {
          reconciling = false;
          if (reconcileQueued && !stopped) {
            reconcileQueued = false;
            queueMicrotask(reconcile);
          }
        });
    };
    const disconnect = connectDemoUpdates(runtimeConfig, demoSession, reconcile);
    return () => {
      stopped = true;
      if (reconciliationRetry) clearTimeout(reconciliationRetry);
      disconnect();
    };
  }, [actionPending, demoSession, runtimeConfig]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let savedTheme: 'light' | 'dark' | null = null;
    try {
      const stored = window.localStorage.getItem('stay-theme-v1');
      if (stored === 'light' || stored === 'dark') savedTheme = stored;
    } catch {
      // A blocked storage API should not prevent the system preference from working.
    }
    explicitThemePreference.current = savedTheme !== null;
    const initialTheme = savedTheme ?? (media.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = initialTheme;
    setTheme(initialTheme);

    const followSystemTheme = (event: MediaQueryListEvent) => {
      if (explicitThemePreference.current) return;
      const nextTheme = event.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = nextTheme;
      setTheme(nextTheme);
    };
    media.addEventListener('change', followSystemTheme);
    return () => media.removeEventListener('change', followSystemTheme);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const nextTheme = current === 'light' ? 'dark' : 'light';
      explicitThemePreference.current = true;
      document.documentElement.dataset.theme = nextTheme;
      try {
        window.localStorage.setItem('stay-theme-v1', nextTheme);
      } catch {
        // The theme still applies for this session when storage is unavailable.
      }
      return nextTheme;
    });
  };

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNotificationsOpen(false);
      notificationsButtonRef.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [notificationsOpen]);

  const notificationFingerprint = [
    ...state.helpRequests.map((request) => `${request.id}:${request.state}:${request.version}`),
    ...state.incidents.map((incident) => `${incident.id}:${incident.state}:${incident.version}`),
  ].join('|');
  useEffect(() => {
    setNotificationsSeen(false);
  }, [notificationFingerprint]);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.highContrast = String(state.access.highContrast);
    document.documentElement.dataset.reducedMotion = String(state.access.reducedMotion);
    document.documentElement.dataset.textScale = state.access.textScale;
    window.localStorage.setItem('stay-access-preferences-v1', JSON.stringify(state.access));
  }, [ready, state.access]);

  const runProtectedDemo = useCallback(async () => {
    if (actionPending) return;
    setActionPending(true);
    setLastError(null);
    const currentWindows = engine.current.snapshot().safetyWindows;
    const window =
      currentWindows.find((candidate) => candidate.id === 'window-morning') ?? currentWindows[0];
    if (!window) {
      setActionPending(false);
      return;
    }
    try {
      if (demoStep === 0) {
        const idempotencyKey = uid('window-check-one');
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<SafetyWindow>(runtimeConfig, demoSession, {
            group: 'safety-windows',
            action: 'record-missed-check',
            entityId: window.id,
            expectedVersion: window.version,
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.safetyWindows = next.safetyWindows.map((item) =>
            item.id === remote.entity.id ? remote.entity : item,
          );
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          engine.current.markSafetyWindowMissed(window.id, {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: window.version,
          });
          refresh();
        }
        setNotice('Sarah did not answer the first check. STAY will try once more in 10 minutes.');
        setTranscript((items) => [
          ...items,
          { from: 'stay', text: 'Sarah, your Morning Window is still open. Are you okay?' },
        ]);
        setDemoStep(1);
        return;
      }
      if (demoStep === 1) {
        const missKey = uid('window-check-two');
        const activateKey = uid('incident-activate');
        if (runtimeConfig && demoSession) {
          const remoteMissed = await runDemoCommand<SafetyWindow>(runtimeConfig, demoSession, {
            group: 'safety-windows',
            action: 'record-missed-check',
            entityId: window.id,
            expectedVersion: window.version,
            idempotencyKey: missKey,
          });
          const remoteIncident = await runDemoCommand<Incident>(runtimeConfig, demoSession, {
            group: 'incidents',
            action: 'activate-from-window',
            entityId: window.id,
            expectedVersion: remoteMissed.version,
            idempotencyKey: activateKey,
          });
          const next = engine.current.snapshot();
          next.safetyWindows = next.safetyWindows.map((item) =>
            item.id === remoteMissed.entity.id ? remoteMissed.entity : item,
          );
          next.incidents = [
            remoteIncident.entity,
            ...next.incidents.filter((item) => item.id !== remoteIncident.entity.id),
          ];
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          const missed = engine.current.markSafetyWindowMissed(window.id, {
            actor: residentActor,
            idempotencyKey: missKey,
            expectedVersion: window.version,
          });
          engine.current.activateMissedWindowIncident(window.id, {
            actor: residentActor,
            idempotencyKey: activateKey,
            expectedVersion: missed.entity.version,
          });
          refresh();
        }
        setNotice(
          'Two checks were missed. Sarah’s Circle plan is active; no emergency service was contacted.',
        );
        setTranscript((items) => [
          ...items,
          {
            from: 'stay',
            text: 'I could not confirm Sarah’s check-in. I’m starting her Circle plan now.',
          },
        ]);
        setDemoStep(2);
        setSurface('circle');
        setCircleSurface('incidents');
        return;
      }
      const incident = engine.current.snapshot().incidents[0];
      if (!incident) return;
      if (demoStep === 2) {
        const idempotencyKey = uid('ask-tom');
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<Incident>(runtimeConfig, demoSession, {
            group: 'incidents',
            action: 'ask-responder',
            entityId: incident.id,
            memberId: 'member-tom',
            expectedVersion: incident.version,
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.incidents = next.incidents.map((item) =>
            item.id === remote.entity.id ? remote.entity : item,
          );
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          engine.current.offerIncidentToMember(incident.id, 'member-tom', {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: incident.version,
          });
          refresh();
        }
        setNotice(
          'Sarah asked Tom, her nearby helper. Only the minimum incident detail was shared.',
        );
        setTranscript((items) => [
          ...items,
          { from: 'resident', text: 'Ask Tom to check on me.' },
          { from: 'stay', text: 'I asked Tom. I’ll let your Circle know when he responds.' },
        ]);
        setDemoStep(3);
        return;
      }
      if (demoStep === 3) {
        const idempotencyKey = uid('tom-accepts');
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<Incident>(runtimeConfig, demoSession, {
            group: 'incidents',
            action: 'accept',
            entityId: incident.id,
            memberId: 'member-tom',
            expectedVersion: incident.version,
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.incidents = next.incidents.map((item) =>
            item.id === remote.entity.id ? remote.entity : item,
          );
          next.circle = next.circle.map((member) =>
            member.id === 'member-tom' ? { ...member, availability: 'responding' } : member,
          );
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          engine.current.acceptIncident(incident.id, 'member-tom', {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: incident.version,
          });
          refresh();
        }
        setNotice(
          'Tom is on the way. He now owns the response, and Sarah’s Circle can see the update.',
        );
        setTranscript((items) => [
          ...items,
          { from: 'stay', text: 'Tom accepted. Tom is on the way.' },
        ]);
        setDemoStep(4);
        return;
      }
      if (runtimeConfig && demoSession) {
        const nextSession = await createDemoSession(runtimeConfig, true);
        const hydrated = await hydrateDemoState(runtimeConfig, nextSession, createDemoState());
        engine.current = new StayEngine(hydrated);
        setState(hydrated);
        setDemoSession(nextSession);
        setSessionLabel(`Isolated AWS demo · ${nextSession.id.slice(-5)}`);
      } else {
        engine.current.reset();
        refresh();
      }
      setDemoStep(0);
      setSurface('home');
      setNotice('Demo reset. Sarah’s isolated household is ready.');
      setTranscript([
        { from: 'resident', text: 'Alexa, open STAY.' },
        {
          from: 'stay',
          text: 'Good morning, Sarah. Your home is settled. You have one thing to remember.',
        },
      ]);
    } catch (error) {
      setLastError(
        error instanceof Error
          ? error.message
          : 'That demo action could not be completed. No unsafe transition was applied.',
      );
    } finally {
      setActionPending(false);
    }
  }, [actionPending, demoSession, demoStep, refresh, runtimeConfig]);

  const manageOneThing = useCallback(async () => {
    if (actionPending) return;
    const task = engine.current.snapshot().oneThing;
    const action = ['completed', 'cancelled'].includes(task.state) ? 'reset' : 'complete';
    const idempotencyKey = uid(`task-${action}`);
    setActionPending(true);
    setLastError(null);
    try {
      if (runtimeConfig && demoSession) {
        const remote = await runDemoCommand<HomeState['oneThing']>(runtimeConfig, demoSession, {
          group: 'tasks',
          action,
          entityId: task.id,
          expectedVersion: task.version,
          idempotencyKey,
        });
        const next = engine.current.snapshot();
        next.oneThing = remote.entity;
        engine.current = new StayEngine(next);
        setState(next);
      } else {
        engine.current.manageTaskSession(action, {
          actor: residentActor,
          idempotencyKey,
          expectedVersion: task.version,
        });
        refresh();
      }
      setNotice(
        action === 'complete'
          ? 'One Thing complete. Sarah can choose what deserves attention next.'
          : 'One Thing is ready again.',
      );
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'The task did not change.');
    } finally {
      setActionPending(false);
    }
  }, [actionPending, demoSession, refresh, runtimeConfig]);

  const updateAccess = useCallback(
    (changes: Partial<AccessPreferences>) => {
      accessUpdateQueue.current = accessUpdateQueue.current.then(async () => {
        const currentAccess = engine.current.snapshot().access;
        const nextAccess = { ...currentAccess, ...changes };
        const preferences: AccessPreferences = {
          interactionMode: nextAccess.interactionMode,
          reducedLoad: nextAccess.reducedLoad,
          highLegibility: nextAccess.highLegibility,
          captions: nextAccess.captions,
          extraResponseTime: nextAccess.extraResponseTime,
          repeatInformation: nextAccess.repeatInformation,
          highContrast: nextAccess.highContrast,
          reducedMotion: nextAccess.reducedMotion,
          textScale: nextAccess.textScale,
        };
        const idempotencyKey = uid('access-update');
        setActionPending(true);
        setLastError(null);
        try {
          if (runtimeConfig && demoSession) {
            const remote = await runDemoCommand<HomeState['access']>(runtimeConfig, demoSession, {
              group: 'access',
              action: 'update',
              entityId: currentAccess.id,
              expectedVersion: currentAccess.version,
              idempotencyKey,
              preferences,
            });
            const next = engine.current.snapshot();
            next.access = remote.entity;
            engine.current = new StayEngine(next);
            setState(next);
          } else {
            engine.current.updateAccessPreferences(preferences, {
              actor: residentActor,
              idempotencyKey,
              expectedVersion: currentAccess.version,
            });
            refresh();
          }
          setNotice('Sarah’s access preferences are saved. Safety policy did not change.');
        } catch (error) {
          setLastError(
            error instanceof Error ? error.message : 'Access preferences did not change.',
          );
        } finally {
          setActionPending(false);
        }
      });
    },
    [demoSession, refresh, runtimeConfig],
  );

  const requestPrivacyConfirmation = useCallback(
    async (purpose: ConfirmationPurpose): Promise<ConfirmationToken | null> => {
      if (actionPending) return null;
      const privacy = engine.current.snapshot().privacy;
      setActionPending(true);
      setLastError(null);
      try {
        const confirmation =
          runtimeConfig && demoSession
            ? await requestDemoConfirmation(runtimeConfig, demoSession, {
                entityId: privacy.id,
                expectedVersion: privacy.version,
                purpose,
                idempotencyKey: uid('privacy-confirmation'),
              })
            : {
                token: `${crypto.randomUUID()}${crypto.randomUUID()}`,
                purpose,
                subject: residentActor.subject,
                entityId: privacy.id,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
              };
        setNotice(
          'Review the privacy change, then confirm it once. The approval expires in 5 minutes.',
        );
        return confirmation;
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : 'Confirmation could not be prepared.',
        );
        return null;
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, runtimeConfig],
  );

  const updatePrivacy = useCallback(
    async (input: PrivacyUpdateInput, confirmation?: ConfirmationToken): Promise<boolean> => {
      if (actionPending) return false;
      const privacy = engine.current.snapshot().privacy;
      const idempotencyKey = uid('privacy-update');
      setActionPending(true);
      setLastError(null);
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<HomeState['privacy']>(runtimeConfig, demoSession, {
            group: 'privacy',
            action: 'update',
            entityId: privacy.id,
            expectedVersion: privacy.version,
            idempotencyKey,
            ...input,
            ...(confirmation ? { confirmationToken: confirmation.token } : {}),
          });
          const next = engine.current.snapshot();
          next.privacy = remote.entity;
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          engine.current.updatePrivacy(
            input,
            {
              actor: residentActor,
              idempotencyKey,
              expectedVersion: privacy.version,
            },
            confirmation,
          );
          refresh();
        }
        setNotice(
          input.temporaryPrivateUntil === null
            ? 'Private time ended after Sarah’s explicit confirmation.'
            : 'Routine sharing is paused for 2 hours. Requested help and active incidents still work.',
        );
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'Privacy settings did not change.');
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const createSafetyWindow = useCallback(
    async (input: CreateSafetyWindowInput): Promise<boolean> => {
      if (actionPending) return false;
      setActionPending(true);
      setLastError(null);
      const idempotencyKey = uid('window-create');
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<SafetyWindow>(runtimeConfig, demoSession, {
            group: 'safety-windows',
            action: 'create',
            idempotencyKey,
            ...input,
          });
          const next = engine.current.snapshot();
          next.safetyWindows = [
            remote.entity,
            ...next.safetyWindows.filter((item) => item.id !== remote.entity.id),
          ];
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          engine.current.createSafetyWindow(input, { actor: residentActor, idempotencyKey });
          refresh();
        }
        setDemoStep(0);
        setNotice(
          `${input.title} is scheduled. Sarah’s saved Circle order will be used only after two missed checks.`,
        );
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'The Safety Window was not created.');
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const manageSafetyWindow = useCallback(
    async (action: 'check-in' | 'close-early' | 'cancel', windowId: string) => {
      if (actionPending) return;
      const window = engine.current
        .snapshot()
        .safetyWindows.find((candidate) => candidate.id === windowId);
      if (!window) return;
      setActionPending(true);
      setLastError(null);
      const idempotencyKey = uid(`window-${action}`);
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<SafetyWindow>(runtimeConfig, demoSession, {
            group: 'safety-windows',
            action,
            entityId: window.id,
            expectedVersion: window.version,
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.safetyWindows = next.safetyWindows.map((item) =>
            item.id === remote.entity.id ? remote.entity : item,
          );
          engine.current = new StayEngine(next);
          setState(next);
        } else if (action === 'cancel') {
          engine.current.cancelSafetyWindow(window.id, {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: window.version,
          });
          refresh();
        } else {
          engine.current.checkInSafetyWindow(
            window.id,
            { actor: residentActor, idempotencyKey, expectedVersion: window.version },
            action === 'close-early',
          );
          refresh();
        }
        setDemoStep(0);
        setNotice(
          action === 'cancel'
            ? 'Morning Window cancelled. No Circle coordination will begin.'
            : action === 'close-early'
              ? 'Morning Window closed early. Sarah remains in control.'
              : 'Sarah checked in. No Circle coordination is needed.',
        );
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'The Safety Window did not change.');
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const manageHelpRequest = useCallback(
    async (requestId: string) => {
      if (actionPending) return;
      const request = engine.current
        .snapshot()
        .helpRequests.find((candidate) => candidate.id === requestId);
      if (!request || ['completed', 'cancelled', 'declined'].includes(request.state)) return;
      const action = request.state === 'assigned' ? 'complete' : 'accept';
      const idempotencyKey = uid(`help-${action}`);
      setActionPending(true);
      setLastError(null);
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<HelpRequest>(runtimeConfig, demoSession, {
            group: 'help-requests',
            action,
            entityId: request.id,
            expectedVersion: request.version,
            ...(action === 'accept' ? { memberId: 'member-tom' } : {}),
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.helpRequests = next.helpRequests.map((item) =>
            item.id === remote.entity.id ? remote.entity : item,
          );
          engine.current = new StayEngine(next);
          setState(next);
        } else if (action === 'accept') {
          engine.current.acceptHelpRequest(request.id, 'member-tom', {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: request.version,
          });
          refresh();
        } else {
          engine.current.completeHelpRequest(request.id, {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: request.version,
          });
          refresh();
        }
        setNotice(
          action === 'accept'
            ? 'Tom accepted this ordinary help request and now owns it.'
            : 'The ordinary help request is complete.',
        );
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'The help request did not change.');
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const createHelpRequest = useCallback(
    async (input: Pick<HelpRequest, 'title' | 'detail' | 'urgency'>) => {
      if (actionPending) return false;
      const idempotencyKey = uid('help-create');
      setActionPending(true);
      setLastError(null);
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<HelpRequest>(runtimeConfig, demoSession, {
            group: 'help-requests',
            action: 'create',
            title: input.title,
            detail: input.detail,
            urgency: input.urgency,
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.helpRequests = [
            remote.entity,
            ...next.helpRequests.filter((item) => item.id !== remote.entity.id),
          ];
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          engine.current.requestHelp(input, { actor: residentActor, idempotencyKey });
          refresh();
        }
        setNotice('The help request is on Sarah’s private Help Board.');
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'The help request was not created.');
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const saveHouseMemory = useCallback(
    async (
      input: Pick<HouseMemoryItem, 'label' | 'value' | 'category' | 'sensitivity'>,
      existing?: HouseMemoryItem,
    ) => {
      if (actionPending) return false;
      const action = existing ? 'update' : 'add';
      const idempotencyKey = uid(`memory-${action}`);
      setActionPending(true);
      setLastError(null);
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<HomeState['houseMemory'][number]>(
            runtimeConfig,
            demoSession,
            {
              group: 'house-memory',
              action,
              idempotencyKey,
              ...(existing ? { entityId: existing.id, expectedVersion: existing.version } : {}),
              ...input,
            },
          );
          const next = engine.current.snapshot();
          next.houseMemory = existing
            ? next.houseMemory.map((item) => (item.id === remote.entity.id ? remote.entity : item))
            : [remote.entity, ...next.houseMemory.filter((item) => item.id !== remote.entity.id)];
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          if (existing) {
            engine.current.updateHouseMemory(existing.id, input, {
              actor: residentActor,
              idempotencyKey,
              expectedVersion: existing.version,
            });
          } else {
            engine.current.addHouseMemory(input, { actor: residentActor, idempotencyKey });
          }
          refresh();
        }
        setNotice(
          existing
            ? 'The house detail and its sharing boundary are updated.'
            : 'The house detail is saved with its sharing boundary.',
        );
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'The house detail was not saved.');
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const manageIncident = useCallback(
    async (action: 'escalate' | 'resolve') => {
      if (actionPending) return;
      const incident = engine.current.snapshot().incidents[0];
      if (!incident) return;
      const idempotencyKey = uid(`incident-${action}`);
      setActionPending(true);
      setLastError(null);
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<Incident>(runtimeConfig, demoSession, {
            group: 'incidents',
            action,
            entityId: incident.id,
            expectedVersion: incident.version,
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.incidents = next.incidents.map((item) =>
            item.id === remote.entity.id ? remote.entity : item,
          );
          if (action === 'resolve') {
            next.safetyWindows = next.safetyWindows.map((window) =>
              `incident-${window.id}` === incident.id
                ? { ...window, state: 'resolved', version: window.version + 1 }
                : window,
            );
          }
          engine.current = new StayEngine(next);
          setState(next);
        } else if (action === 'escalate') {
          engine.current.escalateIncident(incident.id, {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: incident.version,
          });
          refresh();
        } else {
          engine.current.resolveIncident(incident.id, {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: incident.version,
          });
          refresh();
        }
        setNotice(
          action === 'escalate'
            ? 'The Circle plan moved to the next preconfigured contact.'
            : 'Sarah is okay. The incident is resolved and remains in the audit trail.',
        );
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'The incident did not change.');
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const advancePlaybook = useCallback(
    async (id: string) => {
      if (actionPending) return;
      const playbook = engine.current.snapshot().playbooks.find((item) => item.id === id);
      if (!playbook) return;
      const idempotencyKey = uid('playbook');
      setActionPending(true);
      setLastError(null);
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<Playbook>(runtimeConfig, demoSession, {
            group: 'playbooks',
            action: 'next-step',
            entityId: playbook.id,
            expectedVersion: playbook.version,
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.playbooks = next.playbooks.map((item) =>
            item.id === remote.entity.id ? remote.entity : item,
          );
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          engine.current.executePlaybook(id, {
            actor: residentActor,
            idempotencyKey,
            expectedVersion: playbook.version,
          });
          refresh();
        }
        setNotice(`${playbook.title} advanced one deterministic step.`);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'The playbook did not change.');
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const createPlaybook = useCallback(
    async (input: CreatePlaybookInput): Promise<boolean> => {
      if (actionPending) return false;
      const idempotencyKey = uid('playbook-create');
      setActionPending(true);
      setLastError(null);
      try {
        if (runtimeConfig && demoSession) {
          const remote = await runDemoCommand<Playbook>(runtimeConfig, demoSession, {
            group: 'playbooks',
            action: 'create',
            title: input.title,
            steps: input.steps,
            idempotencyKey,
          });
          const next = engine.current.snapshot();
          next.playbooks = [
            remote.entity,
            ...next.playbooks.filter((item) => item.id !== remote.entity.id),
          ];
          engine.current = new StayEngine(next);
          setState(next);
        } else {
          engine.current.createPlaybook(input, { actor: residentActor, idempotencyKey });
          refresh();
        }
        setNotice(`${input.title} is ready as a resident-authored plan.`);
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'The custom plan was not created.');
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, demoSession, refresh, runtimeConfig],
  );

  const submitPhrase = async (event: FormEvent) => {
    event.preventDefault();
    const clean = phrase.trim();
    if (!clean) return;
    const normalized = clean.toLowerCase();
    let reply =
      'I can help with your home, Safety Windows, Circle, plans, privacy, or House Memory.';
    if (hasExplicitEmergencyLanguage(clean)) {
      reply =
        'STAY can coordinate your preconfigured Circle. It does not contact emergency services or replace Alexa Emergency Assist. No action was taken.';
    } else if (runtimeConfig && demoSession) {
      setVoicePending(true);
      try {
        const intent = await interpretDemoIntent(runtimeConfig, demoSession, {
          utterance: clean,
          currentSurface: surface,
          visibleEntityIds: [
            state.oneThing.id,
            ...state.safetyWindows.map((item) => item.id),
            ...state.incidents.map((item) => item.id),
            ...state.playbooks.map((item) => item.id),
          ].slice(0, 20),
          locale: 'en-US',
        });
        reply = intent.explicitEmergencyLanguage
          ? 'STAY can coordinate your preconfigured Circle. It does not contact emergency services or replace Alexa Emergency Assist. No action was taken.'
          : /no action (?:has been|was) taken[.!]?$/i.test(intent.explanation.trim())
            ? intent.explanation
            : `${intent.explanation} No action was taken.`;
      } catch (error) {
        reply =
          error instanceof Error
            ? `${error.message} You can still use every deterministic touch control.`
            : 'AI interpretation is unavailable. You can still use every deterministic touch control.';
      } finally {
        setVoicePending(false);
      }
    } else if (normalized.includes('help')) {
      reply = 'I can help you create an ordinary request for your Circle. No action was taken.';
    } else if (normalized.includes('morning') || normalized.includes('today')) {
      reply =
        'Good morning. Your home is settled. Your one thing is to put the blue recycling bin out.';
    } else if (normalized.includes('tom')) {
      reply =
        demoStep >= 4
          ? 'Tom is on the way.'
          : 'Tom is available and usually responds in about seven minutes.';
    } else if (normalized.includes('privacy')) {
      reply =
        'Routine sharing is on. Location is shared only during an active incident that your plan authorizes.';
    }
    setTranscript((items) => [
      ...items,
      { from: 'resident', text: clean },
      { from: 'stay', text: reply },
    ]);
    setPhrase('');
  };

  const demoLabel = [
    'Miss the first check',
    'Miss the second check',
    'Sarah asks Tom',
    'Tom accepts',
    'Reset demo',
  ][demoStep];
  const activeIncident = state.incidents[0];
  const interactionPending = !ready || actionPending;

  return (
    <main
      className="app-shell"
      data-ready={ready}
      data-reduced-load={state.access.reducedLoad}
      data-interaction-mode={state.access.interactionMode}
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside
        className={menuOpen ? 'sidebar sidebar-open' : 'sidebar'}
        aria-label="Primary navigation"
      >
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>STAY</strong>
            <small>Sarah’s home</small>
          </div>
          <button
            className="icon-button close-menu"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X />
          </button>
        </div>
        <nav>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={surface === item.id ? 'nav-item active' : 'nav-item'}
                key={item.id}
                onClick={() => {
                  setSurface(item.id);
                  setMenuOpen(false);
                  setNotificationsOpen(false);
                }}
                aria-current={surface === item.id ? 'page' : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {runtimeConfig && (
            <button
              className="auth-button sidebar-auth"
              onClick={() =>
                void (authenticated ? signOut(runtimeConfig) : beginSignIn(runtimeConfig))
              }
            >
              {authenticated ? <LogOut /> : <LogIn />}
              {authenticated ? 'Sign out' : 'Sign in'}
            </button>
          )}
          <div className="resident-chip">
            <span className="avatar">SB</span>
            <span>
              <strong>Sarah Bennett</strong>
              <small>Resident · at home</small>
            </span>
          </div>
          <div className="privacy-note">
            <ShieldCheck aria-hidden="true" />
            <span>
              Private by design
              <br />
              <small>{sessionLabel}</small>
            </span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </button>
          <div className="mobile-home-context" aria-label="STAY, Sarah’s home is settled">
            <strong>STAY</strong>
            <span>
              <span className="status-dot" aria-hidden="true" /> Settled
            </span>
          </div>
          <div className="live-status">
            <span className="status-dot" /> <span>Home settled</span>
          </div>
          <div className="topbar-actions">
            <span className="provenance-label">
              <CircleDot /> Public demo · simulated providers labeled
            </span>
            {runtimeConfig && (
              <button
                className="auth-button topbar-auth"
                onClick={() =>
                  void (authenticated ? signOut(runtimeConfig) : beginSignIn(runtimeConfig))
                }
              >
                {authenticated ? <LogOut /> : <LogIn />}
                {authenticated ? 'Sign out' : 'Sign in'}
              </button>
            )}
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              {theme === 'light' ? <Moon /> : <Sun />}
            </button>
            <button
              ref={notificationsButtonRef}
              className="icon-button"
              aria-label={
                notificationsOpen
                  ? 'Close notifications'
                  : notificationsSeen
                    ? 'Open notifications'
                    : 'Open notifications, new updates'
              }
              aria-expanded={notificationsOpen}
              aria-controls="notification-panel"
              onClick={() => {
                const nextOpen = !notificationsOpen;
                setNotificationsOpen(nextOpen);
                if (nextOpen) setNotificationsSeen(true);
              }}
            >
              <BellRing />
              {!notificationsSeen && <span className="notification-dot" aria-hidden="true" />}
            </button>
          </div>
          {notificationsOpen && (
            <section
              className="notification-panel"
              id="notification-panel"
              aria-labelledby="notification-panel-title"
            >
              <div className="notification-panel-header">
                <div>
                  <span className="eyebrow">Sarah’s home</span>
                  <h2 id="notification-panel-title">Updates</h2>
                </div>
                <button
                  className="icon-button small"
                  onClick={() => {
                    setNotificationsOpen(false);
                    notificationsButtonRef.current?.focus();
                  }}
                  aria-label="Close updates panel"
                >
                  <X />
                </button>
              </div>
              <div className="notification-list">
                {activeIncident && activeIncident.state !== 'resolved' && (
                  <button
                    className="notification-item notification-item-action"
                    onClick={() => {
                      setSurface('circle');
                      setCircleSurface('incidents');
                      setNotificationsOpen(false);
                    }}
                  >
                    <span className="notification-symbol incident" aria-hidden="true">
                      <Navigation />
                    </span>
                    <span>
                      <small>Circle response</small>
                      <strong>
                        {activeIncident.state === 'responding'
                          ? 'Tom is on the way.'
                          : 'Sarah’s Circle plan is active.'}
                      </strong>
                      <span>Open the incident timeline and current ownership.</span>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                )}
                {state.helpRequests
                  .filter((request) => request.state === 'open')
                  .slice(0, 1)
                  .map((request) => (
                    <button
                      className="notification-item notification-item-action"
                      key={request.id}
                      onClick={() => {
                        setSurface('circle');
                        setCircleSurface('help');
                        setNotificationsOpen(false);
                      }}
                    >
                      <span className="notification-symbol" aria-hidden="true">
                        <HandHeart />
                      </span>
                      <span>
                        <small>Open Help Board request</small>
                        <strong>{request.title}</strong>
                        <span>Offered to Tom · {request.urgency}</span>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  ))}
                <div className="notification-item home-update">
                  <span className="notification-symbol settled" aria-hidden="true">
                    <Home />
                  </span>
                  <span>
                    <small>Home status</small>
                    <strong>Sarah’s home is settled.</strong>
                    <span>No new safety action is needed.</span>
                  </span>
                </div>
              </div>
            </section>
          )}
        </header>

        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {notice}
        </p>
        <div className="content-grid" id="main-content" tabIndex={-1}>
          <section className="main-panel">
            {lastError && (
              <div className="error-banner" role="alert">
                {lastError}
              </div>
            )}
            {surface === 'home' && (
              <HomeSurface
                state={state}
                onNavigate={setSurface}
                onTaskAction={() => void manageOneThing()}
                pending={interactionPending}
              />
            )}
            {surface === 'access' && (
              <AccessSurface
                state={state}
                onChange={(next) => void updateAccess(next)}
                pending={interactionPending}
              />
            )}
            {surface === 'windows' && (
              <WindowsSurface
                state={state}
                demoStep={demoStep}
                pending={interactionPending}
                onAction={(action, windowId) => void manageSafetyWindow(action, windowId)}
                onCreate={createSafetyWindow}
              />
            )}
            {surface === 'circle' && (
              <CircleSurfaceView
                state={state}
                active={circleSurface}
                onChange={setCircleSurface}
                onHelpAction={(id) => void manageHelpRequest(id)}
                onCreateHelp={createHelpRequest}
                onIncidentAction={(action) => void manageIncident(action)}
                onRoutineSharing={(enabled) => void updatePrivacy({ routineSharing: enabled })}
                pending={interactionPending}
                {...(activeIncident ? { activeIncident } : {})}
              />
            )}
            {surface === 'playbooks' && (
              <PlaybooksSurface
                state={state}
                onRun={(id) => void advancePlaybook(id)}
                onCreate={createPlaybook}
                pending={interactionPending}
              />
            )}
            {surface === 'privacy' && (
              <PrivacySurface
                state={state}
                onChange={updatePrivacy}
                onRequestConfirmation={requestPrivacyConfirmation}
                pending={interactionPending}
              />
            )}
            {surface === 'memory' && (
              <MemorySurface state={state} onSave={saveHouseMemory} pending={interactionPending} />
            )}
          </section>

          <aside className="simulator-rail" aria-label="Alexa Plus simulator">
            <div className="demo-control-card">
              <div>
                <span className="eyebrow">Protected demo moment</span>
                <h2>{demoStep >= 4 ? 'Tom is on the way.' : 'Missed Morning Window'}</h2>
              </div>
              <div
                className="demo-progress"
                role="progressbar"
                aria-label="Protected demo progress"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={demoStep}
                aria-valuetext={`Step ${demoStep + 1} of 5`}
              >
                {[0, 1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={demoStep > step ? 'complete' : demoStep === step ? 'current' : ''}
                  />
                ))}
              </div>
              <p>{notice}</p>
              <button
                className={demoStep === 3 ? 'primary-button clay' : 'primary-button'}
                onClick={() => void runProtectedDemo()}
                disabled={!ready || actionPending}
                aria-busy={actionPending}
              >
                {actionPending ? <RefreshCw /> : demoStep === 4 ? <RefreshCw /> : <Play />}{' '}
                {actionPending ? 'Saving…' : demoLabel}
              </button>
              <small className="safety-copy">
                Circle coordination only. No emergency service is contacted.
              </small>
            </div>

            <div className="echo-device">
              <div className="echo-camera" />
              <div className="echo-screen">
                <div className="echo-header">
                  <span>8:42</span>
                  <span>
                    <CloudSun /> 72° <em>Simulated</em>
                  </span>
                </div>
                <div className="echo-content">
                  <span className="eyebrow light">STAY FOR SARAH</span>
                  <h2>{demoStep >= 4 ? 'Tom is on the way.' : 'Your home is settled.'}</h2>
                  <p>
                    {demoStep >= 4
                      ? 'Tom accepted and now owns the response.'
                      : state.oneThing.title}
                  </p>
                  {demoStep >= 4 ? (
                    <div className="arrival-row">
                      <Navigation />
                      <span>
                        <strong>About 7 min</strong>
                        <small>Nearby helper · simulated travel estimate</small>
                      </span>
                    </div>
                  ) : (
                    <button
                      className="echo-action"
                      onClick={() =>
                        setTranscript((items) => [
                          ...items,
                          {
                            from: 'stay',
                            text: 'Your one thing is to put the blue recycling bin out. The bin is beside the back door.',
                          },
                        ])
                      }
                    >
                      Tell me more
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="voice-card">
              <div className="voice-title">
                <span className="conversation-mark">
                  <Mic />
                </span>
                <div>
                  <strong>Alexa+ conversation</strong>
                  <small>Keyboard and caption simulator</small>
                </div>
              </div>
              <div className="transcript" aria-label="Conversation transcript" tabIndex={0}>
                {transcript.slice(-4).map((line, index) => (
                  <p key={`${line.text}-${index}`} className={line.from}>
                    <span>{line.from === 'stay' ? 'STAY' : 'YOU'}</span>
                    {line.text}
                  </p>
                ))}
              </div>
              <form onSubmit={submitPhrase} className="voice-form">
                <label htmlFor="alexa-phrase" className="sr-only">
                  Type an Alexa phrase
                </label>
                <input
                  id="alexa-phrase"
                  value={phrase}
                  onChange={(event) => setPhrase(event.target.value)}
                  placeholder="Try “What’s happening today?”"
                  disabled={!ready || voicePending}
                />
                <button
                  aria-label="Send phrase"
                  disabled={!ready || voicePending}
                  aria-busy={voicePending}
                >
                  <ChevronRight />
                </button>
              </form>
            </div>
          </aside>
        </div>
      </section>
      {menuOpen && (
        <button
          className="scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation"
        />
      )}
    </main>
  );
}

function HomeSurface({
  state,
  onNavigate,
  onTaskAction,
  pending,
}: {
  state: HomeState;
  onNavigate: (surface: Surface) => void;
  onTaskAction: () => void;
  pending: boolean;
}) {
  const [fullCheckOpen, setFullCheckOpen] = useState(false);
  return (
    <>
      <header className="page-intro home-intro">
        <div>
          <span className="eyebrow">WEDNESDAY · SEPTEMBER 2</span>
          <h1>Good morning, Sarah.</h1>
          <p>
            Your home is settled. Here is what deserves your attention—not everything that could.
          </p>
        </div>
        <div className="weather-mark" aria-label="Weather data is simulated">
          <Sun />
          <span>
            <strong>72°</strong>
            <small>Clear · simulated at 8:42</small>
          </span>
        </div>
      </header>

      <section className={state.oneThing.completed ? 'one-thing-card completed' : 'one-thing-card'}>
        <div className="pin-icon">
          <ClipboardCheck />
        </div>
        <div className="one-thing-copy">
          <span className="eyebrow">YOUR ONE THING</span>
          <h2>{state.oneThing.title}</h2>
          <p>{state.oneThing.detail}</p>
        </div>
        <button
          className="round-check"
          aria-label={
            state.oneThing.completed
              ? 'Make the recycling reminder active again'
              : 'Mark the recycling reminder complete'
          }
          aria-pressed={state.oneThing.completed}
          onClick={onTaskAction}
          disabled={pending}
        >
          <Check />
        </button>
      </section>

      <div className="secondary-home-content">
        <div className="section-heading">
          <div>
            <span className="eyebrow">A QUIET OVERVIEW</span>
            <h2>Today at home</h2>
          </div>
          <button
            className="text-button"
            onClick={() => setFullCheckOpen((value) => !value)}
            aria-expanded={fullCheckOpen}
          >
            {fullCheckOpen ? 'Close home check' : 'Full home check'} <ChevronRight />
          </button>
        </div>
        <div className="status-cards">
          <article className="status-card">
            <div className="status-card-icon pine">
              <Home />
            </div>
            <div>
              <span>Home check</span>
              <strong>Doors closed</strong>
              <small>Kitchen and hall look settled</small>
            </div>
            <span className="source-badge">Simulated · 8:41</span>
          </article>
          <article className="status-card">
            <div className="status-card-icon mustard">
              <Lightbulb />
            </div>
            <div>
              <span>Path lighting</span>
              <strong>Ready at sunset</strong>
              <small>Hall and bathroom route</small>
            </div>
            <span className="source-badge">Simulated · 8:40</span>
          </article>
        </div>
        {fullCheckOpen && (
          <section className="panel-card home-check-detail" aria-label="Full simulated home check">
            <div>
              <ShieldCheck />
              <span>
                <strong>Entry points</strong>
                <small>Front and side doors reported closed.</small>
              </span>
            </div>
            <div>
              <Lightbulb />
              <span>
                <strong>Safe path</strong>
                <small>Hall and bathroom lighting routine is ready.</small>
              </span>
            </div>
            <p>Simulated home adapter · observed 8:41 AM · no live device is connected.</p>
          </section>
        )}

        <div className="two-column">
          <section className="panel-card">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">UP NEXT</span>
                <h2>Calendar</h2>
              </div>
              <span className="source-badge">Household calendar</span>
            </div>
            <div className="calendar-list">
              {state.calendar.map((item) => (
                <div key={item.id} className="calendar-row">
                  <span className={`calendar-icon ${item.kind}`}>
                    <CalendarDays />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.when}</small>
                  </span>
                  <MoreHorizontal />
                </div>
              ))}
            </div>
          </section>
          <section className="panel-card help-preview">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">YOUR CIRCLE</span>
                <h2>Help Board</h2>
              </div>
              <span className="count-pill">
                {state.helpRequests.filter((item) => item.state === 'open').length} open
              </span>
            </div>
            <p>Ask for ordinary help before it becomes a difficult day.</p>
            <button className="secondary-button" onClick={() => onNavigate('circle')}>
              <HandHeart /> Open Help Board
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

function AccessSurface({
  state,
  onChange,
  pending,
}: {
  state: HomeState;
  onChange: (changes: Partial<AccessPreferences>) => void;
  pending: boolean;
}) {
  const toggles: Array<{ key: keyof AccessPreferences; title: string; detail: string }> = [
    { key: 'reducedLoad', title: 'One Thing Mode', detail: 'Show one decision or task at a time.' },
    {
      key: 'highLegibility',
      title: 'High-legibility text',
      detail: 'Use clearer forms and stronger character distinction.',
    },
    {
      key: 'captions',
      title: 'Always show captions',
      detail: 'Mirror every spoken response on screen.',
    },
    {
      key: 'extraResponseTime',
      title: 'Extra response time',
      detail: 'Wait longer before asking again.',
    },
    {
      key: 'repeatInformation',
      title: 'Repeat key information',
      detail: 'Restate dates, names, and confirmed actions.',
    },
    {
      key: 'highContrast',
      title: 'Higher contrast',
      detail: 'Strengthen surface and control boundaries.',
    },
    { key: 'reducedMotion', title: 'Reduce motion', detail: 'Remove non-essential transitions.' },
  ];
  return (
    <>
      <PageIntro
        eyebrow="ACCESS THAT ADAPTS"
        title="Make STAY work your way."
        detail="These preferences change how information is spoken, shown, and paced. They never change your safety plan."
        icon={<Accessibility />}
      />
      <section className="panel-card preference-card">
        <h2>Preferred way to interact</h2>
        <div
          className="segmented-control"
          role="radiogroup"
          aria-label="Preferred interaction mode"
        >
          {(['voice-first', 'balanced', 'touch-first'] as const).map((mode) => (
            <button
              role="radio"
              aria-checked={state.access.interactionMode === mode}
              className={state.access.interactionMode === mode ? 'selected' : ''}
              onClick={() => onChange({ interactionMode: mode })}
              disabled={pending}
              key={mode}
            >
              {mode.replace('-', ' ')}
            </button>
          ))}
        </div>
      </section>
      <section className="panel-card preference-card">
        <h2>Text size</h2>
        <div className="segmented-control" role="radiogroup" aria-label="Text size">
          {(['default', 'large', 'extra-large'] as const).map((scale) => (
            <button
              role="radio"
              aria-checked={state.access.textScale === scale}
              className={state.access.textScale === scale ? 'selected' : ''}
              onClick={() => onChange({ textScale: scale })}
              disabled={pending}
              key={scale}
            >
              {scale.replace('-', ' ')}
            </button>
          ))}
        </div>
      </section>
      <section className="panel-card toggle-list">
        {toggles.map((item) => {
          const checked = Boolean(state.access[item.key]);
          return (
            <div className="toggle-row" key={item.key}>
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <button
                className={checked ? 'switch on' : 'switch'}
                role="switch"
                aria-checked={checked}
                aria-label={item.title}
                onClick={() => onChange({ [item.key]: !checked })}
                disabled={pending}
              >
                <span />
              </button>
            </div>
          );
        })}
      </section>
      <div className="safety-callout">
        <ShieldCheck />
        <p>
          <strong>Voice-only and touch-only both work.</strong>
          <br />
          Every critical action has a visible control, spoken confirmation, and accessible name.
        </p>
      </div>
    </>
  );
}

function WindowsSurface({
  state,
  demoStep,
  pending,
  onAction,
  onCreate,
}: {
  state: HomeState;
  demoStep: number;
  pending: boolean;
  onAction: (action: 'check-in' | 'close-early' | 'cancel', windowId: string) => void;
  onCreate: (input: CreateSafetyWindowInput) => Promise<boolean>;
}) {
  const window =
    (demoStep > 0
      ? state.safetyWindows.find((candidate) => candidate.id === 'window-morning')
      : undefined) ?? state.safetyWindows[0]!;
  const [selectedTemplate, setSelectedTemplate] = useState<SafetyWindowTemplate | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    startsAt: '',
    expectedBy: '',
    graceMinutes: '10',
  });
  const templates: Array<{
    id: SafetyWindowTemplate;
    title: string;
    detail: string;
  }> = [
    {
      id: 'arrived-home',
      title: 'Arrived home',
      detail: 'Confirm you are settled after a trip',
    },
    {
      id: 'medication-routine',
      title: 'Medication routine',
      detail: 'A neutral routine check—not a medical record',
    },
    { id: 'meal-check', title: 'Meal check', detail: 'A gentle everyday rhythm' },
    { id: 'custom', title: 'Custom window', detail: 'Choose the words and timing' },
  ];
  const beginSetup = (template: SafetyWindowTemplate, title: string) => {
    const startsAt = new Date(Date.now() + 15 * 60_000);
    const expectedBy = new Date(startsAt.getTime() + 30 * 60_000);
    setSelectedTemplate(template);
    setFormError(null);
    setForm({
      title: template === 'custom' ? 'My Safety Window' : title,
      startsAt: formatResidentDateTimeInput(startsAt, state.resident.timezone),
      expectedBy: formatResidentDateTimeInput(expectedBy, state.resident.timezone),
      graceMinutes: '10',
    });
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTemplate) return;
    setFormError(null);
    try {
      const created = await onCreate({
        title: form.title,
        template: selectedTemplate,
        startsAt: residentDateTimeToUtc(form.startsAt, state.resident.timezone),
        expectedBy: residentDateTimeToUtc(form.expectedBy, state.resident.timezone),
        graceMinutes: Number(form.graceMinutes),
        escalationMemberIds: ['member-maya', 'member-tom', 'member-james'],
      });
      if (created) setSelectedTemplate(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Choose another local time.');
    }
  };
  return (
    <>
      <PageIntro
        eyebrow="SAFETY WINDOWS"
        title="Check-ins with a plan, not surveillance."
        detail="A brief window asks for a simple response. Two deterministic checks happen before the Circle plan begins."
        icon={<Clock3 />}
      />
      <section className={`window-hero ${window.state === 'escalating' ? 'alert' : ''}`}>
        <div className="window-clock">
          <Clock3 />
          <span>
            {residentTime(window.expectedBy, state.resident.timezone)}
            <small>{state.resident.timezone.replaceAll('_', ' ')}</small>
          </span>
        </div>
        <div>
          <span className="eyebrow">
            {window.title.toUpperCase()} · {window.state.replaceAll('-', ' ')}
          </span>
          <h2>
            {demoStep >= 2
              ? 'Sarah’s Circle plan is active'
              : window.state === 'scheduled'
                ? `Starts at ${residentTime(window.startsAt, state.resident.timezone)}`
                : `Open until ${residentTime(window.expectedBy, state.resident.timezone)}`}
          </h2>
          <p>
            {window.checkAttempts === 0
              ? 'Say “I’m okay,” tap the check, or close early.'
              : `${window.checkAttempts} of 2 checks missed · ${window.graceMinutes}-minute grace period`}
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => onAction('check-in', window.id)}
          disabled={pending || !['open', 'first-check-missed', 'grace'].includes(window.state)}
        >
          <Check /> I’m okay
        </button>
      </section>
      <div className="window-secondary-actions" aria-label="Safety Window actions">
        <button
          className="text-button"
          onClick={() => onAction('close-early', window.id)}
          disabled={pending || window.state !== 'open'}
        >
          Close this window early
        </button>
        <button
          className="text-button destructive-text"
          onClick={() => onAction('cancel', window.id)}
          disabled={
            pending || !['scheduled', 'open', 'first-check-missed', 'grace'].includes(window.state)
          }
        >
          Cancel this window
        </button>
      </div>
      <section className="panel-card">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">AUDIT TRAIL</span>
            <h2>What happened</h2>
          </div>
          <span className="version-pill">v{window.version}</span>
        </div>
        <Timeline events={window.timeline} timezone={state.resident.timezone} />
      </section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">TEMPLATES</span>
          <h2>Build a familiar rhythm</h2>
        </div>
        <button className="text-button" onClick={() => beginSetup('custom', 'My Safety Window')}>
          <Plus /> New window
        </button>
      </div>
      {selectedTemplate && (
        <form className="panel-card window-form" onSubmit={(event) => void submit(event)}>
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">NEW SAFETY WINDOW</span>
              <h2>Choose the moment Sarah expects a check-in</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => setSelectedTemplate(null)}
              disabled={pending}
            >
              Close
            </button>
          </div>
          <div>
            <label htmlFor="window-title">Window name</label>
            <input
              id="window-title"
              value={form.title}
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              required
            />
          </div>
          <div>
            <label htmlFor="window-start">Starts</label>
            <input
              id="window-start"
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, startsAt: event.target.value }))
              }
              required
            />
          </div>
          <div>
            <label htmlFor="window-expected">Check in by</label>
            <input
              id="window-expected"
              type="datetime-local"
              value={form.expectedBy}
              onChange={(event) =>
                setForm((current) => ({ ...current, expectedBy: event.target.value }))
              }
              required
            />
          </div>
          <div>
            <label htmlFor="window-grace">Grace after the first missed check</label>
            <select
              id="window-grace"
              value={form.graceMinutes}
              onChange={(event) =>
                setForm((current) => ({ ...current, graceMinutes: event.target.value }))
              }
            >
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
            </select>
          </div>
          <p className="window-plan-note">
            Times use Sarah’s profile timezone: {state.resident.timezone.replaceAll('_', ' ')}.
            <br />
            If both checks are missed, STAY follows Sarah’s saved order: Maya, then Tom, then James.
            Changing that order requires a separate explicit confirmation.
          </p>
          {formError && (
            <p className="error-banner window-form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="form-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => setSelectedTemplate(null)}
              disabled={pending}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              <Clock3 /> {pending ? 'Scheduling…' : 'Schedule window'}
            </button>
          </div>
        </form>
      )}
      <div className="template-grid">
        {templates.map((template) => (
          <article className="template-card" key={template.id}>
            <Clock3 />
            <h3>{template.title}</h3>
            <p>{template.detail}</p>
            <button
              aria-label={`Set up ${template.title}`}
              onClick={() => beginSetup(template.id, template.title)}
              disabled={pending}
            >
              <ChevronRight />
            </button>
          </article>
        ))}
      </div>
    </>
  );
}

function CircleSurfaceView({
  state,
  active,
  onChange,
  onHelpAction,
  onCreateHelp,
  onIncidentAction,
  onRoutineSharing,
  pending,
  activeIncident,
}: {
  state: HomeState;
  active: CircleSurface;
  onChange: (surface: CircleSurface) => void;
  onHelpAction: (id: string) => void;
  onCreateHelp: (input: Pick<HelpRequest, 'title' | 'detail' | 'urgency'>) => Promise<boolean>;
  onIncidentAction: (action: 'escalate' | 'resolve') => void;
  onRoutineSharing: (enabled: boolean) => void;
  pending: boolean;
  activeIncident?: Incident;
}) {
  return (
    <>
      <PageIntro
        eyebrow="SARAH’S CIRCLE"
        title="Care is clearer when ownership is clear."
        detail="The Circle sees only what each person needs for their role and the current moment."
        icon={<UsersRound />}
      />
      <div className="subnav" role="navigation" aria-label="Circle navigation">
        {circleNavigation.map((item) => (
          <button
            key={item.id}
            className={active === item.id ? 'active' : ''}
            aria-current={active === item.id ? 'page' : undefined}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.id === 'incidents' && activeIncident ? <span>1</span> : null}
          </button>
        ))}
      </div>
      {active === 'overview' && (
        <CircleOverview state={state} onShowAll={() => onChange('people')} />
      )}
      {active === 'help' && (
        <HelpBoard
          state={state}
          onAction={onHelpAction}
          onCreate={onCreateHelp}
          pending={pending}
        />
      )}
      {active === 'incidents' && (
        <Incidents state={state} onAction={onIncidentAction} pending={pending} />
      )}
      {active === 'people' && <People state={state} />}
      {active === 'settings' && (
        <CircleSettings state={state} onRoutineSharing={onRoutineSharing} pending={pending} />
      )}
    </>
  );
}

function CircleOverview({ state, onShowAll }: { state: HomeState; onShowAll: () => void }) {
  return (
    <>
      <div className="metric-strip">
        <div>
          <span>Available now</span>
          <strong>
            {state.circle.filter((member) => member.availability === 'available').length}
          </strong>
          <small>of {state.circle.length} people</small>
        </div>
        <div>
          <span>Open requests</span>
          <strong>{state.helpRequests.filter((request) => request.state === 'open').length}</strong>
          <small>normal help</small>
        </div>
        <div>
          <span>Active incidents</span>
          <strong>
            {state.incidents.filter((incident) => incident.state !== 'resolved').length}
          </strong>
          <small>Circle-coordinated</small>
        </div>
      </div>
      <section className="panel-card">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">RIGHT NOW</span>
            <h2>Circle availability</h2>
          </div>
          <button className="text-button" onClick={onShowAll}>
            View everyone <ChevronRight />
          </button>
        </div>
        <div className="people-list">
          {state.circle.slice(0, 3).map((member) => (
            <PersonRow key={member.id} member={member} />
          ))}
        </div>
      </section>
    </>
  );
}

function HelpBoard({
  state,
  onAction,
  onCreate,
  pending,
}: {
  state: HomeState;
  onAction: (id: string) => void;
  onCreate: (input: Pick<HelpRequest, 'title' | 'detail' | 'urgency'>) => Promise<boolean>;
  pending: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [urgency, setUrgency] = useState<HelpRequest['urgency']>('normal');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !detail.trim()) return;
    if (await onCreate({ title: title.trim(), detail: detail.trim(), urgency })) {
      setTitle('');
      setDetail('');
      setUrgency('normal');
      setCreating(false);
    }
  };
  return (
    <>
      <div className="help-board-intro">
        <div>
          <h2>Ordinary help belongs here, too.</h2>
          <p>Requests are visible only to the people Sarah has chosen.</p>
        </div>
        <button className="primary-button" onClick={() => setCreating((value) => !value)}>
          <Plus /> New request
        </button>
      </div>
      {creating && (
        <form className="panel-card help-request-form" onSubmit={(event) => void submit(event)}>
          <div>
            <label htmlFor="help-title">What do you need?</label>
            <input
              id="help-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div>
            <label htmlFor="help-detail">Helpful detail</label>
            <textarea
              id="help-detail"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={500}
              required
            />
          </div>
          <div>
            <label htmlFor="help-urgency">Timing</label>
            <select
              id="help-urgency"
              value={urgency}
              onChange={(event) => setUrgency(event.target.value as HelpRequest['urgency'])}
            >
              <option value="normal">Normal</option>
              <option value="time-sensitive">Time-sensitive</option>
              <option value="urgent">Urgent Circle request</option>
            </select>
          </div>
          <div className="form-actions">
            <button type="button" className="text-button" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={pending}>
              Post to my Circle
            </button>
          </div>
          <small>
            This coordinates Sarah’s Circle only. It does not contact emergency services.
          </small>
        </form>
      )}
      <div className="request-grid">
        {state.helpRequests.map((request) => (
          <article className="request-card" key={request.id}>
            <div className="request-top">
              <span className={`urgency ${request.urgency}`}>{request.urgency}</span>
              <span>{request.createdAt.slice(11, 16)} UTC</span>
            </div>
            <h3>{request.title}</h3>
            <p>{request.detail}</p>
            <div className="request-foot">
              <span className="mini-avatars">
                <i>TA</i>
              </span>
              <span>
                {request.state === 'assigned'
                  ? 'Owned by Tom'
                  : request.state === 'completed'
                    ? 'Completed'
                    : 'Offered to Tom'}
              </span>
              <button
                onClick={() => onAction(request.id)}
                disabled={pending || ['completed', 'cancelled', 'declined'].includes(request.state)}
              >
                {request.state === 'assigned' ? 'Mark complete' : 'Tom accepts'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function Incidents({
  state,
  onAction,
  pending,
}: {
  state: HomeState;
  onAction: (action: 'escalate' | 'resolve') => void;
  pending: boolean;
}) {
  const incident = state.incidents[0];
  if (!incident)
    return (
      <div className="empty-state">
        <ShieldCheck />
        <h2>No active incidents</h2>
        <p>When a plan is active, ownership and every update appear here.</p>
      </div>
    );
  const member = state.circle.find((person) => person.id === incident.assignedMemberId);
  return (
    <>
      <section className="incident-card">
        <div className="incident-bar">
          <span className="pulse-ring" />
          <span>{incident.state}</span>
          <small>Opened {residentTime(incident.createdAt, state.resident.timezone)}</small>
        </div>
        <div className="incident-heading">
          <div>
            <span className="eyebrow">MISSED SAFETY WINDOW</span>
            <h2>{incident.title}</h2>
            <p>Circle coordination is active. STAY has not contacted emergency services.</p>
          </div>
          {member ? (
            <div className="responder-badge">
              <span className="avatar">{member.initials}</span>
              <span>
                <small>RESPONDER</small>
                <strong>{member.name}</strong>
                <em>On the way · simulated 7 min</em>
              </span>
            </div>
          ) : (
            <div className="awaiting-badge">
              <Clock3 /> Waiting for a responder
            </div>
          )}
        </div>
        <Timeline events={incident.timeline} timezone={state.resident.timezone} />
        <div className="incident-actions">
          <button
            className="secondary-button"
            onClick={() => onAction('escalate')}
            disabled={pending || !['active', 'coordinating', 'responding'].includes(incident.state)}
          >
            <PhoneCall /> Escalate Circle plan
          </button>
          <button
            className="secondary-button"
            onClick={() => onAction('resolve')}
            disabled={pending || !['responding', 'escalated'].includes(incident.state)}
          >
            <Check /> Resolve incident
          </button>
          <details className="incident-details">
            <summary>
              <Eye /> View authorized details
            </summary>
            <p>
              {incident.assignedMemberId
                ? 'The assigned responder can open Sarah’s incident-limited access note. The public fixture contains no address, key value, or precise location.'
                : 'Access instructions remain sealed until an authorized Circle member accepts this incident.'}
            </p>
          </details>
        </div>
      </section>
    </>
  );
}

function People({ state }: { state: HomeState }) {
  return (
    <section className="panel-card">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">ROLES & PRIORITY</span>
          <h2>People Sarah trusts</h2>
        </div>
        <span className="count-pill">{state.circle.length} trusted people</span>
      </div>
      <div className="people-list">
        {state.circle.map((member) => (
          <PersonRow key={member.id} member={member} detailed />
        ))}
      </div>
    </section>
  );
}

function CircleSettings({
  state,
  onRoutineSharing,
  pending,
}: {
  state: HomeState;
  onRoutineSharing: (enabled: boolean) => void;
  pending: boolean;
}) {
  return (
    <section className="panel-card toggle-list">
      <div className="toggle-row">
        <span>
          <strong>Share routine status</strong>
          <small>“Home,” “away,” or “resting”—never continuous tracking.</small>
        </span>
        <button
          className={state.privacy.routineSharing ? 'switch on' : 'switch'}
          role="switch"
          aria-checked={state.privacy.routineSharing}
          aria-label="Share routine status"
          onClick={() => onRoutineSharing(!state.privacy.routineSharing)}
          disabled={pending}
        >
          <span />
        </button>
      </div>
      <div className="toggle-row">
        <span>
          <strong>Let coordinators edit Safety Windows</strong>
          <small>Every change requires confirmation and stays in the audit trail.</small>
        </span>
        <span className="setting-status">Enabled by Sarah</span>
      </div>
      <div className="confirmation-row">
        <ShieldCheck />
        <span>
          <strong>Protected changes require Sarah’s confirmation</strong>
          <small>
            Escalation order, access instructions, location, and primary-contact removal.
          </small>
        </span>
      </div>
    </section>
  );
}

function PlaybooksSurface({
  state,
  onRun,
  onCreate,
  pending,
}: {
  state: HomeState;
  onRun: (id: string) => void;
  onCreate: (input: CreatePlaybookInput) => Promise<boolean>;
  pending: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState('');
  const icons = {
    'power-outage': Power,
    'water-leak': Droplets,
    'extreme-heat': ThermometerSun,
    'severe-weather': CloudSun,
    custom: ClipboardCheck,
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const planSteps = steps
      .split('\n')
      .map((step) => step.trim())
      .filter(Boolean);
    if (await onCreate({ title: title.trim(), steps: planSteps })) {
      setTitle('');
      setSteps('');
      setCreating(false);
    }
  };
  return (
    <>
      <PageIntro
        eyebrow="HOUSE PLAYBOOKS"
        title="A calm next step when the house is not calm."
        detail="Every provider card says whether it is live, simulated, or unavailable. The plan itself stays usable offline."
        icon={<BookHeart />}
      />
      <div className="section-heading">
        <div>
          <span className="eyebrow">RESIDENT-AUTHORED</span>
          <h2>Plans that fit Sarah’s home</h2>
        </div>
        <button
          className="secondary-button"
          onClick={() => setCreating((value) => !value)}
          aria-expanded={creating}
        >
          <Plus /> {creating ? 'Close form' : 'New custom plan'}
        </button>
      </div>
      {creating && (
        <form className="panel-card playbook-form" onSubmit={(event) => void submit(event)}>
          <div>
            <label htmlFor="playbook-title">Plan name</label>
            <input
              id="playbook-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div>
            <label htmlFor="playbook-steps">Steps, one per line</label>
            <textarea
              id="playbook-steps"
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
              placeholder={'Stay in the apartment\nAsk Maya to check the building notice'}
              required
            />
          </div>
          <small>
            Add 2–12 concise steps. This plan works without Bedrock or a connected provider.
          </small>
          <div className="form-actions">
            <button type="button" className="text-button" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={pending}>
              Save custom plan
            </button>
          </div>
        </form>
      )}
      <div className="playbook-grid">
        {state.playbooks.map((plan) => {
          const Icon = icons[plan.kind];
          const completed = plan.steps.filter((step) => step.completed).length;
          return (
            <article className="playbook-card" key={plan.id}>
              <div className="playbook-icon">
                <Icon />
              </div>
              <span className="source-badge">
                {plan.provenance.mode} ·{' '}
                {residentTime(plan.provenance.observedAt, state.resident.timezone)}
              </span>
              <h2>{plan.title}</h2>
              <p>{plan.steps[completed]?.label ?? 'Plan complete. Review the record.'}</p>
              <div className="playbook-progress">
                <span style={{ inlineSize: `${(completed / plan.steps.length) * 100}%` }} />
              </div>
              <div className="playbook-foot">
                <small>
                  {completed} of {plan.steps.length} steps
                </small>
                <button onClick={() => onRun(plan.id)} disabled={pending}>
                  {plan.state === 'ready' ? 'Start plan' : 'Next step'} <ChevronRight />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="provider-disclosure">
        <CloudSun />
        <span>
          <strong>Simulation boundary</strong>
          <small>
            Weather, outage, device, and maintenance observations are scripted demo adapters with
            visible timestamps. They are not live alerts.
          </small>
        </span>
      </div>
    </>
  );
}

function PrivacySurface({
  state,
  onChange,
  onRequestConfirmation,
  pending,
}: {
  state: HomeState;
  onChange: (input: PrivacyUpdateInput, confirmation?: ConfirmationToken) => Promise<boolean>;
  onRequestConfirmation: (purpose: ConfirmationPurpose) => Promise<ConfirmationToken | null>;
  pending: boolean;
}) {
  const [confirmation, setConfirmation] = useState<ConfirmationToken | null>(null);
  const privateTimeActive = Boolean(
    state.privacy.temporaryPrivateUntil &&
    new Date(state.privacy.temporaryPrivateUntil).getTime() > Date.now(),
  );
  const managePrivateTime = async () => {
    if (!privateTimeActive) {
      setConfirmation(null);
      await onChange({
        temporaryPrivateUntil: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });
      return;
    }
    if (!confirmation) {
      setConfirmation(await onRequestConfirmation('destructive-privacy-change'));
      return;
    }
    if (await onChange({ temporaryPrivateUntil: null }, confirmation)) setConfirmation(null);
  };
  return (
    <>
      <PageIntro
        eyebrow="PRIVACY CENTER"
        title="Sarah decides what is shared."
        detail="Temporary privacy can quiet routine sharing. It never hides help Sarah requests, an authorized active incident, or the security record."
        icon={<LockKeyhole />}
      />
      <div className="privacy-summary">
        <div className="privacy-shield">
          <ShieldCheck />
        </div>
        <div>
          <span className="eyebrow">CURRENT MODE</span>
          <h2>{privateTimeActive ? 'Routine sharing paused' : 'Everyday sharing'}</h2>
          <p>
            Location: {state.privacy.locationSharing.replace('-', ' ')} · Audit record: always on
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => void managePrivateTime()}
          disabled={pending}
        >
          {privateTimeActive
            ? confirmation
              ? 'Confirm end private time'
              : 'End private time'
            : 'Private for 2 hours'}
        </button>
      </div>
      {confirmation && (
        <div className="confirmation-callout" role="status">
          <ShieldCheck />
          <p>
            <strong>Confirm once to resume routine sharing.</strong>
            <br />
            Requested help, active authorized incidents, and audit records were never suppressed.
            This approval expires at {confirmation.expiresAt.slice(11, 16)} UTC.
          </p>
        </div>
      )}
      <section className="panel-card permission-matrix">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">SCOPED ACCESS</span>
            <h2>Who can see what</h2>
          </div>
        </div>
        <div className="matrix-row header">
          <span>Information</span>
          <span>Coordinator</span>
          <span>Nearby helper</span>
          <span>Aide</span>
        </div>
        <div className="matrix-row">
          <strong>Home status</strong>
          <span>
            <Check />
          </span>
          <span>Incident only</span>
          <span>
            <Check />
          </span>
        </div>
        <div className="matrix-row">
          <strong>Routine details</strong>
          <span>
            <Check />
          </span>
          <span>—</span>
          <span>
            <Check />
          </span>
        </div>
        <div className="matrix-row">
          <strong>Access instructions</strong>
          <span>Assigned incident</span>
          <span>Assigned incident</span>
          <span>—</span>
        </div>
        <div className="matrix-row">
          <strong>Audit record</strong>
          <span>
            <Check />
          </span>
          <span>Own actions</span>
          <span>Own actions</span>
        </div>
      </section>
    </>
  );
}

function MemorySurface({
  state,
  onSave,
  pending,
}: {
  state: HomeState;
  onSave: (
    input: Pick<HouseMemoryItem, 'label' | 'value' | 'category' | 'sensitivity'>,
    existing?: HouseMemoryItem,
  ) => Promise<boolean>;
  pending: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState<HouseMemoryItem['category']>('home');
  const [sensitivity, setSensitivity] = useState<HouseMemoryItem['sensitivity']>('routine');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const existing = editingId
      ? state.houseMemory.find((item) => item.id === editingId)
      : undefined;
    if (
      await onSave(
        {
          label: label.trim(),
          value: value.trim(),
          category,
          sensitivity,
        },
        existing,
      )
    ) {
      setLabel('');
      setValue('');
      setCategory('home');
      setSensitivity('routine');
      setEditingId(null);
      setCreating(false);
    }
  };
  const closeForm = () => {
    setCreating(false);
    setEditingId(null);
  };
  const edit = (item: HouseMemoryItem) => {
    setLabel(item.label);
    setValue(item.value);
    setCategory(item.category);
    setSensitivity(item.sensitivity);
    setEditingId(item.id);
    setCreating(true);
  };
  return (
    <>
      <PageIntro
        eyebrow="HOUSE MEMORY"
        title="Useful details, remembered on Sarah’s terms."
        detail="Sensitive and incident-only notes are filtered before Alexa or Bedrock receives any context."
        icon={<KeyRound />}
      />
      <div className="memory-grid">
        {state.houseMemory.map((item) => (
          <article className="memory-card" key={item.id}>
            <div>
              <span className={`sensitivity ${item.sensitivity}`}>
                {item.sensitivity.replace('-', ' ')}
              </span>
              <button
                className="icon-button small"
                aria-label={`Edit ${item.label}`}
                onClick={() => edit(item)}
              >
                <MoreHorizontal />
              </button>
            </div>
            <KeyRound />
            <h2>{item.label}</h2>
            <p>{item.value}</p>
            <small>Updated {item.updatedAt.slice(0, 10)}</small>
          </article>
        ))}
      </div>
      {creating && (
        <form className="panel-card memory-form" onSubmit={(event) => void submit(event)}>
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">{editingId ? 'EDIT DETAIL' : 'NEW DETAIL'}</span>
              <h2>{editingId ? 'Update this house detail' : 'Add a house detail'}</h2>
            </div>
          </div>
          <div>
            <label htmlFor="memory-label">Short label</label>
            <input
              id="memory-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div>
            <label htmlFor="memory-detail">House detail</label>
            <textarea
              id="memory-detail"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={800}
              required
            />
          </div>
          <div>
            <label htmlFor="memory-category">Category</label>
            <select
              id="memory-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as HouseMemoryItem['category'])}
            >
              <option value="home">Home</option>
              <option value="routine">Routine</option>
              <option value="maintenance">Maintenance</option>
              <option value="contact">Contact</option>
            </select>
          </div>
          <div>
            <label htmlFor="memory-sensitivity">Sharing boundary</label>
            <select
              id="memory-sensitivity"
              value={sensitivity}
              onChange={(event) =>
                setSensitivity(event.target.value as HouseMemoryItem['sensitivity'])
              }
            >
              <option value="routine">Routine</option>
              <option value="sensitive">Sensitive</option>
              <option value="incident-only">Assigned incident only</option>
            </select>
          </div>
          <small>
            Sensitive values stay out of Bedrock context. Incident-only details require an active,
            assigned incident before disclosure.
          </small>
          <div className="form-actions">
            <button type="button" className="text-button" onClick={closeForm}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {editingId ? 'Save changes' : 'Save house detail'}
            </button>
          </div>
        </form>
      )}
      <button
        className="secondary-button add-memory"
        onClick={() => {
          if (creating) {
            closeForm();
          } else {
            setLabel('');
            setValue('');
            setCategory('home');
            setSensitivity('routine');
            setEditingId(null);
            setCreating(true);
          }
        }}
        aria-expanded={creating}
      >
        <Plus /> {creating ? 'Close form' : 'Add a house detail'}
      </button>
    </>
  );
}

function PersonRow({
  member,
  detailed = false,
}: {
  member: HomeState['circle'][number];
  detailed?: boolean;
}) {
  return (
    <div className="person-row">
      <span className="avatar">{member.initials}</span>
      <span className="person-copy">
        <strong>{member.name}</strong>
        <small>{member.relationship}</small>
      </span>
      {detailed && <span className="role-pill">{member.role.replace('-', ' ')}</span>}
      <span className={`availability ${member.availability}`}>
        <i />
        {member.availability === 'responding' ? 'On the way' : member.availability}
        {member.availability === 'available' && <small> · ~{member.responseMinutes} min</small>}
      </span>
    </div>
  );
}

function Timeline({
  events,
  timezone,
}: {
  events: HomeState['safetyWindows'][number]['timeline'];
  timezone: string;
}) {
  return (
    <div className="timeline">
      {[...events].reverse().map((event, index) => (
        <div className="timeline-row" key={event.id}>
          <span className={index === 0 ? 'timeline-dot current' : 'timeline-dot'} />{' '}
          <span>
            <strong>{event.title}</strong>
            <small>{event.detail}</small>
          </span>
          <time dateTime={event.at}>{residentTime(event.at, timezone)}</time>
        </div>
      ))}
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  detail,
  icon,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <header className="page-intro">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      <span className="page-icon">{icon}</span>
    </header>
  );
}
