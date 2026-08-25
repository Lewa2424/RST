import React, { useRef } from 'react';
import { Camera, Image as ImageIcon, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { ru } from '../i18n/ru';

export interface ImagePage {
  id: string;
  file: File;
  url: string;
}

interface Props {
  pages: ImagePage[];
  onChange: (pages: ImagePage[]) => void;
}

function toPage(file: File): ImagePage {
  return { id: `${file.name}-${file.size}-${Math.random()}`, file, url: URL.createObjectURL(file) };
}

export function ImagePagesPicker({ pages, onChange }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const next = [...pages, ...Array.from(list).map(toPage)];
    onChange(next);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const remove = (index: number) => {
    URL.revokeObjectURL(pages[index].url);
    onChange(pages.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button type="button" className="btn btn-primary" onClick={() => cameraRef.current?.click()}>
          <Camera className="w-4 h-4" aria-hidden="true" />
          {ru.actions.takePhoto}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => galleryRef.current?.click()}>
          <ImageIcon className="w-4 h-4" aria-hidden="true" />
          {ru.actions.pickGallery}
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={ru.actions.takePhoto}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-label={ru.actions.pickGallery}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {pages.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{ru.images.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {pages.map((page, index) => (
            <li key={page.id} className="card card-metric overflow-hidden">
              <img src={page.url} alt={`Страница ${index + 1}`} className="w-full h-32 object-cover" />
              <div className="p-2 flex items-center justify-between gap-1">
                <span className="text-xs text-[var(--muted)]">стр. {index + 1}</span>
                <div className="flex">
                  <button type="button" className="btn btn-ghost tap p-1" aria-label="Выше" onClick={() => move(index, -1)}>
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button type="button" className="btn btn-ghost tap p-1" aria-label="Ниже" onClick={() => move(index, 1)}>
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button type="button" className="btn btn-ghost tap p-1" aria-label={ru.actions.delete} onClick={() => remove(index)}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
