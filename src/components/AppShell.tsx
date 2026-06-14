import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import {
  LayoutDashboard, Users, FileAudio, CalendarDays,
  ClipboardList, SlidersHorizontal, Star, BarChart2,
  FileText, Settings, LogOut,
} from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { auth } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'

const ALL_NAV = [
  { label: 'Dashboard',   path: '/',            icon: LayoutDashboard,    roles: ['admin', 'senior_rater'] },
  { label: 'People',      path: '/people',      icon: Users,               roles: ['admin'] },
  { label: 'Test Bank',   path: '/test-bank',   icon: FileAudio,           roles: ['admin'] },
  { label: 'Sessions',    path: '/sessions',    icon: CalendarDays,        roles: ['admin'] },
  { label: 'Assignments', path: '/assignments', icon: ClipboardList,       roles: ['admin', 'senior_rater'] },
  { label: 'Scoring',     path: '/scoring',     icon: SlidersHorizontal,   roles: ['admin', 'senior_rater'] },
  { label: 'Scores',      path: '/scores',      icon: Star,                roles: ['admin'] },
  { label: 'Statistics',  path: '/statistics',  icon: BarChart2,           roles: ['admin'] },
  { label: 'Reports',     path: '/reports',     icon: FileText,            roles: ['admin'] },
  { label: 'Admin',       path: '/admin',       icon: Settings,            roles: ['admin'] },
] as const

export function AppShell() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const navItems = ALL_NAV.filter(
    (item) => role && (item.roles as readonly string[]).includes(role)
  )

  function isActive(path: string) {
    return path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
  }

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar>
          <SidebarHeader className="px-4 py-4">
            <span className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              Aviation English
            </span>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive(item.path)}
                        render={<NavLink to={item.path} />}
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="px-2 py-3 border-t">
            <div className="px-2 py-1 text-xs text-muted-foreground truncate">
              {user?.email}
            </div>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={handleSignOut}>
                  <LogOut className="size-4" />
                  <span>Sign out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center h-12 px-4 border-b shrink-0">
            <SidebarTrigger />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}
