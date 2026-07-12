import { Button } from '@tether/ui/components/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@tether/ui/components/drawer';
import { Input } from '@tether/ui/components/input';
import { ScrollArea } from '@tether/ui/components/scroll-area';
import { cn } from '@tether/ui/lib/utils';
import { SendHorizontal, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { useViewportAspectRatio } from '@/hooks/use-viewport-aspect-ratio';

import { useChatAutoScroll } from '../hooks/use-chat-auto-scroll';

export function ChatDrawer({
  open,
  onOpenChange,
  onSendMessage,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSendMessage: (message: string) => boolean;
}) {
  const view = useAtomValue(peerSessionViewAtom);
  const [draft, setDraft] = useState('');
  const messageListEndRef = useRef<HTMLDivElement>(null);
  const aspectRatio = useViewportAspectRatio();
  const messageCount = view.messages.length;
  const canChat = view.status === 'connected' && view.chatReady;
  useChatAutoScroll(messageListEndRef, open, messageCount);
  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (message.length > 0 && canChat && onSendMessage(message)) setDraft('');
  };

  return (
    <Drawer
      direction={aspectRatio < 1 ? 'bottom' : 'right'}
      open={open}
      onOpenChange={onOpenChange}
    >
      <DrawerContent>
        <DrawerHeader className='relative shrink-0 border-b pr-14'>
          <DrawerTitle className='font-mono text-xs tracking-[0.2em] uppercase'>Chat</DrawerTitle>
          <DrawerDescription>
            Messages go straight to the other person and disappear when the call ends.
          </DrawerDescription>
          <DrawerClose
            render={
              <Button
                aria-label='Close chat'
                variant='ghost'
                size='icon-sm'
                className='absolute top-3 right-3'
              />
            }
          >
            <X />
          </DrawerClose>
        </DrawerHeader>
        <ScrollArea className='min-h-0 flex-1'>
          <div className='min-h-full p-4'>
            {view.messages.length === 0 ? (
              <p className='text-muted-foreground mt-8 text-center text-sm'>
                No messages yet. Say hello once you are connected.
              </p>
            ) : (
              <ol className='space-y-4' aria-label='Chat messages'>
                {view.messages.map((message) => (
                  <li key={message.id} className='grid grid-cols-[3rem_1fr] gap-3'>
                    <span
                      className={cn(
                        'pt-0.5 text-right font-mono text-[10px] tracking-[0.15em] uppercase',
                        message.sender === 'self' ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {message.sender === 'self' ? 'you' : 'peer'}
                    </span>
                    <p className='border-border min-w-0 border-l pl-3 text-sm wrap-anywhere whitespace-pre-wrap'>
                      {message.text}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <div ref={messageListEndRef} aria-hidden />
          </div>
        </ScrollArea>
        <form className='flex shrink-0 gap-2 border-t p-4' onSubmit={handleSubmit}>
          <Input
            aria-label='Message'
            disabled={!canChat}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={canChat ? 'Write a message' : 'Chat is unavailable…'}
            value={draft}
          />
          <Button
            aria-label='Send message'
            disabled={!canChat || draft.trim().length === 0}
            size='icon'
            type='submit'
          >
            <SendHorizontal />
          </Button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
import { useAtomValue } from '@effect/atom-react';
import { peerSessionViewAtom } from '@tether/client-runtime/modules/room';
