import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Calendar, Scissors, ThumbsDown, Camera, ChevronRight, Eye, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { formatCurrency, formatDate } from '../utils/helpers';

// Interface das fotos
interface PhotoItem {
  url: string;
  description: string;
  date: string;
}

// Interface do histórico
interface HistoryItem {
  date: string;
  time?: string;
  service: string;
  price?: number;
  status: string;
}

// ==========================================
// 1. CLIENT PHOTOS PREVIEW & CAROUSEL
// ==========================================
interface ClientPhotosPreviewProps {
  localPhotos: PhotoItem[];
  isLoading: boolean;
  onAddPhotoClick: () => void;
  onViewAllClick: () => void;
}

export const ClientPhotosPreview: React.FC<ClientPhotosPreviewProps> = ({
  localPhotos,
  isLoading,
  onAddPhotoClick,
  onViewAllClick,
}) => {
  // Pegamos apenas as 3 fotos mais recentes para o preview
  const previewPhotos = localPhotos.slice(0, 3);

  return (
    <div className="space-y-3 px-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-white text-xs uppercase tracking-widest">Fotos de Acompanhamento</h3>
        {localPhotos.length > 0 && (
          <button 
            onClick={onViewAllClick} 
            className="text-[9px] text-secondary font-black uppercase tracking-widest hover:underline flex items-center gap-1 transition-all"
            id="btn-view-all-photos"
          >
            Ver todas ({localPhotos.length})
            <ChevronRight size={12} strokeWidth={3} />
          </button>
        )}
      </div>

      {/* Carrossel horizontal com limitador de 3 fotos + botão uploader */}
      <div className="flex flex-row overflow-x-auto gap-3 pb-3 pt-1 scrollbar-none scroll-smooth snap-x">
        {/* Botão de Adicionar Foto (sempre visível no início do carrossel) */}
        <div 
          onClick={onAddPhotoClick}
          className="flex flex-col items-center justify-center border-2 border-dashed border-white/20 rounded-2xl bg-white/5 cursor-pointer hover:bg-white/10 active:scale-95 transition-all aspect-[3/4] w-24 shrink-0 snap-start shadow-inner"
          id="btn-carousel-add-photo"
          title="Adicionar nova foto"
        >
          <div className="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center mb-1 text-secondary">
            <Plus size={18} strokeWidth={3} />
          </div>
          <span className="text-[9px] text-white/70 uppercase tracking-wider font-black text-center px-1">Novo</span>
        </div>

        {/* Renderização das fotos (máx 3) */}
        {isLoading && localPhotos.length === 0 ? (
          <div className="flex gap-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="w-24 aspect-[3/4] bg-white/5 rounded-2xl animate-pulse border border-white/10 shrink-0" />
            ))}
          </div>
        ) : previewPhotos.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-6 bg-white/5 rounded-2xl border border-white/5">
            <span className="text-[10px] text-white/40 uppercase tracking-widest font-black">Nenhuma foto adicionada</span>
          </div>
        ) : (
          previewPhotos.map((photo, idx) => (
            <div 
              key={idx} 
              onClick={onViewAllClick}
              className="relative w-24 aspect-[3/4] rounded-2xl overflow-hidden border border-white/10 shadow-md shrink-0 snap-start group cursor-pointer hover:border-secondary/50 transition-all"
            >
              {/* Carregamento preguiçoso da imagem (lazy-load) com placeholder animado */}
              <img 
                src={photo.url} 
                alt={photo.description || 'Foto do cliente'} 
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1.5">
                <span className="text-[8px] text-white font-bold truncate w-full">{photo.description || 'Ver detalhe'}</span>
              </div>
            </div>
          ))
        )}

        {/* Card extra indicando que há mais fotos para ver */}
        {localPhotos.length > 3 && (
          <div 
            onClick={onViewAllClick}
            className="flex flex-col items-center justify-center bg-secondary/10 border border-secondary/20 rounded-2xl cursor-pointer hover:bg-secondary/20 active:scale-95 transition-all aspect-[3/4] w-24 shrink-0 snap-start text-secondary"
          >
            <span className="font-black text-sm leading-none">+{localPhotos.length - 3}</span>
            <span className="text-[8px] uppercase font-black tracking-widest opacity-85 mt-1 text-center">Fotos</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 2. CLIENT PHOTOS FULL GALLERY (BOTTOM SHEET / MODAL)
// ==========================================
interface ClientPhotosGalleryProps {
  isOpen: boolean;
  onClose: () => void;
  customerPhone: string;
  customerName: string;
  localPhotos: PhotoItem[];
}

export const ClientPhotosGallery: React.FC<ClientPhotosGalleryProps> = ({
  isOpen,
  onClose,
  customerPhone,
  customerName,
  localPhotos,
}) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);
  const LIMIT = 6;

  // Carregar lote de fotos
  const loadMorePhotos = useCallback(async (reset = false) => {
    if (isLoading) return;
    setIsLoading(true);
    
    const currentOffset = reset ? 0 : offset;
    
    try {
      if (!isSupabaseConfigured()) {
        // Modo Offline: paginação usando o array local
        const nextPhotos = localPhotos.slice(currentOffset, currentOffset + LIMIT);
        setPhotos(prev => reset ? nextPhotos : [...prev, ...nextPhotos]);
        setOffset(currentOffset + LIMIT);
        setHasMore(currentOffset + LIMIT < localPhotos.length);
        setIsLoading(false);
        return;
      }

      const result = await supabase.auth.getSession();
      const session = result?.data?.session;
      if (!session) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('customer_photos')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('customer_phone', customerPhone)
        .order('date', { ascending: false })
        .range(currentOffset, currentOffset + LIMIT - 1);

      if (error) throw error;

      const normalized = (data || []).map(p => ({
        url: p.url,
        description: p.description || '',
        date: p.date.substring(0, 10)
      }));

      setPhotos(prev => reset ? normalized : [...prev, ...normalized]);
      setOffset(currentOffset + LIMIT);
      setHasMore(normalized.length === LIMIT);
    } catch (err) {
      console.error("Erro ao carregar galeria paginada:", err);
      // Fallback para os dados locais em caso de falha de rede
      if (reset) {
        setPhotos(localPhotos.slice(0, LIMIT));
        setOffset(LIMIT);
        setHasMore(localPhotos.length > LIMIT);
      }
    } finally {
      setIsLoading(false);
    }
  }, [customerPhone, offset, localPhotos, isLoading]);

  useEffect(() => {
    if (isOpen) {
      loadMorePhotos(true);
    } else {
      setPhotos([]);
      setOffset(0);
      setHasMore(true);
      setSelectedPhoto(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/70 backdrop-blur-md transition-all">
      {/* Botão de clique fora para fechar */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Container Principal da Bottom Sheet */}
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 220 }}
        className="relative bg-[#1E1B4B] w-full max-w-lg rounded-t-[2.5rem] border-t border-white/10 px-4 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-2xl z-10 flex flex-col max-h-[85vh] overflow-hidden"
      >
        {/* Indicador de puxar da bottom sheet */}
        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-4 shrink-0" onClick={onClose} />

        {/* Header */}
        <div className="flex justify-between items-start mb-4 shrink-0 px-2">
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Galeria Completa</h2>
            <p className="text-xs text-white/50 font-medium">Fotos de acompanhamento de {customerName}</p>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/15 active:scale-90 transition-all"
            id="btn-close-gallery-bottom-sheet"
          >
            <X size={16} />
          </button>
        </div>

        {/* Conteúdo scrollable */}
        <div className="flex-1 overflow-y-auto px-2 space-y-4 pb-6 scrollbar-none">
          {photos.length === 0 && !isLoading ? (
            <div className="text-center py-16 flex flex-col items-center gap-3">
              <Camera size={40} className="text-white/20 animate-bounce" />
              <p className="text-xs text-white/40 uppercase tracking-widest font-black">Nenhuma foto neste perfil</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {photos.map((photo, idx) => (
                <div 
                  key={idx}
                  onClick={() => setSelectedPhoto(photo)}
                  className="bg-white/5 rounded-2xl p-2 border border-white/5 hover:border-secondary/40 active:scale-98 transition-all cursor-pointer flex flex-col gap-2 group"
                >
                  <div className="aspect-[3/4] rounded-xl overflow-hidden border border-white/5 relative bg-slate-900/40">
                    <img 
                      src={photo.url} 
                      alt={photo.description || 'Foto do cliente'} 
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-0.5 text-[8px] font-bold text-white/80 uppercase">
                      {formatDate(photo.date)}
                    </div>
                  </div>
                  {photo.description && (
                    <p className="text-[10px] text-white/70 italic px-1 leading-snug line-clamp-2">
                      {photo.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Botão Carregar Mais / Lazy loading indicators */}
          {isLoading && (
            <div className="py-4 text-center">
              <RefreshCw className="w-6 h-6 text-secondary animate-spin mx-auto" />
              <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mt-1">Carregando fotos...</p>
            </div>
          )}

          {!isLoading && hasMore && photos.length > 0 && (
            <button
              onClick={() => loadMorePhotos(false)}
              className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest text-[10px] border border-white/10 transition-colors mt-2"
              id="btn-load-more-photos"
            >
              Carregar Mais Fotos
            </button>
          )}

          {!hasMore && photos.length > 0 && (
            <div className="text-center py-4">
              <span className="text-[9px] text-white/30 uppercase tracking-widest font-black">• Fim da galeria •</span>
            </div>
          )}
        </div>
      </motion.div>

      {/* Lightbox para Visualização Ampliada da Foto em Detalhe */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/95 backdrop-blur-lg p-4"
          >
            {/* Fechar Lightbox */}
            <button 
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-6 right-6 w-11 h-11 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-all z-10 active:scale-90"
              id="btn-close-lightbox"
            >
              <X size={20} />
            </button>

            {/* Imagem Ampliada */}
            <motion.div 
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", damping: 25 }}
              className="w-full max-w-md flex flex-col items-center gap-4 px-2"
            >
              <div className="w-full rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl bg-slate-900/60 max-h-[68vh] flex items-center justify-center">
                <img 
                  src={selectedPhoto.url} 
                  alt={selectedPhoto.description} 
                  className="max-w-full max-h-[68vh] object-contain rounded-2xl"
                  referrerPolicy="no-referrer"
                />
              </div>

              {/* Informações da Foto */}
              <div className="text-center space-y-1 bg-white/5 border border-white/10 rounded-[1.5rem] p-4 w-full">
                <div className="inline-flex items-center gap-1 text-[9px] bg-secondary/20 text-secondary border border-secondary/20 rounded-full px-3 py-0.5 font-bold uppercase tracking-widest mb-1">
                  <Calendar size={10} />
                  {formatDate(selectedPhoto.date)}
                </div>
                {selectedPhoto.description ? (
                  <p className="text-sm font-medium text-white/90 leading-relaxed italic px-2">
                    "{selectedPhoto.description}"
                  </p>
                ) : (
                  <p className="text-xs text-white/40 font-medium">Sem descrição adicionada</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};


// ==========================================
// 3. CLIENT HISTORY PREVIEW
// ==========================================
interface ClientHistoryPreviewProps {
  localHistory: HistoryItem[];
  isLoading: boolean;
  onViewAllClick: () => void;
}

export const ClientHistoryPreview: React.FC<ClientHistoryPreviewProps> = ({
  localHistory,
  isLoading,
  onViewAllClick,
}) => {
  // Filtramos e pegamos apenas os 3 atendimentos mais recentes
  const recentHistory = localHistory.slice(0, 3);

  return (
    <div className="space-y-3 px-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-white text-xs uppercase tracking-widest">Histórico Recente</h3>
        {localHistory.length > 0 && (
          <button 
            onClick={onViewAllClick} 
            className="text-[9px] text-secondary font-black uppercase tracking-widest hover:underline flex items-center gap-1 transition-all"
            id="btn-view-all-history"
          >
            Ver histórico ({localHistory.length})
            <ChevronRight size={12} strokeWidth={3} />
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {isLoading && localHistory.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-16 bg-white/5 rounded-xl animate-pulse border border-white/5" />
            ))}
          </div>
        ) : localHistory.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center bg-white/5 rounded-2xl border border-white/5">
            <Scissors size={28} className="text-white/20" />
            <p className="font-bold text-white/40 uppercase tracking-widest text-xs">Primeiro atendimento a caminho!</p>
          </div>
        ) : (
          <>
            {recentHistory.map((item, idx) => {
              const isNoShow = item.status === 'no-show' || item.service.includes('Falta registrada');
              return (
                <div 
                  key={idx} 
                  className={`px-4 py-3 rounded-2xl flex justify-between items-center bg-surface border border-white/5 transition-all hover:bg-white/[0.02] ${isNoShow ? "border-amber-500/20" : ""}`}
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <span className={`text-xs font-bold block truncate ${isNoShow ? "text-amber-300" : "text-white"}`}>
                      {item.service}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-white/50 font-bold uppercase">{formatDate(item.date)}</span>
                      {item.time && <span className="text-[9px] text-white/30 font-medium uppercase">{item.time}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {item.price && item.price > 0 ? (
                      <span className="text-[11px] font-black text-white/80">{formatCurrency(item.price)}</span>
                    ) : null}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isNoShow ? "bg-amber-500/10 text-amber-300" : "bg-green-500/10 text-green-400"}`}>
                      {isNoShow ? <ThumbsDown size={13} /> : '✓'}
                    </div>
                  </div>
                </div>
              );
            })}

            {localHistory.length > 3 && (
              <button
                onClick={onViewAllClick}
                className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest text-[10px] border border-white/10 transition-colors"
                id="btn-preview-view-all-history"
              >
                Ver Histórico Completo ({localHistory.length})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};


// ==========================================
// 4. CLIENT HISTORY FULL (BOTTOM SHEET / MODAL)
// ==========================================
interface ClientHistoryFullProps {
  isOpen: boolean;
  onClose: () => void;
  customerPhone: string;
  customerName: string;
  localHistory: HistoryItem[];
}

export const ClientHistoryFull: React.FC<ClientHistoryFullProps> = ({
  isOpen,
  onClose,
  customerPhone,
  customerName,
  localHistory,
}) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const LIMIT = 10;

  // Carregar lote de histórico
  const loadMoreHistory = useCallback(async (reset = false) => {
    if (isLoading) return;
    setIsLoading(true);
    
    const currentOffset = reset ? 0 : offset;
    
    try {
      if (!isSupabaseConfigured()) {
        // Modo Offline: paginação local
        const nextHistory = localHistory.slice(currentOffset, currentOffset + LIMIT);
        setHistory(prev => reset ? nextHistory : [...prev, ...nextHistory]);
        setOffset(currentOffset + LIMIT);
        setHasMore(currentOffset + LIMIT < localHistory.length);
        setIsLoading(false);
        return;
      }

      const result = await supabase.auth.getSession();
      const session = result?.data?.session;
      if (!session) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('phone', customerPhone)
        .in('status', ['completed', 'no-show'])
        .order('date', { ascending: false })
        .range(currentOffset, currentOffset + LIMIT - 1);

      if (error) throw error;

      const normalized = (data || []).map(apt => ({
        date: apt.date.substring(0, 10),
        time: apt.time.substring(0, 5),
        service: apt.status === 'no-show' ? 'Falta registrada' : apt.service,
        price: apt.status === 'no-show' ? 0 : Number(apt.price),
        status: apt.status
      }));

      setHistory(prev => reset ? normalized : [...prev, ...normalized]);
      setOffset(currentOffset + LIMIT);
      setHasMore(normalized.length === LIMIT);
    } catch (err) {
      console.error("Erro ao carregar histórico paginado:", err);
      if (reset) {
        setHistory(localHistory.slice(0, LIMIT));
        setOffset(LIMIT);
        setHasMore(localHistory.length > LIMIT);
      }
    } finally {
      setIsLoading(false);
    }
  }, [customerPhone, offset, localHistory, isLoading]);

  useEffect(() => {
    if (isOpen) {
      loadMoreHistory(true);
    } else {
      setHistory([]);
      setOffset(0);
      setHasMore(true);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/70 backdrop-blur-sm transition-all">
      <div className="absolute inset-0" onClick={onClose} />

      {/* Container Principal da Bottom Sheet de Histórico */}
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 220 }}
        className="relative bg-[#1E1B4B] w-full max-w-lg rounded-t-[2.5rem] border-t border-white/10 px-4 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-2xl z-10 flex flex-col max-h-[85vh] overflow-hidden"
      >
        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-4 shrink-0" onClick={onClose} />

        {/* Header */}
        <div className="flex justify-between items-start mb-4 shrink-0 px-2">
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Histórico Completo</h2>
            <p className="text-xs text-white/50 font-medium">Todos os atendimentos de {customerName}</p>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/15 active:scale-90 transition-all"
            id="btn-close-history-bottom-sheet"
          >
            <X size={16} />
          </button>
        </div>

        {/* Conteúdo scrollable */}
        <div className="flex-1 overflow-y-auto px-2 space-y-3 pb-6 scrollbar-none">
          {history.length === 0 && !isLoading ? (
            <div className="text-center py-16 flex flex-col items-center gap-3">
              <Scissors size={40} className="text-white/20" />
              <p className="text-xs text-white/40 uppercase tracking-widest font-black">Nenhum atendimento realizado</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item, idx) => {
                const isNoShow = item.status === 'no-show' || item.service.includes('Falta registrada');
                return (
                  <div 
                    key={idx} 
                    className={`px-4 py-3 rounded-2xl flex justify-between items-center bg-surface border border-white/5 shadow-sm ${isNoShow ? "border-amber-500/20 bg-amber-500/[0.02]" : ""}`}
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <span className={`text-xs font-bold block leading-tight ${isNoShow ? "text-amber-300" : "text-white"}`}>
                        {item.service}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-white/50 font-bold uppercase">{formatDate(item.date)}</span>
                        {item.time && <span className="text-[9px] text-white/30 font-medium uppercase">{item.time}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {item.price && item.price > 0 ? (
                        <span className="text-[11px] font-black text-white/80">{formatCurrency(item.price)}</span>
                      ) : null}
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isNoShow ? "bg-amber-500/10 text-amber-300" : "bg-green-500/10 text-green-400"}`}>
                        {isNoShow ? <ThumbsDown size={13} /> : '✓'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Indicadores de carregamento */}
          {isLoading && (
            <div className="py-4 text-center">
              <RefreshCw className="w-6 h-6 text-secondary animate-spin mx-auto" />
              <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mt-1">Carregando histórico...</p>
            </div>
          )}

          {!isLoading && hasMore && history.length > 0 && (
            <button
              onClick={() => loadMoreHistory(false)}
              className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest text-[10px] border border-white/10 transition-colors mt-2"
              id="btn-load-more-history"
            >
              Carregar Mais Atendimentos
            </button>
          )}

          {!hasMore && history.length > 0 && (
            <div className="text-center py-4">
              <span className="text-[9px] text-white/30 uppercase tracking-widest font-black">• Fim do histórico •</span>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
