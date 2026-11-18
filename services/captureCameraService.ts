/** Camera surfaces must release their native session before another surface mounts. */
export const captureCameraDelays = { release: 250, startup: 8000, modalClose: 500 } as const;

export interface CaptureCameraAvailability {
  focused: boolean;
  granted: boolean;
  suspended: boolean;
  expanded: boolean;
  modalShown: boolean;
  modalClosing: boolean;
}

export function canMountCaptureCamera(state: CaptureCameraAvailability): boolean {
  // An inline camera inside a scrolling list can be offscreen on iOS and never become ready.
  // Only the presented, non-scrolling fullscreen surface owns the native stream.
  return state.focused && state.granted && !state.suspended && !state.modalClosing && state.expanded && state.modalShown;
}
