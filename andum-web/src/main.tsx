import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './App'
import { ROUTER_FUTURE } from './routerFuture'
import './styles/legacy.css'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')} future={ROUTER_FUTURE}>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>,
)
