import '@fontsource-variable/atkinson-hyperlegible-next';
import { Check, Clock3, Navigation, ShieldCheck } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './widget.css';

interface WidgetPayload {
  kind?: 'status' | 'incident' | 'setup' | 'playbook';
  title?: string;
  detail?: string;
  status?: string;
  responder?: string;
  etaMinutes?: number;
  provenance?: { mode: string; provider: string; observedAt: string };
}

const fallback: WidgetPayload = {
  kind: 'status',
  title: 'Your home is settled.',
  detail: 'Your one thing is to put the blue recycling bin out.',
  status: 'Ready',
  provenance: {
    mode: 'simulated',
    provider: 'STAY preview fixture',
    observedAt: new Date().toISOString(),
  },
};

function Widget() {
  const [payload, setPayload] = useState<WidgetPayload>(fallback);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const structured = event.data?.structuredContent;
      const entity = structured?.data?.entity ?? structured?.data;
      if (!structured) return;
      setPayload({
        kind: structured.resourceUri?.split('/')[3] ?? 'status',
        title: entity?.timeline?.at?.(-1)?.title ?? entity?.title ?? fallback.title,
        detail: event.data?.content?.[0]?.text ?? fallback.detail,
        status: entity?.state ?? 'Current',
        ...(entity?.assignedMemberId ? { responder: 'Tom', etaMinutes: 7 } : {}),
        provenance: structured.provenance,
      });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  return (
    <main className={`widget widget-${payload.kind}`}>
      <header>
        <span className="widget-mark">S</span>
        <span>STAY</span>
        <span className="widget-state">
          <i /> {payload.status}
        </span>
      </header>
      <section>
        <span className="eyebrow">
          {payload.kind === 'incident' ? 'CIRCLE UPDATE' : 'FOR SARAH'}
        </span>
        <h1>{payload.title}</h1>
        <p>{payload.detail}</p>
        {payload.responder ? (
          <div className="arrival">
            <Navigation />
            <span>
              <strong>
                {payload.responder} · about {payload.etaMinutes} min
              </strong>
              <small>Travel estimate is simulated</small>
            </span>
          </div>
        ) : (
          <div className="settled">
            <Check /> No action is needed right now.
          </div>
        )}
      </section>
      <footer>
        <ShieldCheck />
        <span>
          {payload.provenance?.mode ?? 'simulated'} ·{' '}
          {payload.provenance?.provider ?? 'STAY preview'}
        </span>
        <Clock3 />
        <time>{payload.provenance?.observedAt?.slice(11, 16) ?? '--:--'}</time>
      </footer>
    </main>
  );
}

const target = document.getElementById('root');
if (target) createRoot(target).render(<Widget />);

export { Widget };
