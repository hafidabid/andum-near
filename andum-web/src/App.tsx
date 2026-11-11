import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { LandingPage } from '@/pages/LandingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PackageLinkPage } from '@/pages/PackageLinkPage'

/** All routes. Wrap in a router (BrowserRouter in the app, MemoryRouter in tests). */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="p/:slug" element={<PackageLinkPage />} />
        <Route path="p" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
