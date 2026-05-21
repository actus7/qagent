import { useCallback, useRef } from 'react';
import type { BrowserFramePayload, BrowserInputPayload, BrowserStatusPayload } from '@src/types/port';

interface BrowserPreviewProps {
  frame: BrowserFramePayload | null;
  status: BrowserStatusPayload | null;
  sessionId?: string | null;
  disabled?: boolean;
  onInput: (input: BrowserInputPayload, sessionId?: string) => void;
}

function mapMouseButton(button: number): 'left' | 'middle' | 'right' {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
}

export default function BrowserPreview({ frame, status, sessionId, disabled = false, onInput }: BrowserPreviewProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);

  const statusText = !status
    ? 'Loading companion status...'
    : !status.connected
      ? 'Companion offline'
      : !status.authenticated
        ? 'Companion authentication required'
        : status.screencasting
          ? 'Pair browsing active'
          : 'Companion connected';

  const toViewportCoords = useCallback(
    (clientX: number, clientY: number) => {
      const image = imageRef.current;
      if (!image || !frame) {
        return null;
      }

      const rect = image.getBoundingClientRect();
      const rawX = clientX - rect.left;
      const rawY = clientY - rect.top;
      if (rawX < 0 || rawY < 0 || rawX > rect.width || rawY > rect.height) {
        return null;
      }

      const scaleX = frame.metadata.deviceWidth / rect.width;
      const scaleY = frame.metadata.deviceHeight / rect.height;
      return {
        x: Math.round(rawX * scaleX),
        y: Math.round(rawY * scaleY),
      };
    },
    [frame],
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || !frame) {
        return;
      }
      const coords = toViewportCoords(event.clientX, event.clientY);
      if (!coords) {
        return;
      }
      onInput(
        {
          type: 'input_mouse',
          eventType: 'mousePressed',
          x: coords.x,
          y: coords.y,
          button: mapMouseButton(event.button),
          clickCount: 1,
        },
        sessionId ?? undefined,
      );
    },
    [disabled, frame, onInput, sessionId, toViewportCoords],
  );

  const handleMouseUp = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || !frame) {
        return;
      }
      const coords = toViewportCoords(event.clientX, event.clientY);
      if (!coords) {
        return;
      }
      onInput(
        {
          type: 'input_mouse',
          eventType: 'mouseReleased',
          x: coords.x,
          y: coords.y,
          button: mapMouseButton(event.button),
          clickCount: 1,
        },
        sessionId ?? undefined,
      );
    },
    [disabled, frame, onInput, sessionId, toViewportCoords],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLButtonElement>) => {
      if (disabled || !frame) {
        return;
      }
      const coords = toViewportCoords(event.clientX, event.clientY) ?? { x: 0, y: 0 };
      onInput(
        {
          type: 'input_mouse',
          eventType: 'mouseWheel',
          x: coords.x,
          y: coords.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
        },
        sessionId ?? undefined,
      );
      event.preventDefault();
    },
    [disabled, frame, onInput, sessionId, toViewportCoords],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) {
        return;
      }
      onInput(
        {
          type: 'input_keyboard',
          eventType: 'keyDown',
          key: event.key,
          code: event.code,
        },
        sessionId ?? undefined,
      );
    },
    [disabled, onInput, sessionId],
  );

  const handleKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) {
        return;
      }
      onInput(
        {
          type: 'input_keyboard',
          eventType: 'keyUp',
          key: event.key,
          code: event.code,
        },
        sessionId ?? undefined,
      );
    },
    [disabled, onInput, sessionId],
  );

  return (
    <div className="border-b border-border bg-card p-2">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{statusText}</span>
        {status?.sessionId ? <span className="truncate">session: {status.sessionId}</span> : null}
      </div>
      <button
        type="button"
        className={`relative w-full overflow-hidden rounded-md border border-border bg-black/80 text-left ${disabled ? 'opacity-60' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        disabled={disabled}
        aria-label="Browser preview">
        {frame ? (
          <img
            ref={imageRef}
            src={`data:image/jpeg;base64,${frame.data}`}
            alt="Browser preview stream"
            className="aspect-video w-full select-none object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center text-xs text-white/70">Waiting for frames...</div>
        )}
      </button>
    </div>
  );
}
