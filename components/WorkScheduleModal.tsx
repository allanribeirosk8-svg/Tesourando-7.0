import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  X, 
  Clock, 
  Coffee, 
  Plus, 
  Trash2, 
  Check, 
  AlertTriangle, 
  ChevronDown, 
  User, 
  AlertCircle, 
  Loader2,
  Calendar,
  Sparkles
} from 'lucide-react';
import { useStore } from '../context/Store';
import { DayConfig, Staff, StaffAvailability } from '../types';

export interface WorkScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetStaffId?: string;
  targetStaffName?: string;
  canChooseStaff?: boolean;
  staffOptions?: Staff[];
  onTargetStaffChange?: (staffId: string) => void;
  initialSchedule?: Record<number, DayConfig>;
  onSave?: (schedule: Record<number, DayConfig>) => Promise<void>;
  onSuccess?: (msg: string) => void;
}

const DAYS_CONFIG = [
  { index: 0, short: 'DOM', full: 'Domingo' },
  { index: 1, short: 'SEG', full: 'Segunda-feira' },
  { index: 2, short: 'TER', full: 'Terça-feira' },
  { index: 3, short: 'QUA', full: 'Quarta-feira' },
  { index: 4, short: 'QUI', full: 'Quinta-feira' },
  { index: 5, short: 'SEX', full: 'Sexta-feira' },
  { index: 6, short: 'SÁB', full: 'Sábado' },
];

const DEFAULT_SCHEDULE_FALLBACK: Record<number, DayConfig> = {
  0: { start: '09:00', end: '18:00', isOpen: false, breaks: [] },
  1: { start: '09:00', end: '18:00', isOpen: true, breaks: [] },
  2: { start: '09:00', end: '18:00', isOpen: true, breaks: [] },
  3: { start: '09:00', end: '18:00', isOpen: true, breaks: [] },
  4: { start: '09:00', end: '18:00', isOpen: true, breaks: [] },
  5: { start: '09:00', end: '18:00', isOpen: true, breaks: [] },
  6: { start: '09:00', end: '18:00', isOpen: true, breaks: [] },
};

function normalizeTime(t: string): string {
  if (!t) return '09:00';
  const parts = t.split(':');
  if (parts.length >= 2) {
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    return `${h}:${m}`;
  }
  return t;
}

