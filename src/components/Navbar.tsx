import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, LogOut, Menu, X } from 'lucide-react';
import { AppView, AuthUserProfile } from '../types/roamplan';

interface NavbarProps {
  activeView: AppView;
  savedTripCount: number;
  user: AuthUserProfile | null;
  authLoading: boolean;
  authBusy: boolean;
  onNavigate: (view: AppView) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

function GoogleMark() {
  return (
    <svg
      className="w-4 h-4 shrink-0"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.48-1.71 4.35-5.27 4.35-3.17 0-5.76-2.63-5.76-5.88s2.59-5.88 5.76-5.88c1.81 0 3.02.77 3.71 1.44l2.53-2.44C16.79 4.16 14.69 3.2 12.17 3.2 7.21 3.2 3.2 7.22 3.2 12.2s4.01 9 8.97 9c5.18 0 8.61-3.64 8.61-8.77 0-.59-.07-1.04-.15-1.33z" />
    </svg>
  );
}

function UserAvatar({ user, size = 'sm' }: { user: AuthUserProfile; size?: 'sm' | 'md' }) {
  const [imgFailed, setImgFailed] = useState(false);
  const dim = size === 'md' ? 'w-9 h-9 text-xs' : 'w-6 h-6 text-[11px]';
  const initials = (user.displayName || user.email || 'R')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  if (user.photoURL && !imgFailed) {
    return (
      <img
        src={user.photoURL}
        alt={user.displayName}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${dim} rounded-full object-cover border border-[#D8D1C4] shrink-0`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${dim} rounded-full bg-[#EFECE4] border border-[#D8D1C4] text-[#1B4B3A] font-semibold inline-flex items-center justify-center shrink-0`}
    >
      {initials || 'R'}
    </span>
  );
}

export function Navbar({
  activeView,
  savedTripCount,
  user,
  authLoading,
  authBusy,
  onNavigate,
  onSignIn,
  onSignOut,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileMenuOpen]);

  const navItems: Array<{ view: AppView; label: string }> = [
    { view: 'explore', label: 'Explore' },
    { view: 'plan', label: 'Plan a Trip' },
    {
      view: 'my-trips',
      label: user && savedTripCount > 0 ? `My Trips (${savedTripCount})` : 'My Trips',
    },
    { view: 'about', label: 'How It Works' },
  ];

  const handleNav = (view: AppView) => {
    setMobileOpen(false);
    setProfileMenuOpen(false);
    onNavigate(view);
  };

  const firstName = user?.displayName?.split(/\s+/)[0] || user?.email?.split('@')[0] || 'Account';

  return (
    <header className="sticky top-0 z-40 bg-[#F8F6F1]/95 backdrop-blur-sm border-b border-[#DFD9CE]">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => handleNav('explore')}
          className="font-editorial text-2xl tracking-tight text-[#17211C] hover:text-[#1B4B3A] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B4B3A]"
        >
          RoamPlan
        </button>

        {/* Zone 2: Clean single-line typography navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-8 text-sm font-medium text-[#4B5650]"
        >
          {navItems.map((item) => {
            const isActive =
              activeView === item.view ||
              (item.view === 'explore' && activeView === 'destination') ||
              (item.view === 'plan' && (activeView === 'results' || activeView === 'editor'));
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => handleNav(item.view)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B4B3A] ${
                  isActive
                    ? 'text-[#17211C] border-[#1B4B3A]'
                    : 'border-transparent hover:text-[#17211C] hover:border-[#C9C2B5]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary account control */}
        <div className="flex items-center gap-3 shrink-0">
          {authLoading ? (
            <span className="hidden md:inline-flex items-center gap-2 text-xs text-[#4B5650] whitespace-nowrap shrink-0 min-h-[42px] px-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              <span>Checking account…</span>
            </span>
          ) : user ? (
            <div ref={profileMenuRef} className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-2 pl-2.5 pr-3.5 py-2 bg-white border border-[#D8D1C4] hover:border-[#1B4B3A] rounded-md text-sm font-medium text-[#17211C] transition-colors whitespace-nowrap shrink-0 min-h-[42px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4B3A]"
              >
                <UserAvatar user={user} size="sm" />
                <span className="max-w-[120px] truncate">{firstName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#4B5650]" aria-hidden="true" />
              </button>

              {profileMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 bg-white border border-[#DFD9CE] rounded-lg shadow-lg p-4 z-50"
                >
                  <div className="flex items-center gap-3 pb-3 border-b border-[#EFECE4]">
                    <UserAvatar user={user} size="md" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17211C] truncate">
                        {user.displayName}
                      </p>
                      <p className="text-xs text-[#4B5650] truncate">{user.email}</p>
                    </div>
                  </div>
                  <p className="mt-2.5 text-xs text-[#4B5650]">
                    Cloud Firestore · Private account sync
                  </p>
                  <div className="mt-3 space-y-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleNav('my-trips')}
                      className="w-full text-left px-3 py-2 text-sm font-medium text-[#17211C] hover:bg-[#F8F6F1] rounded-md transition-colors"
                    >
                      My Trips ({savedTripCount})
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={authBusy}
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onSignOut();
                      }}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm font-medium text-[#8A2F21] hover:bg-[#FDF4F2] rounded-md transition-colors disabled:opacity-60"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" />
                      <span>{authBusy ? 'Signing out…' : 'Sign Out'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={authBusy}
              onClick={onSignIn}
              className="hidden md:inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-65 rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[42px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4B3A]"
            >
              {authBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <GoogleMark />
              )}
              <span>{authBusy ? 'Signing in…' : 'Sign in with Google'}</span>
            </button>
          )}

          <button
            type="button"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 text-[#17211C] hover:bg-[#EFECE4] rounded-md transition-colors"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation panel */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#DFD9CE] bg-[#F8F6F1] px-4 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = activeView === item.view;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => handleNav(item.view)}
                className={`w-full text-left px-3 py-3 text-sm font-medium rounded-md transition-colors ${
                  isActive ? 'bg-[#EFECE4] text-[#17211C]' : 'text-[#4B5650] hover:bg-[#EFECE4]'
                }`}
              >
                {item.label}
              </button>
            );
          })}

          <div className="pt-3 mt-2 border-t border-[#DFD9CE]">
            {authLoading ? (
              <p className="px-3 py-2 text-xs text-[#4B5650]">Checking account session…</p>
            ) : user ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 px-2 py-1">
                  <UserAvatar user={user} size="md" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#17211C] truncate">
                      {user.displayName}
                    </p>
                    <p className="text-xs text-[#4B5650] truncate">{user.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => {
                    setMobileOpen(false);
                    onSignOut();
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-[#8A2F21] bg-white border border-[#E6CFCB] hover:bg-[#FDF4F2] rounded-md transition-colors disabled:opacity-60 min-h-[44px]"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  <span>{authBusy ? 'Signing out…' : 'Sign Out'}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => {
                  setMobileOpen(false);
                  onSignIn();
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-65 rounded-md transition-colors min-h-[44px]"
              >
                {authBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <GoogleMark />
                )}
                <span>{authBusy ? 'Signing in…' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
