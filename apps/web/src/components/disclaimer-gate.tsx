import { Link, useLocation } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import { DISCLAIMER_ACCEPTED_KEY } from '@/lib/constants';

function readAccepted() {
  try {
    return localStorage.getItem(DISCLAIMER_ACCEPTED_KEY) === 'true';
  } catch {
    return false;
  }
}

function PanelLabel({ children }: { readonly children: string }) {
  return (
    <p className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
      {children}
    </p>
  );
}

export function DisclaimerGate({ children }: { readonly children: ReactNode }) {
  const [accepted, setAccepted] = useState(readAccepted);
  const { pathname } = useLocation();

  // Terms stay readable before acceptance — the gate itself links there.
  if (accepted || pathname === '/terms') {
    return children;
  }

  const accept = () => {
    try {
      localStorage.setItem(DISCLAIMER_ACCEPTED_KEY, 'true');
    } catch {
      // Private-mode storage failure: accept for this session anyway.
    }
    setAccepted(true);
  };

  return (
    <div className='grid min-h-full place-items-center px-8 py-16'>
      <div className='w-full max-w-lg space-y-8 border-y py-10'>
        <div className='space-y-3'>
          <PanelLabel>00 — before you begin</PanelLabel>
          <h1 className='text-3xl tracking-tight'>Before you use Tether</h1>
        </div>

        <div className='text-muted-foreground space-y-4 text-sm leading-6'>
          <p>Tether is an experimental project, provided as-is and without warranty of any kind.</p>
          <p>
            The server coordinates admission and connection setup, then disconnects after a call
            becomes direct. Call content is peer-to-peer and encrypted, and the operator keeps no
            call history.
          </p>
          <p>
            You are solely responsible for your use of the service and for the content of your
            calls. Unlawful use is prohibited.
          </p>
          <p>
            The operator is not liable for any damages, losses, or issues arising from use of the
            service.
          </p>
          <p>
            See the{' '}
            <Link to='/terms' className='hover:text-primary underline'>
              Terms &amp; Acceptable Use
            </Link>{' '}
            for the full terms.
          </p>
        </div>

        <button
          type='button'
          onClick={accept}
          className='border-border hover:border-primary hover:text-primary w-full border px-6 py-2.5 text-sm tracking-wide uppercase transition-colors sm:w-auto'
        >
          I understand and accept
        </button>
      </div>
    </div>
  );
}
