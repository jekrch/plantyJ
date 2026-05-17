// Image-viewer interaction hooks for the fullscreen OrganismViewer carousel.
//
// This is a deliberately distinct concern from the generic graph pan/zoom hook
// (`src/hooks/usePanZoom.ts`, used by WebView/TreeView/RelationsSubgraph):
//
//  - `useImageZoomPan` writes CSS transforms directly to the DOM as an iOS
//    Safari compositing-bug workaround, and clamps panning to image bounds.
//  - `useSlideNavigation` drives the three-slot swipe carousel.
//  - `useGestureHandler` routes pointer/touch events between the two based on
//    zoom state.
//
// They are colocated here so the name no longer collides with the generic
// `usePanZoom`. See .claude/plan/code-organization.md item 3.

export {
  useImageZoomPan,
  MIN_SCALE,
  MAX_SCALE,
  type ImageZoomPanState,
  type ImageTransform,
} from "./useImageZoomPan";
export { useGestureHandler } from "./useGestureHandler";
export {
  useSlideNavigation,
  type SlideNavigationState,
} from "./useSlideNavigation";
