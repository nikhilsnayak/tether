import { Link, createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { LogoMark } from '@/components/logo';

export const Route = createFileRoute('/terms')({
  component: TermsPage,
});

const ABUSE_EMAIL = 'nikhilsnayak3473@gmail.com';
const ISSUES_URL = 'https://github.com/nikhilsnayak/tether/issues';
const LAST_UPDATED = '7 July 2026';

function PanelLabel({ children }: { readonly children: string }) {
  return (
    <p className='text-muted-foreground font-mono text-xs tracking-[0.2em] whitespace-nowrap uppercase'>
      {children}
    </p>
  );
}

function Section({
  index,
  title,
  children,
}: {
  readonly index: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className='grid gap-x-6 gap-y-3 py-8 sm:grid-cols-[3rem_1fr]'>
      <span className='text-muted-foreground font-mono text-xs tracking-[0.2em] sm:col-start-1 sm:row-start-1 sm:self-baseline'>
        {index}
      </span>
      <h2 className='text-xl tracking-tight sm:col-start-2 sm:row-start-1 sm:self-baseline'>
        {title}
      </h2>
      <div className='text-muted-foreground space-y-3 text-base leading-7 sm:col-start-2 sm:row-start-2'>
        {children}
      </div>
    </section>
  );
}

function TermsPage() {
  return (
    <div className='grid grid-rows-[auto_1fr]'>
      <header className='flex items-center justify-between px-8 py-6'>
        <Link to='/' className='flex items-center gap-2.5'>
          <LogoMark className='size-5' />
          <span className='font-medium tracking-tight'>tether</span>
        </Link>
        <span className='text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase'>
          terms / acceptable use
        </span>
      </header>

      <main className='mx-auto w-full max-w-4xl px-8 pb-20'>
        <div className='space-y-3 py-10'>
          <PanelLabel>00</PanelLabel>
          <h1 className='text-3xl tracking-tight sm:text-4xl'>Terms &amp; Acceptable Use</h1>
          <p className='text-muted-foreground max-w-xl pt-1 text-base leading-7'>
            Plain-language terms for an experimental project. This is a good-faith baseline, not
            legal advice.
          </p>
        </div>

        <div className='divide-border divide-y border-y'>
          <Section index='01' title='What Tether is'>
            <p>
              Tether is an experimental project for private 1:1 video calls. It is provided as-is,
              with no warranty of any kind and no commitment to uptime or support. It may change or
              go away at any time.
            </p>
          </Section>

          <Section index='02' title='How it handles data'>
            <p>
              The server relays only signaling: room membership, SDP, and ICE messages. Audio,
              video, and chat are peer-to-peer and encrypted; they travel directly between callers
              and never reach the operator.
            </p>
            <p>
              Rooms and signaling state are held in memory and discarded when callers leave. There
              are no accounts, no call history, and no message database.
            </p>
          </Section>

          <Section index='03' title='Acceptable use'>
            <p>
              You must not use Tether for any unlawful purpose, for harassment, or to infringe the
              rights of others. You are solely responsible for how you use the service and for the
              content of your calls.
            </p>
            <p>Access may be limited or withdrawn at any time, for any reason.</p>
          </Section>

          <Section index='04' title='Liability'>
            <p>
              To the maximum extent permitted by law, the operator is not liable for any damages or
              losses arising from your use of the service.
            </p>
          </Section>

          <Section index='05' title='Abuse reports'>
            <p>
              To report abuse, email{' '}
              <a href={`mailto:${ABUSE_EMAIL}`} className='hover:text-primary underline'>
                {ABUSE_EMAIL}
              </a>{' '}
              or open an issue at{' '}
              <a
                href={ISSUES_URL}
                target='_blank'
                rel='noreferrer'
                className='hover:text-primary underline'
              >
                the project repository
              </a>
              .
            </p>
            <p>
              Because Tether keeps no call history, a report should include the room code and the
              approximate time. The operator cannot review or take down past calls; enforcement is
              limited to forward-looking measures such as restricting access.
            </p>
          </Section>

          <Section index='06' title='Changes'>
            <p>
              These terms may change. Continued use of the service is acceptance of the current
              terms.
            </p>
            <p className='font-mono text-xs tracking-[0.2em] uppercase'>
              Last updated: {LAST_UPDATED}
            </p>
          </Section>
        </div>

        <p className='mt-8'>
          <Link
            to='/'
            className='text-muted-foreground hover:text-primary font-mono text-xs tracking-[0.2em] uppercase'
          >
            ← back to tether
          </Link>
        </p>
      </main>
    </div>
  );
}
