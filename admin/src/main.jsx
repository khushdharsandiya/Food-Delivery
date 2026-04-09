import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from 'react-router-dom'
import ScrollToTop from './components/ScrollToTop.jsx'

// Purana localStorage token hata do — ab sirf sessionStorage (tab band = dubara login)
try {
  localStorage.removeItem('adminToken')
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ScrollToTop />
    <App />
  </BrowserRouter>
)
