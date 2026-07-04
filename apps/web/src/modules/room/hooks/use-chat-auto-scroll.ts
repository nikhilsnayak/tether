import { useEffect, type RefObject } from 'react';

export function useChatAutoScroll(
  messageListEndRef: RefObject<HTMLDivElement | null>,
  chatOpen: boolean,
  messageCount: number,
) {
  useEffect(() => {
    if (chatOpen) {
      messageListEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [chatOpen, messageCount, messageListEndRef]);
}
