import type { ComponentProps } from 'react';

export function MediaStreamVideo({
  stream,
  ...props
}: Omit<ComponentProps<'video'>, 'ref'> & { readonly stream: MediaStream | null }) {
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- local camera previews have no audio content
    <video
      {...props}
      ref={(element) => {
        if (element === null) return;
        element.srcObject = stream;
        return () => {
          if (element.srcObject === stream) element.srcObject = null;
        };
      }}
    />
  );
}
