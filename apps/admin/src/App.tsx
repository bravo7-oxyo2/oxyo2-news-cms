import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { BarChart3, Bot, FileText, Files, Image, LayoutDashboard, Leaf, LogOut, PanelLeftClose, PanelLeftOpen, Settings, Tags } from 'lucide-react'
import { api } from './lib/api'
import { Login, ForgotPassword, ResetPassword } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { ContentList } from './pages/ContentList'
import { MediaLibrary } from './pages/MediaLibrary'
import { SettingsPage } from './pages/Settings'
import { CategoriesPage } from './pages/CategoriesPage'
import { NewsBotPage } from './pages/NewsBotPage'

const EditorPage = lazy(() => import('./pages/EditorPage').then(module => ({ default: module.EditorPage })))
const SearchInsightsPage = lazy(() => import('./pages/SearchInsightsPage').then(module => ({ default: module.SearchInsightsPage })))
export type User = { id: string; email: string; name: string }

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => { api<{ data: User }>('/admin/auth/me').then(result => setUser(result.data)).catch(() => setUser(null)) }, [])
  if (user === undefined) return <div className="splash"><Leaf /> Loading workspace…</div>
  if (!user) return <Routes><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} /><Route path="*" element={<Login onLogin={setUser} />} /></Routes>
  return <Shell user={user} logout={() => setUser(null)} />
}

function Shell({ user, logout }: { user: User; logout: () => void }) {
  const [small, setSmall] = useState(false); const navigate = useNavigate()
  const signout = async () => { await api('/admin/auth/logout', { method: 'POST' }); logout(); navigate('/login') }
  return <div className={`shell ${small ? 'small' : ''}`}><aside><div className="brand"><span><Leaf /></span><b>Paperleaf</b></div><nav><NavLink to="/"><LayoutDashboard /><span>Dashboard</span></NavLink><NavLink to="/posts"><FileText /><span>Posts</span></NavLink><NavLink to="/pages"><Files /><span>Pages</span></NavLink><NavLink to="/categories"><Tags /><span>Categories</span></NavLink><NavLink to="/media"><Image /><span>Media</span></NavLink><NavLink to="/news-bot"><Bot /><span>News bot</span></NavLink><NavLink to="/search-insights"><BarChart3 /><span>Search Insights</span></NavLink><NavLink to="/settings"><Settings /><span>Settings</span></NavLink></nav><div className="aside-foot"><button className="nav-button" onClick={signout}><LogOut /><span>Sign out</span></button><button className="nav-button collapse" onClick={() => setSmall(!small)}>{small ? <PanelLeftOpen /> : <PanelLeftClose />}<span>Collapse</span></button></div></aside><main><header><div><span className="eyebrow">Personal CMS</span><b>{user.name}</b></div><span className="avatar">{user.name[0]}</span></header><div className="canvas"><Suspense fallback={<div className="splash">Loading editor…</div>}><Routes><Route path="/" element={<Dashboard />} /><Route path="/posts" element={<ContentList type="POST" />} /><Route path="/pages" element={<ContentList type="PAGE" />} /><Route path="/categories" element={<CategoriesPage />} /><Route path="/:kind/new" element={<EditorPage />} /><Route path="/:kind/:id" element={<EditorPage />} /><Route path="/media" element={<MediaLibrary />} /><Route path="/news-bot" element={<NewsBotPage />} /><Route path="/search-insights" element={<SearchInsightsPage />} /><Route path="/settings" element={<SettingsPage user={user} />} /><Route path="*" element={<Navigate to="/" />} /></Routes></Suspense></div></main></div>
}
