import type { FutureConfig } from 'react-router-dom'

/** Opt in to the React Router v7 behaviour now, so upgrading later changes nothing. */
export const ROUTER_FUTURE: Partial<FutureConfig> = { v7_startTransition: true, v7_relativeSplatPath: true }
