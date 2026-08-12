import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MonitorPlay, CloudUpload, LogOut, User, Music, ListMusic } from 'lucide-react';

export default function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden">
      {/* Sidebar Glassmorphism */}
      <nav className="w-64 flex flex-col h-full bg-white/[0.02] border-r border-white/5 backdrop-blur-3xl relative z-20 shadow-2xl">
        <div className="p-6 flex items-center space-x-3 border-b border-white/5">
          <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg shadow-blue-500/20">
            <Music size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
            Tandu Live
          </h1>
        </div>

        <div className="flex-1 py-6 px-4 space-y-2 overflow-y-auto">
          <NavLink 
            to="/" 
            className={({ isActive }) => 
              `flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-red-600/20 text-red-400 shadow-inner border border-red-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <MonitorPlay size={20} />
            <span className="font-medium">Live Concert</span>
          </NavLink>

          <NavLink 
            to="/editor" 
            className={({ isActive }) => 
              `flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-blue-600/20 text-blue-400 shadow-inner border border-blue-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Music size={20} />
            <span className="font-medium">Studio Prompter</span>
          </NavLink>

          <NavLink 
            to="/studio" 
            className={({ isActive }) => 
              `flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-purple-600/20 text-purple-400 shadow-inner border border-purple-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <CloudUpload size={20} />
            <span className="font-medium">Stem Studio</span>
          </NavLink>

          <NavLink 
            to="/setlists" 
            className={({ isActive }) => 
              `flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-yellow-500/20 text-yellow-500 shadow-inner border border-yellow-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <ListMusic size={20} />
            <span className="font-medium">Setlists</span>
          </NavLink>
        </div>

        <div className="p-4 border-t border-white/5 bg-black/20">
          <div className="flex items-center space-x-3 mb-4 px-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-700 to-gray-500 flex items-center justify-center">
              <User size={16} className="text-white/80" />
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">{user?.email}</span>
              <span className="text-xs text-green-400">En línea</span>
            </div>
          </div>
          <button 
            onClick={signOut}
            className="w-full flex items-center justify-center space-x-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 py-2.5 rounded-lg transition-colors border border-red-500/20"
          >
            <LogOut size={16} />
            <span className="text-sm font-medium">Cerrar Sesión</span>
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 h-full relative overflow-hidden bg-gradient-to-br from-[#0a0a0a] to-[#121212]">
        <Outlet />
      </main>
    </div>
  );
}
