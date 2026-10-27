import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { t } from '@extension/i18n';
import { cropRectFromSelection, type PixelRect } from '@extension/shared';
import { Button } from '@extension/ui';

interface ScreenshotCropperProps {
  src: string;
  /** Receives the crop in natural image pixels, or null when no area was selected (full image). */
  onConfirm: (rect: PixelRect | null) => void;
  onCancel: () => void;
}

interface Drag {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

const MIN_SELECTION_PX = 4;

/** Modal that lets the user drag a rectangle over a captured screenshot. A click without a drag keeps the full image. */
export default function ScreenshotCropper({ src, onConfirm, onCancel }: ScreenshotCropperProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  const pointInImage = (event: PointerEvent<HTMLDivElement>) => {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointInImage(event);
    setDrag({ startX: point.x, startY: point.y, x: point.x, y: point.y });
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !drag) return;
    const point = pointInImage(event);
    setDrag({ ...drag, x: point.x, y: point.y });
  };

  const selectionRect = (current: Drag) => ({
    x: Math.min(current.startX, current.x),
    y: Math.min(current.startY, current.y),
    width: Math.abs(current.x - current.startX),
    height: Math.abs(current.y - current.startY),
  });

  const handlePointerUp = () => setDragging(false);

  const confirmSelection = () => {
    const image = imageRef.current;
    if (!image || !drag) return onConfirm(null);
    const selection = selectionRect(drag);
    if (selection.width < MIN_SELECTION_PX || selection.height < MIN_SELECTION_PX) return onConfirm(null);
    onConfirm(
      cropRectFromSelection(
        selection,
        { width: image.clientWidth, height: image.clientHeight },
        { width: image.naturalWidth, height: image.naturalHeight },
      ),
    );
  };

  // Escape closes the dialog; listened on window because the dialog itself is not focusable
  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const box = drag ? selectionRect(drag) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="screenshot-cropper-title"
      className="fixed inset-0 z-50 flex flex-col gap-3 bg-background/95 p-4">
      <h2 id="screenshot-cropper-title" className="text-sm font-semibold text-foreground">
        {t('chat_input_cropTitle')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('chat_input_cropHint')}</p>
      <div
        className="relative flex min-h-0 flex-1 cursor-crosshair touch-none items-center justify-center overflow-hidden select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}>
        <img ref={imageRef} src={src} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
        {box && box.width > 0 && box.height > 0 ? (
          <div
            data-testid="crop-selection"
            className="pointer-events-none absolute border-2 border-primary"
            style={{
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
            }}
          />
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('chat_input_cropCancel')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onConfirm(null)}>
          {t('chat_input_cropFull')}
        </Button>
        <Button type="button" size="sm" onClick={confirmSelection}>
          {t('chat_input_cropUse')}
        </Button>
      </div>
    </div>
  );
}
