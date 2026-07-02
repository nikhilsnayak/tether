'use client';

import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import { cn } from '@tether/ui/lib/utils';
import * as React from 'react';

type DrawerDirection = 'top' | 'right' | 'bottom' | 'left';

const swipeDirection = {
  top: 'up',
  right: 'right',
  bottom: 'down',
  left: 'left',
} as const;

function Drawer({
  direction = 'bottom',
  ...props
}: DrawerPrimitive.Root.Props & {
  readonly direction?: DrawerDirection;
}) {
  return (
    <DrawerPrimitive.Root
      data-slot='drawer'
      swipeDirection={swipeDirection[direction]}
      {...props}
    />
  );
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot='drawer-trigger' {...props} />;
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot='drawer-close' {...props} />;
}

function DrawerPortal(props: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot='drawer-portal' {...props} />;
}

function DrawerOverlay({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot='drawer-overlay'
      className={cn(
        'fixed inset-0 z-50 bg-black/40 opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Viewport className='pointer-events-none fixed inset-0 z-50'>
        <DrawerPrimitive.Popup
          data-slot='drawer-content'
          className={cn(
            'group/drawer pointer-events-auto fixed z-50 flex flex-col overflow-hidden bg-popover text-sm text-popover-foreground shadow-lg transition-transform duration-300 ease-out',
            'data-[swipe-direction=down]:inset-x-0 data-[swipe-direction=down]:bottom-0 data-[swipe-direction=down]:h-[min(85dvh,44rem)] data-[swipe-direction=down]:rounded-t-xl data-[swipe-direction=down]:border-t data-[swipe-direction=down]:translate-y-(--drawer-swipe-movement-y) data-[swipe-direction=down]:data-ending-style:translate-y-full data-[swipe-direction=down]:data-starting-style:translate-y-full',
            'data-[swipe-direction=up]:inset-x-0 data-[swipe-direction=up]:top-0 data-[swipe-direction=up]:h-[min(85dvh,44rem)] data-[swipe-direction=up]:rounded-b-xl data-[swipe-direction=up]:border-b data-[swipe-direction=up]:translate-y-(--drawer-swipe-movement-y) data-[swipe-direction=up]:data-ending-style:-translate-y-full data-[swipe-direction=up]:data-starting-style:-translate-y-full',
            'data-[swipe-direction=right]:inset-y-0 data-[swipe-direction=right]:right-0 data-[swipe-direction=right]:h-full data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-md data-[swipe-direction=right]:border-l data-[swipe-direction=right]:translate-x-(--drawer-swipe-movement-x) data-[swipe-direction=right]:data-ending-style:translate-x-full data-[swipe-direction=right]:data-starting-style:translate-x-full',
            'data-[swipe-direction=left]:inset-y-0 data-[swipe-direction=left]:left-0 data-[swipe-direction=left]:h-full data-[swipe-direction=left]:w-full data-[swipe-direction=left]:max-w-md data-[swipe-direction=left]:border-r data-[swipe-direction=left]:translate-x-(--drawer-swipe-movement-x) data-[swipe-direction=left]:data-ending-style:-translate-x-full data-[swipe-direction=left]:data-starting-style:-translate-x-full',
            className,
          )}
          {...props}
        >
          <div className='bg-muted mx-auto mt-3 hidden h-1.5 w-12 shrink-0 rounded-full group-data-[swipe-direction=down]/drawer:block' />
          <DrawerPrimitive.Content className='flex min-h-0 flex-1 flex-col'>
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='drawer-header'
      className={cn('flex flex-col gap-0.5 p-4', className)}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='drawer-footer'
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot='drawer-title'
      className={cn('font-heading text-base font-medium text-foreground', className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot='drawer-description'
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
