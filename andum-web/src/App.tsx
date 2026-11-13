import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { LandingPage } from '@/pages/LandingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { AppPage } from '@/pages/AppPage'
import { ReceivePage } from '@/pages/ReceivePage'
import { SessionProvider } from '@/components/app/Session'

/** All routes. Wrap in a router (BrowserRouter in the app, MemoryRouter in tests). */
export function AppRoutes() {
  return (
    <SessionProvider>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="app" element={<AppPage />} />
        <Route path="p/:slug" element={<ReceivePage by="slug" />} />
        <Route path="i/:id" element={<ReceivePage by="id" />} />
        <Route path="p" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </SessionProvider>
  )
}
