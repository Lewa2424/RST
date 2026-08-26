import React, { useEffect, useState } from 'react';
import { ProductType, Station, Route, RouteWagon, SearchWagonResult } from './types';
import { Header, type AppTab } from './components/Header';
import { Level1ProductTypes } from './components/Level1ProductTypes';
import { Level2Dashboard } from './components/Level2Dashboard';
import { RouteDetailView } from './components/RouteDetailView';
import { CreateRouteModal } from './components/CreateRouteModal';
import { CreateTerminalListModal } from './components/CreateTerminalListModal';
import { GlobalSearchView } from './components/GlobalSearchView';
import { ArchiveView } from './components/ArchiveView';
import { ReferenceDataManager } from './components/ReferenceDataManager';
import { InspectorView } from './components/InspectorView';
import { PencilEditModal } from './components/PencilEditModal';
import { EditRouteModal } from './components/EditRouteModal';
import { RouteListTable } from './components/RouteListTable';
import { ru } from './i18n/ru';
import { api, asItems, ApiError } from './api';
import { LoadingOverlay } from './components/LoadingState';

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [selectedProductType, setSelectedProductType] = useState<ProductType | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [selectedRouteDetail, setSelectedRouteDetail] = useState<any | null>(null);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);

  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ routes: Route[]; wagon: SearchWagonResult | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [loadingRouteDetail, setLoadingRouteDetail] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isCreateRouteOpen, setIsCreateRouteOpen] = useState(false);
  const [appendWagonsRouteId, setAppendWagonsRouteId] = useState<number | null>(null);
  const [isCreateTerminalListOpen, setIsCreateTerminalListOpen] = useState(false);
  const [inspectorListsRefreshKey, setInspectorListsRefreshKey] = useState(0);
  const [editingWagon, setEditingWagon] = useState<RouteWagon | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  const fetchInitialData = async () => {
    try {
      setLoadingTypes(true);
      const [ptRes, stRes] = await Promise.all([
        api<ProductType[]>('/api/product-types'),
        api<Station[]>('/api/stations'),
      ]);
      setProductTypes(ptRes);
      setStations(stRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setLoadingTypes(false);
    }
  };

  const fetchRoutes = async () => {
    try {
      setLoadingRoutes(true);
      const qs = new URLSearchParams();
      qs.set('status', 'ACTIVE_ALL');
      if (selectedProductType) qs.set('product_type_id', String(selectedProductType.id));
      if (selectedStationId) qs.set('station_id', String(selectedStationId));
      const data = await api(`/api/routes?${qs.toString()}`);
      setRoutes(asItems<Route>(data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setLoadingRoutes(false);
    }
  };

  useEffect(() => { fetchInitialData(); }, []);
  useEffect(() => { fetchRoutes(); }, [selectedProductType, selectedStationId]);

  const fetchRouteDetail = async (routeId: number) => {
    setLoadingRouteDetail(true);
    setError(null);
    try {
      setSelectedRouteDetail(await api(`/api/routes/${routeId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setLoadingRouteDetail(false);
    }
  };

  const goHome = () => {
    setActiveTab('home');
    setSelectedProductType(null);
    setSelectedStationId(null);
    setSelectedRouteDetail(null);
  };

  const handlePerformSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      setSearchResults(await api(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`));
      setActiveTab('search');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setSearching(false);
    }
  };

  const refreshAll = () => {
    fetchRoutes();
    fetchInitialData();
    if (selectedRouteDetail) fetchRouteDetail(selectedRouteDetail.id);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          setSelectedRouteDetail(null);
          if (tab === 'home') {
            setSelectedProductType(null);
            setSelectedStationId(null);
          }
        }}
        onGoHome={goHome}
        onOpenCreateRoute={() => {
          setAppendWagonsRouteId(null);
          setIsCreateRouteOpen(true);
        }}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onPerformSearch={handlePerformSearch}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 relative">
        {loadingRouteDetail && <LoadingOverlay label={ru.loading.route} />}
        {error && <div className="badge badge-err p-3 mb-4 w-full justify-start">{error}<button className="ml-auto" type="button" onClick={() => setError(null)}>×</button></div>}

        {selectedRouteDetail ? (
          <RouteDetailView
            route={selectedRouteDetail}
            onBack={() => setSelectedRouteDetail(null)}
            onEditRoute={() => setEditingRoute(selectedRouteDetail)}
            onEditWagonRow={(wagon) => setEditingWagon(wagon)}
            onOpenAddWagonsModal={() => {
              setAppendWagonsRouteId(selectedRouteDetail.id);
              setIsCreateRouteOpen(true);
            }}
            onOpenAddTerminalListForRoute={() => setIsCreateTerminalListOpen(true)}
            onCloseRoute={async () => {
              if (!confirm(ru.route.confirmClose)) return;
              try {
                await api(`/api/routes/${selectedRouteDetail.id}/close`, { method: 'POST' });
                showToast(ru.toast.closed);
                refreshAll();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : ru.errors.generic);
              }
            }}
            onArchiveRoute={async () => {
              if (!confirm(ru.route.confirmArchive)) return;
              try {
                await api(`/api/routes/${selectedRouteDetail.id}/archive`, { method: 'POST' });
                showToast(ru.toast.archived);
                setSelectedRouteDetail(null);
                refreshAll();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : ru.errors.generic);
              }
            }}
            onUnarchiveRoute={async () => {
              if (!confirm(ru.route.confirmUnarchive)) return;
              try {
                await api(`/api/routes/${selectedRouteDetail.id}/unarchive`, { method: 'POST' });
                showToast(ru.toast.restored);
                refreshAll();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : ru.errors.generic);
              }
            }}
            onReconcileNow={async () => {
              try {
                await api(`/api/routes/${selectedRouteDetail.id}/reconcile`, { method: 'POST' });
                showToast(ru.toast.reconciled);
                refreshAll();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : ru.errors.generic);
              }
            }}
          />
        ) : activeTab === 'search' ? (
          <GlobalSearchView
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onPerformSearch={handlePerformSearch}
            searchResults={searchResults}
            loading={searching}
            onSelectRoute={(route) => fetchRouteDetail(route.id)}
          />
        ) : activeTab === 'archive' ? (
          <ArchiveView
            productTypes={productTypes}
            stations={stations}
            onSelectRoute={(route) => fetchRouteDetail(route.id)}
            onUnarchiveRoute={async (id) => {
              if (!confirm(ru.route.confirmUnarchive)) return;
              try {
                await api(`/api/routes/${id}/unarchive`, { method: 'POST' });
                showToast(ru.toast.restored);
                refreshAll();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : ru.errors.generic);
              }
            }}
          />
        ) : activeTab === 'inspector' ? (
          <InspectorView
            productTypes={productTypes}
            routes={routes}
            listsRefreshKey={inspectorListsRefreshKey}
            onOpenCreateTerminalList={() => setIsCreateTerminalListOpen(true)}
            onSelectRoute={(id) => fetchRouteDetail(id)}
            onStatusChanged={refreshAll}
          />
        ) : activeTab === 'references' ? (
          <ReferenceDataManager productTypes={productTypes} stations={stations} onRefreshData={fetchInitialData} />
        ) : activeTab === 'routes' && !selectedProductType ? (
          <div className="card p-4">
            <h1 className="text-2xl mb-4">{ru.nav.routes}</h1>
            <RouteListTable routes={routes} loading={loadingRoutes} onSelectRoute={(r) => fetchRouteDetail(r.id)} onEditRoute={setEditingRoute} />
          </div>
        ) : selectedProductType ? (
          <Level2Dashboard
            selectedProductType={selectedProductType}
            stations={stations}
            selectedStationId={selectedStationId}
            setSelectedStationId={setSelectedStationId}
            routes={routes}
            loadingRoutes={loadingRoutes}
            onBackToLevel1={() => setSelectedProductType(null)}
            onOpenAddStationModal={() => setActiveTab('references')}
            onOpenCreateRoute={() => {
              setAppendWagonsRouteId(null);
              setIsCreateRouteOpen(true);
            }}
            onOpenCreateTerminalList={() => setIsCreateTerminalListOpen(true)}
            onSelectRoute={(r) => fetchRouteDetail(r.id)}
            onEditRoute={setEditingRoute}
          />
        ) : (
          <Level1ProductTypes
            productTypes={productTypes}
            onSelectProductType={setSelectedProductType}
            onOpenAddProductTypeModal={() => setActiveTab('references')}
            loading={loadingTypes}
          />
        )}
      </main>

      <footer className="border-t border-[var(--line)] py-4 text-sm text-[var(--muted)]">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row justify-between gap-2">
          <span><strong className="text-[var(--ink)]">{ru.appName}</strong> — {ru.appFull}</span>
          <span>{ru.footerNote}</span>
        </div>
      </footer>

      {toast && <div className="fixed bottom-4 right-4 card toast-enter px-4 py-3 shadow-lg">{toast}</div>}

      <CreateRouteModal
        isOpen={isCreateRouteOpen}
        onClose={() => {
          setIsCreateRouteOpen(false);
          setAppendWagonsRouteId(null);
        }}
        productTypes={productTypes}
        stations={stations}
        initialProductTypeId={selectedProductType?.id}
        appendToRouteId={appendWagonsRouteId}
        onSuccess={() => { showToast(ru.toast.saved); refreshAll(); }}
      />
      <CreateTerminalListModal
        isOpen={isCreateTerminalListOpen}
        onClose={() => setIsCreateTerminalListOpen(false)}
        productTypes={productTypes}
        stations={stations}
        initialProductTypeId={selectedProductType?.id}
        onSuccess={() => {
          showToast(ru.toast.saved);
          refreshAll();
          setInspectorListsRefreshKey((k) => k + 1);
        }}
      />
      {editingWagon && selectedRouteDetail && (
        <PencilEditModal
          isOpen
          onClose={() => setEditingWagon(null)}
          wagonNumber={editingWagon.wagon_number}
          weightKg={editingWagon.declared_weight_kg}
          notes={editingWagon.notes || ''}
          onSave={async (updated) => {
            try {
              await api(`/api/routes/${selectedRouteDetail.id}/wagons/${editingWagon.wagon_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  wagon_number: updated.parsed_wagon_number,
                  declared_weight_kg: updated.weight_kg,
                  notes: updated.notes,
                }),
              });
              setEditingWagon(null);
              showToast(ru.toast.saved);
              refreshAll();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : ru.errors.generic);
            }
          }}
        />      )}
      {editingRoute && (
        <EditRouteModal
          isOpen
          onClose={() => setEditingRoute(null)}
          route={editingRoute}
          productTypes={productTypes}
          stations={stations}
          onSaved={() => { showToast(ru.toast.saved); refreshAll(); }}
        />
      )}
    </div>
  );
}

export default App;
