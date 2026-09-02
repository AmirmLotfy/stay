'use client';

import type { ActorContext, Incident } from '@stay/contracts';
import { createDemoState, StayDomainError, StayEngine, type HomeState } from '@stay/domain';
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

export default function StayApp() {
  const engine = useRef(new StayEngine());
  const [state, setState] = useState<HomeState>(() => createDemoState());
  const [surface, setSurface] = useState<Surface>('home');
  const [circleSurface, setCircleSurface] = useState<CircleSurface>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [demoStep, setDemoStep] = useState(0);
  const [notice, setNotice] = useState('Your home is settled. Sarah is in control.');
  const [transcript, setTranscript] = useState<Array<{ from: 'resident' | 'stay'; text: string }>>([
    { from: 'resident', text: 'Alexa, open STAY.' },
    {
      from: 'stay',
      text: 'Good morning, Sarah. Your home is settled. You have one thing to remember.',
    },
  ]);
  const [phrase, setPhrase] = useState('');
  const [sessionLabel, setSessionLabel] = useState('Starting isolated demo…');
  const [ready, setReady] = useState(false);
  const [runtimeConfig, setRuntimeConfig] = useState<StayRuntimeConfig | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(() => setState(engine.current.snapshot()), []);

  useEffect(() => {
    const key = 'stay-demo-session-v1';
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as { id: string; expiresAt: string };
      if (new Date(parsed.expiresAt).getTime() > Date.now()) {
        setSessionLabel(`Isolated demo · ${parsed.id.slice(-5)}`);
        return;
      }
    }
    const session = {
      id: uid('demo'),
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    };
    window.localStorage.setItem(key, JSON.stringify(session));
    setSessionLabel(`Isolated demo · ${session.id.slice(-5)}`);
  }, []);

  useEffect(() => {
    if (sessionLabel !== 'Starting isolated demo…') setReady(true);
  }, [sessionLabel]);

  useEffect(() => {
    void loadRuntimeConfig()
      .then(async (config) => {
        if (!config) return;
        setRuntimeConfig(config);
        setAuthenticated((await completeSignIn(config)) || hasAuthenticatedSession());
      })
      .catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : 'Sign-in setup is unavailable.');
      });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const run = useCallback(
    (operation: () => void) => {
      setLastError(null);
      try {
        operation();
        refresh();
      } catch (error) {
        setLastError(
          error instanceof StayDomainError ? error.message : 'That action could not be completed.',
        );
      }
    },
    [refresh],
  );

  const runProtectedDemo = useCallback(() => {
    const window = engine.current.snapshot().safetyWindows[0];
    if (!window) return;
    if (demoStep === 0) {
      run(() => {
        engine.current.markSafetyWindowMissed(window.id, {
          actor: residentActor,
          idempotencyKey: uid('window-check-one'),
          expectedVersion: window.version,
        });
      });
      setNotice('Sarah did not answer the first check. STAY will try once more in 10 minutes.');
      setTranscript((items) => [
        ...items,
        { from: 'stay', text: 'Sarah, your Morning Window is still open. Are you okay?' },
      ]);
      setDemoStep(1);
      return;
    }
    if (demoStep === 1) {
      run(() => {
        const missed = engine.current.markSafetyWindowMissed(window.id, {
          actor: residentActor,
          idempotencyKey: uid('window-check-two'),
          expectedVersion: window.version,
        });
        engine.current.activateMissedWindowIncident(window.id, {
          actor: residentActor,
          idempotencyKey: uid('incident-activate'),
          expectedVersion: missed.entity.version,
        });
      });
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
      run(() => {
        engine.current.offerIncidentToMember(incident.id, 'member-tom', {
          actor: residentActor,
          idempotencyKey: uid('ask-tom'),
          expectedVersion: incident.version,
        });
      });
      setNotice('Sarah asked Tom, her nearby helper. Only the minimum incident detail was shared.');
      setTranscript((items) => [
        ...items,
        { from: 'resident', text: 'Ask Tom to check on me.' },
        { from: 'stay', text: 'I asked Tom. I’ll let your Circle know when he responds.' },
      ]);
      setDemoStep(3);
      return;
    }
    if (demoStep === 3) {
      run(() => {
        engine.current.acceptIncident(incident.id, 'member-tom', {
          actor: residentActor,
          idempotencyKey: uid('tom-accepts'),
          expectedVersion: incident.version,
        });
      });
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
    engine.current.reset();
    refresh();
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
  }, [demoStep, refresh, run]);

  const submitPhrase = (event: FormEvent) => {
    event.preventDefault();
    const clean = phrase.trim();
    if (!clean) return;
    const normalized = clean.toLowerCase();
    let reply =
      'I can help with your home, Safety Windows, Circle, plans, privacy, or House Memory.';
    if (normalized.includes('help') || normalized.includes('emergency')) {
      reply =
        'STAY can coordinate your preconfigured Circle. It does not contact emergency services or replace Alexa Emergency Assist. Should I ask your Circle now?';
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

  return (
    <main className="app-shell" data-ready={ready}>
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
          <div className="live-status">
            <span className="status-dot" /> <span>Home settled</span>
          </div>
          <div className="topbar-actions">
            <span className="provenance-label">
              <CircleDot /> Public demo · simulated providers labeled
            </span>
            {runtimeConfig && (
              <button
                className="auth-button"
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
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              {theme === 'light' ? <Moon /> : <Sun />}
            </button>
            <button className="icon-button" aria-label="Notifications">
              <BellRing />
              <span className="notification-dot" />
            </button>
          </div>
        </header>

        <div className="content-grid" id="main-content">
          <section className="main-panel" aria-live="polite">
            {lastError && (
              <div className="error-banner" role="alert">
                {lastError}
              </div>
            )}
            {surface === 'home' && <HomeSurface state={state} onNavigate={setSurface} />}
            {surface === 'access' && (
              <AccessSurface
                state={state}
                onChange={(next) => setState({ ...state, access: next })}
              />
            )}
            {surface === 'windows' && <WindowsSurface state={state} demoStep={demoStep} />}
            {surface === 'circle' && (
              <CircleSurfaceView
                state={state}
                active={circleSurface}
                onChange={setCircleSurface}
                {...(activeIncident ? { activeIncident } : {})}
              />
            )}
            {surface === 'playbooks' && (
              <PlaybooksSurface
                state={state}
                onRun={(id) =>
                  run(() => {
                    const item = engine.current.snapshot().playbooks.find((plan) => plan.id === id);
                    if (item)
                      engine.current.executePlaybook(id, {
                        actor: residentActor,
                        idempotencyKey: uid('playbook'),
                        expectedVersion: item.version,
                      });
                  })
                }
              />
            )}
            {surface === 'privacy' && <PrivacySurface state={state} onChange={setState} />}
            {surface === 'memory' && <MemorySurface state={state} />}
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
                onClick={runProtectedDemo}
                disabled={!ready}
              >
                {demoStep === 4 ? <RefreshCw /> : <Play />} {demoLabel}
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
                    <button className="echo-action">Tell me more</button>
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
                  disabled={!ready}
                />
                <button aria-label="Send phrase" disabled={!ready}>
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
}: {
  state: HomeState;
  onNavigate: (surface: Surface) => void;
}) {
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

      <section className="one-thing-card">
        <div className="pin-icon">
          <ClipboardCheck />
        </div>
        <div className="one-thing-copy">
          <span className="eyebrow">YOUR ONE THING</span>
          <h2>{state.oneThing.title}</h2>
          <p>{state.oneThing.detail}</p>
        </div>
        <button className="round-check" aria-label="Mark the recycling reminder complete">
          <Check />
        </button>
      </section>

      <div className="section-heading">
        <div>
          <span className="eyebrow">A QUIET OVERVIEW</span>
          <h2>Today at home</h2>
        </div>
        <button className="text-button">
          Full home check <ChevronRight />
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

      <div className="two-column">
        <section className="panel-card">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">UP NEXT</span>
              <h2>Calendar</h2>
            </div>
            <button className="icon-button small" aria-label="Add calendar item">
              <Plus />
            </button>
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
    </>
  );
}

function AccessSurface({
  state,
  onChange,
}: {
  state: HomeState;
  onChange: (next: HomeState['access']) => void;
}) {
  const toggles: Array<{ key: keyof HomeState['access']; title: string; detail: string }> = [
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
              onClick={() => onChange({ ...state.access, interactionMode: mode })}
              key={mode}
            >
              {mode.replace('-', ' ')}
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
                onClick={() => onChange({ ...state.access, [item.key]: !checked })}
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

function WindowsSurface({ state, demoStep }: { state: HomeState; demoStep: number }) {
  const window = state.safetyWindows[0]!;
  const templates = [
    ['Arrived home', 'Confirm you are settled after a trip'],
    ['Medication routine', 'A neutral routine check—not a medical record'],
    ['Meal check', 'A gentle everyday rhythm'],
    ['Custom window', 'Choose the words, timing, and Circle plan'],
  ];
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
            {window.expectedBy.slice(11, 16)}
            <small>UTC</small>
          </span>
        </div>
        <div>
          <span className="eyebrow">MORNING CHECK-IN · {window.state.replaceAll('-', ' ')}</span>
          <h2>{demoStep >= 2 ? 'Sarah’s Circle plan is active' : 'Open until 6:30 AM'}</h2>
          <p>
            {window.checkAttempts === 0
              ? 'Say “I’m okay,” tap the check, or close early.'
              : `${window.checkAttempts} of 2 checks missed · ${window.graceMinutes}-minute grace period`}
          </p>
        </div>
        <button className="secondary-button">
          <Check /> I’m okay
        </button>
      </section>
      <section className="panel-card">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">AUDIT TRAIL</span>
            <h2>What happened</h2>
          </div>
          <span className="version-pill">v{window.version}</span>
        </div>
        <Timeline events={window.timeline} />
      </section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">TEMPLATES</span>
          <h2>Build a familiar rhythm</h2>
        </div>
        <button className="text-button">
          <Plus /> New window
        </button>
      </div>
      <div className="template-grid">
        {templates.map(([title, detail]) => (
          <article className="template-card" key={title}>
            <Clock3 />
            <h3>{title}</h3>
            <p>{detail}</p>
            <button aria-label={`Set up ${title}`}>
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
  activeIncident,
}: {
  state: HomeState;
  active: CircleSurface;
  onChange: (surface: CircleSurface) => void;
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
      {active === 'overview' && <CircleOverview state={state} />}
      {active === 'help' && <HelpBoard state={state} />}
      {active === 'incidents' && <Incidents state={state} />}
      {active === 'people' && <People state={state} />}
      {active === 'settings' && <CircleSettings />}
    </>
  );
}

function CircleOverview({ state }: { state: HomeState }) {
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
          <button className="text-button">
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

function HelpBoard({ state }: { state: HomeState }) {
  return (
    <>
      <div className="help-board-intro">
        <div>
          <h2>Ordinary help belongs here, too.</h2>
          <p>Requests are visible only to the people Sarah has chosen.</p>
        </div>
        <button className="primary-button">
          <Plus /> New request
        </button>
      </div>
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
              <span>Offered to Tom</span>
              <button>Respond</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function Incidents({ state }: { state: HomeState }) {
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
          <small>Opened {incident.createdAt.slice(11, 16)} UTC</small>
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
        <Timeline events={incident.timeline} />
        <div className="incident-actions">
          <button className="secondary-button">
            <PhoneCall /> Contact Circle
          </button>
          <button className="secondary-button">
            <Eye /> View authorized details
          </button>
          <button className="text-button">Escalation plan</button>
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
        <button className="primary-button small">
          <Plus /> Invite
        </button>
      </div>
      <div className="people-list">
        {state.circle.map((member) => (
          <PersonRow key={member.id} member={member} detailed />
        ))}
      </div>
    </section>
  );
}

function CircleSettings() {
  return (
    <section className="panel-card toggle-list">
      <div className="toggle-row">
        <span>
          <strong>Share routine status</strong>
          <small>“Home,” “away,” or “resting”—never continuous tracking.</small>
        </span>
        <button className="switch on" role="switch" aria-checked="true">
          <span />
        </button>
      </div>
      <div className="toggle-row">
        <span>
          <strong>Let coordinators edit Safety Windows</strong>
          <small>Every change requires confirmation and stays in the audit trail.</small>
        </span>
        <button className="switch on" role="switch" aria-checked="true">
          <span />
        </button>
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

function PlaybooksSurface({ state, onRun }: { state: HomeState; onRun: (id: string) => void }) {
  const icons = {
    'power-outage': Power,
    'water-leak': Droplets,
    'extreme-heat': ThermometerSun,
    'severe-weather': CloudSun,
    custom: ClipboardCheck,
  };
  return (
    <>
      <PageIntro
        eyebrow="HOUSE PLAYBOOKS"
        title="A calm next step when the house is not calm."
        detail="Every provider card says whether it is live, simulated, or unavailable. The plan itself stays usable offline."
        icon={<BookHeart />}
      />
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
                {plan.provenance.mode} · {plan.provenance.observedAt.slice(11, 16)}
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
                <button onClick={() => onRun(plan.id)}>
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
}: {
  state: HomeState;
  onChange: (state: HomeState) => void;
}) {
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
          <h2>
            {state.privacy.temporaryPrivateUntil ? 'Routine sharing paused' : 'Everyday sharing'}
          </h2>
          <p>
            Location: {state.privacy.locationSharing.replace('-', ' ')} · Audit record: always on
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() =>
            onChange(
              state.privacy.temporaryPrivateUntil
                ? {
                    ...state,
                    privacy: {
                      routineSharing: state.privacy.routineSharing,
                      locationSharing: state.privacy.locationSharing,
                      auditRetention: true,
                    },
                  }
                : {
                    ...state,
                    privacy: {
                      ...state.privacy,
                      temporaryPrivateUntil: new Date(
                        Date.now() + 2 * 60 * 60 * 1000,
                      ).toISOString(),
                    },
                  },
            )
          }
        >
          {state.privacy.temporaryPrivateUntil ? 'End private time' : 'Private for 2 hours'}
        </button>
      </div>
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

function MemorySurface({ state }: { state: HomeState }) {
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
              <button className="icon-button small" aria-label={`More options for ${item.label}`}>
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
      <button className="secondary-button add-memory">
        <Plus /> Add a house detail
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
      <ChevronRight />
    </div>
  );
}

function Timeline({ events }: { events: HomeState['safetyWindows'][number]['timeline'] }) {
  return (
    <div className="timeline">
      {[...events].reverse().map((event, index) => (
        <div className="timeline-row" key={event.id}>
          <span className={index === 0 ? 'timeline-dot current' : 'timeline-dot'} />{' '}
          <span>
            <strong>{event.title}</strong>
            <small>{event.detail}</small>
          </span>
          <time>{event.at.slice(11, 16)}</time>
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
