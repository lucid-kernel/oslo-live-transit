import type { Map } from 'maplibre-gl';
import type { RefObject } from 'react';

export function bindFollowGestures(map: Map, gesture: RefObject<boolean>, following: () => boolean, stopFollow: () => void) {
  const canvasContainer = map.getCanvasContainer();
  let wheelIdleTimer: number | null = null;
  let didDrag = false;
  let multiTouchGesture = false;

  const onGestureStart = () => {
    gesture.current = true;
  };
  const onTouchStart = (e: TouchEvent) => {
    gesture.current = true;
    if (e.touches.length >= 2) {
      multiTouchGesture = true;
    } else if (e.touches.length === 1) {
      multiTouchGesture = false;
      didDrag = false;
    }
  };
  const onGestureEnd = () => {
    if (!map.isMoving()) {
      gesture.current = false;
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0 && !map.isMoving()) {
      gesture.current = false;
      multiTouchGesture = false;
      didDrag = false;
    }
  };
  const onWheel = () => {
    gesture.current = true;
    if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer);
    wheelIdleTimer = window.setTimeout(() => {
      wheelIdleTimer = null;
      if (!map.isMoving()) {
        gesture.current = false;
      }
    }, 250);
  };

  const controller = new AbortController();
  const options = { passive: true, capture: true, signal: controller.signal };
  canvasContainer.addEventListener('pointerdown', onGestureStart, options);
  canvasContainer.addEventListener('touchstart', onTouchStart, options);
  canvasContainer.addEventListener('pointerup', onGestureEnd, options);
  canvasContainer.addEventListener('pointercancel', onGestureEnd, options);
  canvasContainer.addEventListener('touchend', onTouchEnd, options);
  canvasContainer.addEventListener('touchcancel', onTouchEnd, options);
  canvasContainer.addEventListener('wheel', onWheel, options);

  map.on('movestart', (e) => {
    if (e.originalEvent) gesture.current = true;
  });
  map.on('dragstart', (e) => {
    if (e.originalEvent && following()) {
      didDrag = true;
    }
  });
  map.on('dragend', () => {
    if (didDrag && !multiTouchGesture && following()) {
      stopFollow();
    }
    didDrag = false;
  });
  map.on('moveend', () => {
    gesture.current = false;
    if (!map.isMoving()) {
      didDrag = false;
      multiTouchGesture = false;
    }
  });

  return () => {
    controller.abort();
    if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer);
  };
}
