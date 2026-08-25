import React, { useState } from 'react';
import { Train, Search, Plus, Menu, X } from 'lucide-react';
import { ru } from '../i18n/ru';

export type AppTab = 'home' | 'routes' | 'search' | 'archive' | 'references';

interface HeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  onOpenCreateRoute: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onPerformSearch: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenCreateRoute,
  searchQuery,
  setSearchQuery,
  onPerformSearch,
}) => {
  const [open, setOpen] = useState(false);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setActiveTab('search');
      onPerformSearch();
      setOpen(false);
    }
  };

  const navBtn = (tab: AppTab, label: string) => (
    <button
      type="button"
      onClick={() => {
        setActiveTab(tab);
        setOpen(false);
      }}
      className={`btn tap ${activeTab === tab ? 'btn-primary' : 'btn-ghost'}`}
      aria-current={activeTab === tab ? 'page' : undefined}
    >
      {label}
    </button>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--panel)]/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <button type="button" className="flex items-center gap-2 min-h-[44px] rounded-xl px-1.5 -ml-1 transition-colors hover:bg-[var(--steel-soft)]" onClick={() => setActiveTab('home')} aria-label={ru.appName}>
          <span className="w-10 h-10 rounded-xl bg-[var(--steel-soft)] text-[var(--steel)] flex items-center justify-center">
            <Train className="w-5 h-5" aria-hidden="true" />
          </span>
          <span>
            <span className="display block text-lg leading-none">{ru.appName}</span>
            <span className="hidden sm:block text-xs text-[var(--muted)]">{ru.appFull}</span>
          </span>
        </button>

        <nav className="hidden md:flex items-center gap-1 ml-4" aria-label="Основное меню">
          {navBtn('home', ru.nav.products)}
          {navBtn('routes', ru.nav.routes)}
          {navBtn('archive', ru.nav.archive)}
          {navBtn('references', ru.nav.references)}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <form onSubmit={handleSearchSubmit} className="hidden sm:block relative">
            <label className="sr-only" htmlFor="global-search">{ru.search.title}</label>
            <input
              id="global-search"
              className="field !pl-9 text-sm w-52 lg:w-72"
              placeholder={ru.search.placeholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          </form>
          <button type="button" className="btn btn-primary" onClick={onOpenCreateRoute}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span className="hidden lg:inline">{ru.actions.addRoute}</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary md:hidden"
            aria-label={ru.nav.menu}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-[var(--line)] px-4 py-3 space-y-2 bg-[var(--panel)]">
          <div className="grid grid-cols-2 gap-2">
            {navBtn('home', ru.nav.products)}
            {navBtn('routes', ru.nav.routes)}
            {navBtn('search', ru.nav.search)}
            {navBtn('archive', ru.nav.archive)}
            {navBtn('references', ru.nav.references)}
          </div>
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <input className="field" placeholder={ru.search.placeholder} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <button type="submit" className="btn btn-primary">{ru.actions.search}</button>
          </form>
        </div>
      )}

      <nav className="md:hidden flex overflow-x-auto gap-1 px-3 pb-2" aria-label="Мобильная навигация">
        {[
          ['home', ru.nav.products],
          ['routes', ru.nav.routes],
          ['search', ru.nav.search],
          ['archive', ru.nav.archive],
          ['references', ru.nav.references],
        ].map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab as AppTab)}
            className={`btn whitespace-nowrap ${activeTab === tab ? 'btn-primary' : 'btn-ghost'}`}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
};