function timeToMinutes(t: string): number {
  const [h, m] = normalizeTime(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateTimeSlots(startTime: string, endTime: string, stepMinutes: number = 30): string[] {
  const startMins = timeToMinutes(startTime);
  const endMins = timeToMinutes(endTime);
  if (startMins >= endMins) return [];

  const slots: string[] = [];
  for (let m = startMins; m < endMins; m += stepMinutes) {
    slots.push(minutesToTime(m));
  }
  return slots;
}

function groupConsecutiveBreaks(breaks: string[]): Array<{ id: string; start: string; end: string; slots: string[] }> {
  if (!breaks || breaks.length === 0) return [];
  
  const sortedMins = Array.from(new Set(breaks.map(timeToMinutes))).sort((a, b) => a - b);
  const groups: Array<{ id: string; start: string; end: string; slots: string[] }> = [];

  let currentStart = sortedMins[0];
  let currentPrev = sortedMins[0];
  let currentSlots = [minutesToTime(sortedMins[0])];

  for (let i = 1; i < sortedMins.length; i++) {
    const min = sortedMins[i];
    if (min === currentPrev + 30) {
      currentPrev = min;
      currentSlots.push(minutesToTime(min));
    } else {
      groups.push({
        id: `${minutesToTime(currentStart)}-${minutesToTime(currentPrev + 30)}`,
        start: minutesToTime(currentStart),
        end: minutesToTime(currentPrev + 30),
        slots: currentSlots
      });
      currentStart = min;
      currentPrev = min;
      currentSlots = [minutesToTime(min)];
    }
  }

  groups.push({
    id: `${minutesToTime(currentStart)}-${minutesToTime(currentPrev + 30)}`,
    start: minutesToTime(currentStart),
    end: minutesToTime(currentPrev + 30),
    slots: currentSlots
  });

  return groups;
}

export const WorkScheduleModal: React.FC<WorkScheduleModalProps> = ({
  isOpen,
  onClose,
  targetStaffId: initialTargetStaffId,
  targetStaffName: initialTargetStaffName,
  canChooseStaff: propCanChooseStaff,
  staffOptions: propStaffOptions,
  onTargetStaffChange,
  initialSchedule,
  onSave,
  onSuccess
}) => {
  const { 
    staff: storeStaff, 
    currentStaff, 
    userRole, 
    session,
    getStaffAvailability, 
    saveStaffAvailability, 
    weeklySchedule: storeWeeklySchedule 
  } = useStore();

  const isOwnerOrAdmin = userRole === 'admin_owner' || userRole === 'admin';
  const canChooseStaff = propCanChooseStaff !== undefined ? propCanChooseStaff : isOwnerOrAdmin;

  const validStaffList: Staff[] = useMemo(() => {
    if (propStaffOptions && propStaffOptions.length > 0) {
      return propStaffOptions;
    }
    return (storeStaff || []).filter(s => !!s && !!s.id);
  }, [propStaffOptions, storeStaff]);

  // Determine active staff ID
  const [selectedStaffId, setSelectedStaffId] = useState<string>(() => {
    if (initialTargetStaffId) return initialTargetStaffId;
    if (!isOwnerOrAdmin) {
      if (currentStaff?.id) return currentStaff.id;
      if (session?.user?.id) {
        const found = (storeStaff || []).find(s => s.userId === session.user.id);
        if (found?.id) return found.id;
      }
    }
    if (validStaffList.length > 0) return validStaffList[0].id;
    return currentStaff?.id || '';
  });

  // Sync staff ID for non-owners if currentStaff loads later
  useEffect(() => {
    if (!isOwnerOrAdmin) {
      const selfId = currentStaff?.id || (session?.user?.id ? storeStaff.find(s => s.userId === session.user.id)?.id : undefined);
      if (selfId && (!selectedStaffId || selectedStaffId !== selfId)) {
        setSelectedStaffId(selfId);
      }
    }
  }, [isOwnerOrAdmin, currentStaff?.id, session?.user?.id, storeStaff, selectedStaffId]);

  const activeStaffMember = useMemo(() => {
    return validStaffList.find(s => s.id === selectedStaffId) || currentStaff || null;
  }, [validStaffList, selectedStaffId, currentStaff]);

  const displayName = useMemo(() => {
    if (!isOwnerOrAdmin) {
      return currentStaff?.name || initialTargetStaffName || 'Meu Horário';
    }
    return activeStaffMember?.name || initialTargetStaffName || 'Profissional';
  }, [isOwnerOrAdmin, activeStaffMember, currentStaff, initialTargetStaffName]);

  const [selectedDay, setSelectedDay] = useState<number>(() => new Date().getDay());
  const [isLoadingAvailability, setIsLoadingAvailability] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  // Schedules state
  const [draftSchedule, setDraftSchedule] = useState<Record<number, DayConfig>>(DEFAULT_SCHEDULE_FALLBACK);
  const originalScheduleRef = useRef<Record<number, DayConfig>>(DEFAULT_SCHEDULE_FALLBACK);

  // UI Dropdowns and Sub-modals
  const [isStaffDropdownOpen, setIsStaffDropdownOpen] = useState(false);
  const [isDiscardModalOpen, setIsDiscardModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'close' | { type: 'switch_staff'; staffId: string } | null>(null);

  // Continuous Interval Form State
  const [isAddingInterval, setIsAddingInterval] = useState(false);
  const [intervalStart, setIntervalStart] = useState('12:00');
  const [intervalEnd, setIntervalEnd] = useState('13:30');
  const [intervalError, setIntervalError] = useState<string | null>(null);

  // Synchronize targetStaffId prop if it changes externally
  useEffect(() => {
    if (initialTargetStaffId && initialTargetStaffId !== selectedStaffId) {
      setSelectedStaffId(initialTargetStaffId);
    }
  }, [initialTargetStaffId]);

  // Load schedule for active staff ID
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    async function loadData() {
      setIsLoadingAvailability(true);
      setSaveError(null);

      try {
        let scheduleToSet: Record<number, DayConfig> = { ...DEFAULT_SCHEDULE_FALLBACK };

        // If direct initialSchedule prop was given and matches
        if (initialSchedule && Object.keys(initialSchedule).length > 0) {
          scheduleToSet = { ...DEFAULT_SCHEDULE_FALLBACK, ...initialSchedule };
        } else if (selectedStaffId) {
          // Fetch from Supabase via getStaffAvailability
          const availabilities = await getStaffAvailability(selectedStaffId);
          if (availabilities && availabilities.length > 0) {
            availabilities.forEach(a => {
              scheduleToSet[a.dayOfWeek] = {
                start: normalizeTime(a.startTime || '09:00'),
                end: normalizeTime(a.endTime || '18:00'),
                isOpen: a.isOpen !== false,
                breaks: (a.breaks || []).map(normalizeTime).filter(Boolean)
              };
            });
          } else if (storeWeeklySchedule && Object.keys(storeWeeklySchedule).length > 0) {
            // Fallback to store weekly schedule if staff has no specific records yet
            scheduleToSet = { ...DEFAULT_SCHEDULE_FALLBACK, ...storeWeeklySchedule };
          }
        }

        if (isMounted) {
          const cloned = JSON.parse(JSON.stringify(scheduleToSet));
          setDraftSchedule(cloned);
          originalScheduleRef.current = JSON.parse(JSON.stringify(cloned));
          setIsAddingInterval(false);
          setIntervalError(null);
        }
      } catch (err) {
        console.error('[WorkScheduleModal] Erro ao carregar horários do staff:', err);
      } finally {
        if (isMounted) {
          setIsLoadingAvailability(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedStaffId, getStaffAvailability, initialSchedule, storeWeeklySchedule]);

  // Compute dirty state
  const isDirty = useMemo(() => {
    return JSON.stringify(draftSchedule) !== JSON.stringify(originalScheduleRef.current);
  }, [draftSchedule]);

  // Check which days have unsaved modifications
  const modifiedDaysMap = useMemo(() => {
    const map: Record<number, boolean> = {};
    for (let d = 0; d <= 6; d++) {
      const orig = originalScheduleRef.current[d];
      const draft = draftSchedule[d];
      map[d] = JSON.stringify(orig) !== JSON.stringify(draft);
    }
    return map;
  }, [draftSchedule]);

  // Close handler with confirmation
  const handleRequestClose = () => {
    if (isDirty) {
      setPendingAction('close');
      setIsDiscardModalOpen(true);
    } else {
      onClose();
    }
  };

  // Staff switch handler with confirmation
  const handleSelectStaff = (newStaffId: string) => {
    setIsStaffDropdownOpen(false);
    if (newStaffId === selectedStaffId) return;

    if (isDirty) {
      setPendingAction({ type: 'switch_staff', staffId: newStaffId });
      setIsDiscardModalOpen(true);
    } else {
      setSelectedStaffId(newStaffId);
      onTargetStaffChange?.(newStaffId);
    }
  };

  // Confirm discard
  const handleConfirmDiscard = () => {
    setIsDiscardModalOpen(false);
    if (pendingAction === 'close') {
      setPendingAction(null);
      onClose();
    } else if (pendingAction && pendingAction.type === 'switch_staff') {
      const nextId = pendingAction.staffId;
      setPendingAction(null);
      setSelectedStaffId(nextId);
      onTargetStaffChange?.(nextId);
    }
  };

  // Current day config
  const currentDayConfig: DayConfig = useMemo(() => {
    return draftSchedule[selectedDay] || { start: '09:00', end: '18:00', isOpen: true, breaks: [] };
  }, [draftSchedule, selectedDay]);

  // Update day config in draft
  const updateCurrentDay = (partial: Partial<DayConfig>) => {
    setDraftSchedule(prev => ({
      ...prev,
      [selectedDay]: {
        ...prev[selectedDay],
        ...partial
      }
    }));
  };

  // Toggle single slot break
  const handleToggleSlotBreak = (slotTime: string) => {
    const normalizedSlot = normalizeTime(slotTime);
    const existingBreaks = currentDayConfig.breaks || [];
    const isPaused = existingBreaks.includes(normalizedSlot);

    let updatedBreaks: string[];
    if (isPaused) {
      updatedBreaks = existingBreaks.filter(b => b !== normalizedSlot);
    } else {
      updatedBreaks = Array.from(new Set([...existingBreaks, normalizedSlot])).sort();
    }

    updateCurrentDay({ breaks: updatedBreaks });
  };

  // Add continuous interval
  const handleAddContinuousInterval = () => {
    setIntervalError(null);
    const normStart = normalizeTime(intervalStart);
    const normEnd = normalizeTime(intervalEnd);

    const startM = timeToMinutes(normStart);
    const endM = timeToMinutes(normEnd);
    const dayStartM = timeToMinutes(currentDayConfig.start);
    const dayEndM = timeToMinutes(currentDayConfig.end);

    if (startM >= endM) {
      setIntervalError('O horário de início deve ser menor que o horário de término.');
      return;
    }

    if (startM < dayStartM || endM > dayEndM) {
      setIntervalError(`O intervalo deve estar dentro do horário de atendimento (${currentDayConfig.start} às ${currentDayConfig.end}).`);
      return;
    }

    // Generate slots in 30-min intervals
    const newSlots = generateTimeSlots(normStart, normEnd, 30);
    if (newSlots.length === 0) {
      setIntervalError('Intervalo inválido.');
      return;
    }

    const merged = Array.from(new Set([...(currentDayConfig.breaks || []), ...newSlots])).sort();
    updateCurrentDay({ breaks: merged });
    setIsAddingInterval(false);
  };

  // Remove grouped interval
  const handleRemoveGroupedInterval = (slotsToRemove: string[]) => {
    const existingBreaks = currentDayConfig.breaks || [];
    const updated = existingBreaks.filter(b => !slotsToRemove.includes(b));
    updateCurrentDay({ breaks: updated });
  };

  // Generated slots for current day
  const daySlots = useMemo(() => {
    if (!currentDayConfig.isOpen) return [];
    return generateTimeSlots(currentDayConfig.start, currentDayConfig.end, 30);
  }, [currentDayConfig.start, currentDayConfig.end, currentDayConfig.isOpen]);

  // Grouped intervals
  const groupedIntervals = useMemo(() => {
    return groupConsecutiveBreaks(currentDayConfig.breaks || []);
  }, [currentDayConfig.breaks]);

  // Calculate available slots
  const availableSlotsCount = useMemo(() => {
    if (!currentDayConfig.isOpen) return 0;
    const breakCount = (currentDayConfig.breaks || []).filter(b => daySlots.includes(b)).length;
    return Math.max(0, daySlots.length - breakCount);
  }, [currentDayConfig.isOpen, daySlots, currentDayConfig.breaks]);

  // Save Schedule
  const handleSave = async () => {
    setSaveError(null);

    // Validate all open days
    for (const day of DAYS_CONFIG) {
      const config = draftSchedule[day.index];
      if (config.isOpen) {
        if (!config.start || !config.end) {
          setSaveError(`Defina o horário de início e fim para ${day.full}.`);
          setSelectedDay(day.index);
          return;
        }
        if (timeToMinutes(config.start) >= timeToMinutes(config.end)) {
          setSaveError(`Em ${day.full}, o horário de início deve ser menor que o término.`);
          setSelectedDay(day.index);
          return;
        }
      }
    }

    setIsSaving(true);

    try {
      if (onSave) {
        await onSave(draftSchedule);
      } else {
        const staffIdToSave = selectedStaffId || currentStaff?.id;
        if (!staffIdToSave) {
          throw new Error('Identificador de profissional não encontrado.');
        }

        const payload: Omit<StaffAvailability, 'id'>[] = Object.entries(draftSchedule).map(([d, config]) => {
          const cfg = config as DayConfig;
          return {
            staffId: staffIdToSave,
            dayOfWeek: Number(d),
            startTime: cfg.start,
            endTime: cfg.end,
            breaks: cfg.breaks || [],
            isOpen: cfg.isOpen
          };
        });

        await saveStaffAvailability(payload);
      }

      // Update original ref so it's not dirty anymore
      originalScheduleRef.current = JSON.parse(JSON.stringify(draftSchedule));
      setFeedbackToast('Horários atualizados com sucesso!');
      onSuccess?.('Horários de trabalho atualizados com sucesso!');

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('[WorkScheduleModal] Erro ao salvar horários:', err);
      setSaveError(err.message || 'Ocorreu um erro ao salvar os horários. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-schedule-title"
    >
      <div 
        className="relative w-full max-w-xl bg-surface border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between shrink-0 bg-surface/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary/15 border border-secondary/20 flex items-center justify-center text-secondary shrink-0">
              <Clock size={20} />
            </div>
            <div>
              <h2 id="work-schedule-title" className="text-base sm:text-lg font-bold text-white tracking-tight uppercase">
                HORÁRIOS DE TRABALHO
              </h2>
              <p className="text-xs text-title flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                {displayName}
              </p>
            </div>
          </div>

          <button
            onClick={handleRequestClose}
            aria-label="Fechar modal"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-title hover:text-white hover:bg-white/5 active:scale-95 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* PROFESSIONAL SELECTOR (OWNER / ADMIN ONLY) */}
        {canChooseStaff && validStaffList.length > 0 && (
          <div className="px-4 py-3 bg-black/20 border-b border-white/5 relative shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-title uppercase tracking-wider">Profissional</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsStaffDropdownOpen(prev => !prev)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface border border-white/10 hover:border-white/20 active:scale-98 transition-all text-left"
                >
                  <div className="w-6 h-6 rounded-full bg-secondary/20 border border-secondary/30 flex items-center justify-center text-[10px] font-bold text-secondary overflow-hidden shrink-0">
                    {activeStaffMember?.photo ? (
                      <img 
                        src={activeStaffMember.photo} 
                        alt={activeStaffMember.name} 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      activeStaffMember?.name ? activeStaffMember.name.slice(0, 2).toUpperCase() : 'PR'
                    )}
                  </div>
                  <span className="text-sm font-medium text-white max-w-[150px] sm:max-w-[200px] truncate">
                    {activeStaffMember?.name || 'Selecione'}
                  </span>
                  <ChevronDown size={14} className={`text-title transition-transform duration-200 ${isStaffDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {isStaffDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-20" 
                      onClick={() => setIsStaffDropdownOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-1.5 w-64 bg-surface border border-white/10 rounded-xl shadow-2xl z-30 py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                      <div className="px-3 py-1.5 text-[11px] font-semibold text-title uppercase tracking-wider border-b border-white/5">
                        Equipe da Barbearia
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {validStaffList.map(member => {
                          const isSelected = member.id === selectedStaffId;
                          return (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => handleSelectStaff(member.id)}
                              className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                                isSelected ? 'bg-secondary/15 text-white font-medium' : 'text-white/80 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden shrink-0">
                                  {member.photo ? (
                                    <img 
                                      src={member.photo} 
                                      alt={member.name} 
                                      className="w-full h-full object-cover" 
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    member.name.slice(0, 2).toUpperCase()
                                  )}
                                </div>
                                <span className="truncate">{member.name}</span>
                              </div>
                              {isSelected && <Check size={14} className="text-secondary shrink-0 ml-2" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* DAYS HORIZONTAL NAVIGATION */}
        <div className="p-3 sm:px-5 sm:pt-4 border-b border-white/10 shrink-0 bg-surface/50">
          <div 
            className="grid grid-cols-7 gap-1 sm:gap-2"
            role="tablist"
            aria-label="Dias da semana"
          >
            {DAYS_CONFIG.map(day => {
              const isSelected = selectedDay === day.index;
              const config = draftSchedule[day.index] || { isOpen: false };
              const isOpenDay = config.isOpen;
              const isModified = modifiedDaysMap[day.index];

              return (
                <button
                  key={day.index}
                  role="tab"
                  aria-selected={isSelected}
                  aria-label={`${day.full}, ${isOpenDay ? 'Aberto' : 'Fechado'}${isModified ? ', com alterações pendentes' : ''}`}
                  onClick={() => setSelectedDay(day.index)}
                  className={`relative flex flex-col items-center justify-center py-2 sm:py-2.5 px-1 rounded-xl transition-all min-h-[50px] sm:min-h-[56px] ${
                    isSelected 
                      ? 'bg-secondary text-white font-black shadow-lg shadow-secondary/20 scale-[1.02]' 
                      : isOpenDay
                        ? 'bg-white/5 text-white/90 hover:bg-white/10'
                        : 'bg-black/20 text-title/60 hover:bg-black/30'
                  }`}
                >
                  {/* Pending modification indicator dot */}
                  {isModified && (
                    <span 
                      className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ${
                        isSelected ? 'bg-white ring-secondary' : 'bg-amber-400 ring-surface'
                      }`}
                      title="Alterações não salvas neste dia"
                    />
                  )}

                  <span className={`text-xs sm:text-sm font-bold tracking-tight ${isSelected ? 'text-white' : ''}`}>
                    {day.short}
                  </span>

                  {/* Status indicator badge */}
                  <span className="flex items-center gap-1 mt-1">
                    <span 
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected 
                          ? 'bg-white' 
                          : isOpenDay 
                            ? 'bg-emerald-400' 
                            : 'bg-red-400/70'
                      }`}
                    />
                    <span className={`text-[9px] font-semibold leading-none hidden sm:inline ${
                      isSelected ? 'text-white/90' : isOpenDay ? 'text-title' : 'text-title/50'
                    }`}>
                      {isOpenDay ? 'Aberto' : 'Fechado'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* SCROLLABLE DAY CONTENT */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">
          {isLoadingAvailability ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <Loader2 size={32} className="text-secondary animate-spin mb-3" />
              <p className="text-sm text-title">Carregando horários de {displayName}...</p>
            </div>
          ) : (
            <>
              {/* Day Header and Status Switch Card */}
              <div className="p-4 rounded-xl bg-black/25 border border-white/10 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-bold text-white truncate">
                      {DAYS_CONFIG[selectedDay].full}
                    </h3>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                      currentDayConfig.isOpen 
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-white/10 text-title border border-white/10'
                    }`}>
                      {currentDayConfig.isOpen ? 'Ativo' : 'Fechado'}
                    </span>
                  </div>
                  <p className="text-xs text-title mt-0.5 font-medium">
                    {currentDayConfig.isOpen 
                      ? 'Aberto para agendamentos' 
                      : 'Fechado para agendamentos'}
                  </p>
                  <p className="text-[11px] text-title/70 mt-1">
                    {currentDayConfig.isOpen 
                      ? 'Agendamentos ficarão disponíveis conforme o horário configurado.' 
                      : 'Nenhum novo agendamento será aceito neste dia.'}
                  </p>
                </div>

                {/* Accessible and solid visible Toggle Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={currentDayConfig.isOpen}
                  aria-label={`Agendamentos em ${DAYS_CONFIG[selectedDay].full}: ${currentDayConfig.isOpen ? 'Aberto' : 'Fechado'}`}
                  onClick={() => {
                    const nextOpen = !currentDayConfig.isOpen;
                    updateCurrentDay({ isOpen: nextOpen });
                    if (!nextOpen) {
                      setIsAddingInterval(false);
                      setIntervalError(null);
                    }
                  }}
                  className="relative min-w-[48px] min-h-[44px] flex items-center justify-center p-1 cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-full transition-transform active:scale-95 shrink-0"
                >
                  <div
                    className={`w-12 h-7 rounded-full transition-colors duration-200 ease-in-out relative flex items-center p-1 border ${
                      currentDayConfig.isOpen
                        ? 'bg-secondary border-secondary shadow-md shadow-secondary/40'
                        : 'bg-slate-700 border-white/20'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out shrink-0 ${
                        currentDayConfig.isOpen ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </button>
              </div>

              {/* HORÁRIO DE ATENDIMENTO */}
              <div className={`p-4 rounded-xl bg-surface border border-white/10 space-y-3 transition-opacity ${
                !currentDayConfig.isOpen ? 'opacity-50' : 'opacity-100'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
                    <Clock size={15} className="text-secondary" />
                    <span>HORÁRIO DE ATENDIMENTO</span>
                  </div>
                  {!currentDayConfig.isOpen && (
                    <span className="text-[10px] font-semibold text-title bg-white/5 px-2 py-0.5 rounded border border-white/5">
                      Desabilitado (Dia Fechado)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs text-title font-medium mb-1.5">
                      Início do Turno
                    </label>
                    <input
                      type="time"
                      disabled={!currentDayConfig.isOpen}
                      value={currentDayConfig.start}
                      onChange={(e) => updateCurrentDay({ start: e.target.value })}
                      className={`w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white focus:outline-none focus:border-secondary transition-colors ${
                        !currentDayConfig.isOpen ? 'cursor-not-allowed text-title/60' : ''
                      }`}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-title font-medium mb-1.5">
                      Fim do Turno
                    </label>
                    <input
                      type="time"
                      disabled={!currentDayConfig.isOpen}
                      value={currentDayConfig.end}
                      onChange={(e) => updateCurrentDay({ end: e.target.value })}
                      className={`w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white focus:outline-none focus:border-secondary transition-colors ${
                        !currentDayConfig.isOpen ? 'cursor-not-allowed text-title/60' : ''
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* INTERVALOS E PAUSAS */}
              <div className={`p-4 rounded-xl bg-surface border border-white/10 space-y-4 transition-opacity ${
                !currentDayConfig.isOpen ? 'opacity-50' : 'opacity-100'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
                      <Coffee size={15} className="text-secondary" />
                      <span>INTERVALOS E PAUSAS</span>
                    </div>
                    <p className="text-xs text-title mt-0.5">
                      {currentDayConfig.isOpen 
                        ? 'Bloqueie horários em que este profissional não atende.' 
                        : 'Pausas preservadas. Reative o dia para editar.'}
                    </p>
                  </div>

                  {!isAddingInterval && (
                    <button
                      type="button"
                      disabled={!currentDayConfig.isOpen}
                      onClick={() => {
                        if (!currentDayConfig.isOpen) return;
                        setIsAddingInterval(true);
                        setIntervalError(null);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                        currentDayConfig.isOpen
                          ? 'bg-secondary/15 border border-secondary/30 text-secondary hover:bg-secondary/25 active:scale-95'
                          : 'bg-white/5 border border-white/5 text-title/40 cursor-not-allowed'
                      }`}
                    >
                      <Plus size={14} />
                      <span>Adicionar intervalo</span>
                    </button>
                  )}
                </div>

                {/* Continuous Interval Form */}
                {isAddingInterval && currentDayConfig.isOpen && (
                  <div className="p-3.5 rounded-xl bg-black/40 border border-secondary/30 space-y-3 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">Novo Intervalo Contínuo</span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingInterval(false);
                          setIntervalError(null);
                        }}
                        className="text-title hover:text-white"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-title mb-1">De</label>
                        <input
                          type="time"
                          value={intervalStart}
                          onChange={(e) => setIntervalStart(e.target.value)}
                          className="w-full bg-surface border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-secondary"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-title mb-1">Até</label>
                        <input
                          type="time"
                          value={intervalEnd}
                          onChange={(e) => setIntervalEnd(e.target.value)}
                          className="w-full bg-surface border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-secondary"
                        />
                      </div>
                    </div>

                    {intervalError && (
                      <div className="flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>{intervalError}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingInterval(false);
                          setIntervalError(null);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs text-title hover:text-white"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleAddContinuousInterval}
                        className="px-3.5 py-1.5 rounded-lg bg-secondary text-white text-xs font-bold hover:bg-secondary/90 active:scale-95 transition-all shadow-md shadow-secondary/20"
                      >
                        Salvar intervalo
                      </button>
                    </div>
                  </div>
                )}

                {/* Grouped Intervals List */}
                {groupedIntervals.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-title uppercase tracking-wider">
                      Pausas configuradas
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {groupedIntervals.map(group => (
                        <div
                          key={group.id}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${
                            currentDayConfig.isOpen
                              ? 'bg-secondary/15 border-secondary/30 text-white'
                              : 'bg-white/5 border-white/10 text-title/60'
                          }`}
                        >
                          <Coffee size={13} className={currentDayConfig.isOpen ? 'text-secondary shrink-0' : 'text-title/60 shrink-0'} />
                          <span>{group.start} – {group.end}</span>
                          {currentDayConfig.isOpen && (
                            <button
                              type="button"
                              onClick={() => handleRemoveGroupedInterval(group.slots)}
                              title="Remover intervalo"
                              className="text-title hover:text-red-400 ml-1 p-0.5 rounded transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick Selection Grid by Slots */}
                <div>
                  <span className="text-[11px] font-semibold text-title uppercase tracking-wider block mb-2">
                    Pausas Rápidas por Horário {currentDayConfig.isOpen ? '(Clique para alternar)' : '(Desabilitado)'}
                  </span>
                  {daySlots.length === 0 ? (
                    <p className="text-xs text-title/70 italic">
                      {currentDayConfig.isOpen 
                        ? 'Ajuste o horário de início e fim para visualizar os horários.'
                        : 'Nenhum horário disponível para pausas enquanto o dia estiver fechado.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {daySlots.map(slot => {
                        const isPaused = (currentDayConfig.breaks || []).includes(slot);
                        return (
                          <button
                            key={slot}
                            type="button"
                            disabled={!currentDayConfig.isOpen}
                            onClick={() => handleToggleSlotBreak(slot)}
                            className={`py-2 px-1 rounded-xl text-xs font-medium border transition-all flex flex-col items-center justify-center min-h-[44px] ${
                              !currentDayConfig.isOpen
                                ? 'bg-black/20 border-white/5 text-title/30 cursor-not-allowed'
                                : isPaused
                                  ? 'bg-secondary/20 border-secondary text-secondary font-bold shadow-sm cursor-pointer'
                                  : 'bg-black/30 border-white/10 text-white/80 hover:border-white/20 hover:text-white cursor-pointer'
                            }`}
                          >
                            <span>{slot}</span>
                            <span className="text-[9px] mt-0.5 opacity-80">
                              {isPaused ? 'Pausa' : 'Livre'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* RESUMO CARD */}
              <div className="p-4 rounded-xl bg-black/35 border border-white/10 space-y-2 text-xs">
                <div className="flex items-center justify-between text-white">
                  <span className="text-title">Horário de atendimento:</span>
                  <span className="font-semibold text-white">
                    {currentDayConfig.start} às {currentDayConfig.end}
                  </span>
                </div>

                <div className="flex items-center justify-between text-white">
                  <span className="text-title">Intervalos configurados:</span>
                  <span className="font-medium text-white max-w-[200px] text-right truncate">
                    {groupedIntervals.length > 0 
                      ? groupedIntervals.map(g => `${g.start}–${g.end}`).join(', ') 
                      : 'Sem intervalos'}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <span className="text-title">Slots disponíveis:</span>
                  {currentDayConfig.isOpen ? (
                    <span className="font-bold text-secondary text-sm">
                      {availableSlotsCount} atendimentos possíveis
                    </span>
                  ) : (
                    <span className="font-bold text-title text-sm flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                      0 atendimentos · Fechado
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Save Error Banner */}
          {saveError && (
            <div className="p-3.5 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-200 flex items-start gap-2.5 animate-in fade-in duration-150">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-300">Não foi possível salvar</p>
                <p className="mt-0.5">{saveError}</p>
              </div>
            </div>
          )}

          {/* Feedback Banner */}
          {feedbackToast && (
            <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-200 flex items-center gap-2.5 animate-in fade-in duration-150">
              <Check size={16} className="text-emerald-400 shrink-0" />
              <span>{feedbackToast}</span>
            </div>
          )}
        </div>

        {/* FIXED FOOTER */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-surface/95 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleRequestClose}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl border border-white/15 text-sm font-medium text-title hover:text-white hover:border-white/30 active:scale-98 transition-all min-h-[44px] shrink-0"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="text-xs text-amber-400 hidden sm:inline-flex items-center gap-1 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                Alterações não salvas
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || isSaving || isLoadingAvailability}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all min-h-[44px] ${
                !isDirty || isSaving || isLoadingAvailability
                  ? 'bg-white/10 text-title/50 cursor-not-allowed'
                  : 'bg-secondary text-white hover:bg-secondary/90 active:scale-98 shadow-lg shadow-secondary/25'
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Check size={16} />
                  <span>Salvar horários</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* DISCARD CONFIRMATION MODAL */}
      {isDiscardModalOpen && (
        <div 
          className="fixed inset-0 z-[260] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150"
          role="alertdialog"
          aria-labelledby="discard-title"
          aria-describedby="discard-desc"
        >
          <div className="w-full max-w-sm bg-surface border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 id="discard-title" className="text-base font-bold text-white">
                  Descartar alterações?
                </h3>
                <p id="discard-desc" className="text-xs text-title mt-0.5">
                  Você fez alterações nos horários deste profissional. Deseja sair sem salvar?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsDiscardModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-title hover:text-white hover:bg-white/5 transition-all"
              >
                Continuar editando
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold hover:bg-red-500/30 active:scale-95 transition-all"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
