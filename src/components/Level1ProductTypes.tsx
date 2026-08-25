import React from 'react';
import { ProductType } from '../types';
import { Plus, Package } from 'lucide-react';
import { ru } from '../i18n/ru';
import { LoadingState } from './LoadingState';

interface Props {
  productTypes: ProductType[];
  onSelectProductType: (productType: ProductType) => void;
  onOpenAddProductTypeModal: () => void;
  loading: boolean;
}

export const Level1ProductTypes: React.FC<Props> = ({
  productTypes,
  onSelectProductType,
  onOpenAddProductTypeModal,
  loading,
}) => {
  return (
    <div className="space-y-5">
      <div className="card p-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl">{ru.level1.title}</h1>
          <p className="text-[var(--muted)] mt-1">{ru.level1.subtitle}</p>
        </div>
        <button type="button" className="btn btn-primary self-start" onClick={onOpenAddProductTypeModal}>
          <Plus className="w-4 h-4" /> {ru.level1.addType}
        </button>
      </div>

      {loading ? (
        <LoadingState label={ru.level1.loading} skeletons={2} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {productTypes.map((pt) => {
            const openDisc = pt.open_discrepancies_count || 0;
            return (
              <button
                key={pt.id}
                type="button"
                onClick={() => onSelectProductType(pt)}
                className="card card-interactive text-left p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-xl bg-[var(--steel-soft)] text-[var(--steel)] flex items-center justify-center">
                      <Package className="w-5 h-5" />
                    </span>
                    <h2 className="text-xl">{pt.name}</h2>
                  </div>
                  <span className={`badge ${openDisc ? 'badge-err' : 'badge-ok'}`}>
                    {openDisc ? `${openDisc} ${ru.level1.discrepancies}` : ru.level1.ok}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 mt-4 text-sm">
                  <div className="bg-[var(--paper)] rounded-lg p-3">
                    <dt className="text-[var(--muted)]">{ru.level1.routes}</dt>
                    <dd className="text-xl font-semibold">{pt.active_routes_count || 0}</dd>
                  </div>
                  <div className="bg-[var(--paper)] rounded-lg p-3">
                    <dt className="text-[var(--muted)]">{ru.level1.closed}</dt>
                    <dd className="text-xl font-semibold">{pt.closed_routes_count || 0}</dd>
                  </div>
                  <div className="bg-[var(--paper)] rounded-lg p-3">
                    <dt className="text-[var(--muted)]">{ru.level1.wagons}</dt>
                    <dd className="text-xl font-semibold">{pt.total_wagons_count || 0}</dd>
                  </div>
                  <div className="bg-[var(--wait-soft)] rounded-lg p-3">
                    <dt className="text-[var(--wait)]">{ru.level1.pending}</dt>
                    <dd className="font-semibold text-[var(--wait)]">{pt.unprocessed_wagons_count || 0}</dd>
                  </div>
                </dl>
                <div className="mt-4 text-[var(--steel)] font-semibold">{ru.level1.go} →</div>
              </button>
            );
          })}
          <button type="button" onClick={onOpenAddProductTypeModal} className="card card-interactive border-dashed p-8 text-center min-h-[180px]">
            <Plus className="w-8 h-8 mx-auto text-[var(--steel)]" />
            <p className="mt-2 font-semibold">{ru.level1.addType}</p>
          </button>
        </div>
      )}
    </div>
  );
};
