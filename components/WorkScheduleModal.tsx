import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  X, 
  Clock, 
  Coffee, 
  Plus, 
  Trash2, 
  Check, 
  AlertTriangle, 
  ChevronDown, 
  Loader2,
  Copy,
  CalendarOff
} from 'lucide-react';
import { useStore } from '../context/Store';
import { DayConfig, Staff, StaffAvailability } from '../types';
import { supabaseService } from '../services/supabaseService';

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

export interface BreakIntervalItem {
  id: string;
  start: string;
  end: string;
}

const DAYS_CONFIG = [
  { index: 0, short: 'DOM', letter: 'D', full: 'Domingo' },
  { index: 1, short: 'SEG', letter: 'S', full: 'Segunda-feira' },
  { index: 2, short: 'TER', letter: 'T', full: 'Terça-feira' },
  { index: 3, short: 'QUA', letter: 'Q', full: 'Quarta-feira' },
  { index: 4, short: 'QUI', letter: 'Q', full: 'Quinta-feira' },
  { index: 5, short: 'SEX', letter: 'S', full: 'Sexta-feira' },
  { index: 6, short: 'SÁB', letter: 'S', full: 'Sábado' },
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
  if (t.startsWith('24:00')) return '24:00';
  const parts = t.split(':');
  if (parts.length >= 2) {
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    return `${h}:${m}`;
  }
  return t;
}

function timeToMinutes(t: string): number {
  const norm = normalizeTime(t);
  if (norm === '24:00') return 24 * 60;
  const [h, m] = norm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  if (mins >= 24 * 60) return '24:00';
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

const ALL_SHIFT_START_OPTIONS: string[] = (() => {
  const opts: string[] = [];
  for (let m = 0; m <= 23 * 60 + 30; m += 30) {
    opts.push(minutesToTime(m));
  }
  return opts;
})();

const ALL_SHIFT_END_OPTIONS: string[] = (() => {
  const opts: string[] = [];
  for (let m = 30; m <= 24 * 60; m += 30) {
    opts.push(minutesToTime(m));
  }
  return opts;
})();

function slotsToBreakIntervals(breaks: string[]): BreakIntervalItem[] {
  if (!breaks || breaks.length === 0) return [];
  const sortedMins = Array.from(
    new Set(breaks.map(b => normalizeTime(b)).filter(Boolean).map(timeToMinutes))
  ).sort((a, b) => a - b);

  if (sortedMins.length === 0) return [];

  const groups: BreakIntervalItem[] = [];
  let curStart = sortedMins[0];
  let curEnd = sortedMins[0] + 30;

  for (let i = 1; i < sortedMins.length; i++) {
    const m = sortedMins[i];
    if (m <= curEnd) {
      curEnd = Math.max(curEnd, m + 30);
    } else {
      groups.push({
        id: `brk-${curStart}-${curEnd}-${groups.length}`,
        start: minutesToTime(curStart),
        end: minutesToTime(curEnd)
      });
      curStart = m;
      curEnd = m + 30;
    }
  }

  groups.push({
    id: `brk-${curStart}-${curEnd}-${groups.length}`,
    start: minutesToTime(curStart),
    end: minutesToTime(curEnd)
  });

  return groups;
}

function mergeBreakIntervals(
  intervals: BreakIntervalItem[],
  shiftStart?: string,
  shiftEnd?: string
): BreakIntervalItem[] {
  if (!intervals || intervals.length === 0) return [];

  const minBound = shiftStart ? timeToMinutes(shiftStart) : 0;
  const maxBound = shiftEnd ? timeToMinutes(shiftEnd) : 24 * 60;

  const validRanges: Array<{ startM: number; endM: number }> = [];
  for (const item of intervals) {
    let s = timeToMinutes(item.start);
    let e = timeToMinutes(item.end);
    if (shiftStart !== undefined && shiftEnd !== undefined) {
      s = Math.max(minBound, Math.min(maxBound, s));
      e = Math.max(minBound, Math.min(maxBound, e));
    }
    if (e > s) {
      validRanges.push({ startM: s, endM: e });
    }
  }

  if (validRanges.length === 0) return [];

  validRanges.sort((a, b) => a.startM - b.startM || a.endM - b.endM);

  const merged: Array<{ startM: number; endM: number }> = [validRanges[0]];
  for (let i = 1; i < validRanges.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = validRanges[i];
    if (curr.startM <= prev.endM) {
      prev.endM = Math.max(prev.endM, curr.endM);
    } else {
      merged.push({ ...curr });
    }
  }

  return merged.map((r, idx) => ({
    id: `brk-${r.startM}-${r.endM}-${idx}`,
    start: minutesToTime(r.startM),
    end: minutesToTime(r.endM)
  }));
}

function intervalsToSlots(
  intervals: BreakIntervalItem[],
  shiftStart?: string,
  shiftEnd?: string
): string[] {
  const merged = mergeBreakIntervals(intervals, shiftStart, shiftEnd);
  const slotSet = new Set<string>();
  for (const item of merged) {
    const slots = generateTimeSlots(item.start, item.end, 30);
    slots.forEach(s => slotSet.add(s));
  }
  return Array.from(slotSet).sort();
}

function formatDurationMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) return 'sem pausa';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h${mins}m de pausa`;
  if (hours > 0) return `${hours}h de pausa`;
  return `${mins}min de pausa`;
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

  const isOwnerStaffMember = useCallback((member: Staff | null | undefined) => {
    if (!member) return false;
    if (
      member.membershipRole === 'owner' ||
      member.role === 'owner' ||
      (member.role as any) === 'admin_owner'
    ) {
      return true;
    }
    if (
      userRole === 'admin_owner' &&
      session?.user?.id &&
      (member.userId === session.user.id || member.id === session.user.id)
    ) {
      return true;
    }
    return false;
  }, [userRole, session?.user?.id]);

  // Determine active staff ID
  const [selectedStaffId, setSelectedStaffId] = useState<string>(() => {
    if (initialTargetStaffId) return initialTargetStaffId;
    if (currentStaff?.id) return currentStaff.id;
    if (session?.user?.id) {
      const found = (storeStaff || []).find(s => s.userId === session.user.id || s.id === session.user.id);
      if (found?.id) return found.id;
    }
    if (validStaffList.length > 0) return validStaffList[0].id;
    return '';
  });

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
  const [replicateFeedback, setReplicateFeedback] = useState<string | null>(null);
  const replicateTimerRef = useRef<any>(null);

  // Schedules & Inline Intervals state
  const [draftSchedule, setDraftSchedule] = useState<Record<number, DayConfig>>(DEFAULT_SCHEDULE_FALLBACK);
  const [dayIntervals, setDayIntervals] = useState<Record<number, BreakIntervalItem[]>>({
    0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []
  });
  const originalScheduleRef = useRef<Record<number, DayConfig>>(DEFAULT_SCHEDULE_FALLBACK);
  const storeWeeklyScheduleRef = useRef<Record<number, DayConfig>>(storeWeeklySchedule);

  useEffect(() => {
    storeWeeklyScheduleRef.current = storeWeeklySchedule;
  }, [storeWeeklySchedule]);

  useEffect(() => {
    return () => {
      if (replicateTimerRef.current) clearTimeout(replicateTimerRef.current);
    };
  }, []);

  // UI Dropdowns and Sub-modals
  const [isStaffDropdownOpen, setIsStaffDropdownOpen] = useState(false);
  const [isDiscardModalOpen, setIsDiscardModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'close' | { type: 'switch_staff'; staffId: string } | null>(null);

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
      setReplicateFeedback(null);

      try {
        let scheduleToSet: Record<number, DayConfig> = JSON.parse(JSON.stringify(DEFAULT_SCHEDULE_FALLBACK));

        if (initialSchedule && Object.keys(initialSchedule).length > 0) {
          scheduleToSet = { ...scheduleToSet, ...initialSchedule };
        } else if (selectedStaffId) {
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
          } else if (storeWeeklyScheduleRef.current && Object.keys(storeWeeklyScheduleRef.current).length > 0) {
            scheduleToSet = { ...scheduleToSet, ...storeWeeklyScheduleRef.current };
          }
        }

        if (isMounted) {
          const nextIntervals: Record<number, BreakIntervalItem[]> = {};
          const normalizedSchedule: Record<number, DayConfig> = {};

          for (let d = 0; d <= 6; d++) {
            const cfg = scheduleToSet[d] || DEFAULT_SCHEDULE_FALLBACK[d];
            const startNorm = normalizeTime(cfg.start || '09:00');
            const endNorm = normalizeTime(cfg.end || '18:00');
            const grouped = slotsToBreakIntervals(cfg.breaks || []);
            const merged = mergeBreakIntervals(grouped, startNorm, endNorm);
            nextIntervals[d] = merged;
            normalizedSchedule[d] = {
              start: startNorm,
              end: endNorm,
              isOpen: Boolean(cfg.isOpen),
              breaks: intervalsToSlots(merged, startNorm, endNorm)
            };
          }

          setDayIntervals(nextIntervals);
          setDraftSchedule(normalizedSchedule);
          originalScheduleRef.current = JSON.parse(JSON.stringify(normalizedSchedule));
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
  }, [isOpen, selectedStaffId, getStaffAvailability, initialSchedule]);

  // Compute dirty state
  const isDirty = useMemo(() => {
    return JSON.stringify(draftSchedule) !== JSON.stringify(originalScheduleRef.current);
  }, [draftSchedule]);

  // Close handler with confirmation
  const handleRequestClose = () => {
    if (isSaving) return;
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

  // Current day config & intervals
  const currentDayConfig: DayConfig = useMemo(() => {
    return draftSchedule[selectedDay] || { start: '09:00', end: '18:00', isOpen: true, breaks: [] };
  }, [draftSchedule, selectedDay]);

  const currentIntervals: BreakIntervalItem[] = useMemo(() => {
    return dayIntervals[selectedDay] || [];
  }, [dayIntervals, selectedDay]);

  // Sync intervals & day config helper
  const updateDayAndIntervals = (
    dayIdx: number,
    nextConfigPartial: Partial<DayConfig>,
    nextIntervalsList?: BreakIntervalItem[]
  ) => {
    setDraftSchedule(prev => {
      const curr = prev[dayIdx] || DEFAULT_SCHEDULE_FALLBACK[dayIdx];
      const nextStart = nextConfigPartial.start !== undefined ? normalizeTime(nextConfigPartial.start) : curr.start;
      const nextEnd = nextConfigPartial.end !== undefined ? normalizeTime(nextConfigPartial.end) : curr.end;
      const nextIsOpen = nextConfigPartial.isOpen !== undefined ? nextConfigPartial.isOpen : curr.isOpen;

      const intervalsToUse = nextIntervalsList !== undefined ? nextIntervalsList : (dayIntervals[dayIdx] || []);
      const computedBreaks = intervalsToSlots(intervalsToUse, nextStart, nextEnd);

      return {
        ...prev,
        [dayIdx]: {
          start: nextStart,
          end: nextEnd,
          isOpen: nextIsOpen,
          breaks: computedBreaks
        }
      };
    });

    if (nextIntervalsList !== undefined) {
      setDayIntervals(prev => ({
        ...prev,
        [dayIdx]: nextIntervalsList
      }));
    }
  };

  // Inline interval operations
  const handleAddInterval = (presetStart?: string, presetEnd?: string) => {
    setSaveError(null);
    const shiftStartM = timeToMinutes(currentDayConfig.start);
    const shiftEndM = timeToMinutes(currentDayConfig.end);

    let defaultStart = presetStart || '12:00';
    let defaultEnd = presetEnd || '13:00';

    const defStartM = timeToMinutes(defaultStart);
    const defEndM = timeToMinutes(defaultEnd);

    if (defStartM < shiftStartM || defEndM > shiftEndM || currentIntervals.some(i => i.start === defaultStart)) {
      // Find first available 1-hour or 30-min window inside the shift
      const occupiedSlots = new Set(intervalsToSlots(currentIntervals, currentDayConfig.start, currentDayConfig.end));
      let foundStartM = Math.max(shiftStartM, Math.min(shiftEndM - 30, 12 * 60));
      for (let m = shiftStartM; m <= shiftEndM - 30; m += 30) {
        const slotStr = minutesToTime(m);
        if (!occupiedSlots.has(slotStr)) {
          foundStartM = m;
          break;
        }
      }
      const foundEndM = Math.min(shiftEndM, foundStartM + 60);
      defaultStart = minutesToTime(foundStartM);
      defaultEnd = minutesToTime(foundEndM);
    }

    const newItem: BreakIntervalItem = {
      id: `brk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      start: defaultStart,
      end: defaultEnd
    };

    const nextList = [...currentIntervals, newItem];
    updateDayAndIntervals(selectedDay, {}, nextList);
  };

  const handleUpdateIntervalRow = (id: string, field: 'start' | 'end', value: string) => {
    setSaveError(null);
    const normVal = normalizeTime(value);
    const nextList = currentIntervals.map(item => {
      if (item.id !== id) return item;
      if (field === 'start') {
        const newStartM = timeToMinutes(normVal);
        const curEndM = timeToMinutes(item.end);
        const shiftEndM = timeToMinutes(currentDayConfig.end);
        const adjustedEnd = curEndM <= newStartM
          ? minutesToTime(Math.min(shiftEndM, newStartM + 30))
          : item.end;
        return { ...item, start: normVal, end: adjustedEnd };
      } else {
        return { ...item, end: normVal };
      }
    });

    updateDayAndIntervals(selectedDay, {}, nextList);
  };

  const handleRemoveIntervalRow = (id: string) => {
    setSaveError(null);
    const nextList = currentIntervals.filter(item => item.id !== id);
    updateDayAndIntervals(selectedDay, {}, nextList);
  };

  // Switch day & auto-merge current day's adjacent/overlapping intervals
  const handleSelectDay = (dayIdx: number) => {
    const mergedCurrent = mergeBreakIntervals(
      currentIntervals,
      currentDayConfig.start,
      currentDayConfig.end
    );
    updateDayAndIntervals(selectedDay, {}, mergedCurrent);
    setSelectedDay(dayIdx);
  };

  // Replicate schedule ("Copiar este horário para...")
  const handleReplicateSchedule = (mode: 'mon_fri' | 'tue_sat' | 'all_active') => {
    setSaveError(null);
    const mergedCurrent = mergeBreakIntervals(
      currentIntervals,
      currentDayConfig.start,
      currentDayConfig.end
    );
    const cleanSlots = intervalsToSlots(mergedCurrent, currentDayConfig.start, currentDayConfig.end);

    let targetDays: number[] = [];
    let feedbackLabel = '';

    if (mode === 'mon_fri') {
      targetDays = [1, 2, 3, 4, 5];
      feedbackLabel = 'Copiado para Seg a Sex!';
    } else if (mode === 'tue_sat') {
      targetDays = [2, 3, 4, 5, 6];
      feedbackLabel = 'Copiado para Ter a Sáb!';
    } else {
      targetDays = Object.entries(draftSchedule)
        .filter(([, cfg]) => (cfg as DayConfig).isOpen)
        .map(([d]) => Number(d));
      if (!targetDays.includes(selectedDay)) {
        targetDays.push(selectedDay);
      }
      feedbackLabel = 'Copiado para todos os dias ativos!';
    }

    setDayIntervals(prev => {
      const next = { ...prev };
      targetDays.forEach(d => {
        next[d] = mergedCurrent.map((item, idx) => ({
          ...item,
          id: `brk-${d}-${item.start}-${item.end}-${idx}`
        }));
      });
      return next;
    });

    setDraftSchedule(prev => {
      const next = { ...prev };
      targetDays.forEach(d => {
        next[d] = {
          start: currentDayConfig.start,
          end: currentDayConfig.end,
          isOpen: true,
          breaks: [...cleanSlots]
        };
      });
      return next;
    });

    if (replicateTimerRef.current) clearTimeout(replicateTimerRef.current);
    setReplicateFeedback(feedbackLabel);
    replicateTimerRef.current = setTimeout(() => {
      setReplicateFeedback(null);
    }, 2600);
  };

  // Options for interval start/end selects bounded by current shift
  const intervalStartOptions = useMemo(() => {
    const slots = generateTimeSlots(currentDayConfig.start, currentDayConfig.end, 30);
    return slots.length > 0 ? slots : ALL_SHIFT_START_OPTIONS;
  }, [currentDayConfig.start, currentDayConfig.end]);

  const getIntervalEndOptions = useCallback((startStr: string) => {
    const startM = timeToMinutes(startStr);
    const endM = timeToMinutes(currentDayConfig.end);
    const opts: string[] = [];
    for (let m = startM + 30; m <= endM; m += 30) {
      opts.push(minutesToTime(m));
    }
    return opts.length > 0 ? opts : ALL_SHIFT_END_OPTIONS;
  }, [currentDayConfig.end]);

  // Summary calculations for sticky footer
  const summaryStats = useMemo(() => {
    if (!currentDayConfig.isOpen) {
      return {
        isOpen: false,
        text: 'Dia de folga • 0 vagas'
      };
    }

    const totalShiftSlots = generateTimeSlots(currentDayConfig.start, currentDayConfig.end, 30);
    const activeBreakSlots = intervalsToSlots(currentIntervals, currentDayConfig.start, currentDayConfig.end)
      .filter(s => totalShiftSlots.includes(s));

    const breakMinutes = activeBreakSlots.length * 30;
    const availableSlots = Math.max(0, totalShiftSlots.length - activeBreakSlots.length);
    const pauseLabel = formatDurationMinutes(breakMinutes);

    return {
      isOpen: true,
      text: `${currentDayConfig.start} às ${currentDayConfig.end} • ${pauseLabel} • ~${availableSlots} ${availableSlots === 1 ? 'vaga' : 'vagas'}`
    };
  }, [currentDayConfig, currentIntervals]);

  // Save Schedule with strict try / catch / finally
  const handleSave = async () => {
    if (isSaving) return;
    setSaveError(null);

    // 1. Normalize and merge adjacent/overlapping intervals across all 7 days before saving
    const finalSchedule: Record<number, DayConfig> = {};
    const finalIntervalsMap: Record<number, BreakIntervalItem[]> = {};

    for (const day of DAYS_CONFIG) {
      const cfg = draftSchedule[day.index] || DEFAULT_SCHEDULE_FALLBACK[day.index];
      const rawDayIntervals = dayIntervals[day.index] || [];

      if (cfg.isOpen) {
        if (!cfg.start || !cfg.end) {
          setSaveError(`Defina o horário de início e fim para ${day.full}.`);
          setSelectedDay(day.index);
          return;
        }
        if (timeToMinutes(cfg.start) >= timeToMinutes(cfg.end)) {
          setSaveError(`Em ${day.full}, o início do turno (${cfg.start}) deve ser anterior ao fim (${cfg.end}).`);
          setSelectedDay(day.index);
          return;
        }

        // Validate that each interval has start < end
        for (const interval of rawDayIntervals) {
          if (timeToMinutes(interval.start) >= timeToMinutes(interval.end)) {
            setSaveError(`Em ${day.full}, ajuste o intervalo inválido (${interval.start} até ${interval.end}).`);
            setSelectedDay(day.index);
            return;
          }
        }
      }

      const merged = cfg.isOpen
        ? mergeBreakIntervals(rawDayIntervals, cfg.start, cfg.end)
        : [];
      const slots = cfg.isOpen
        ? intervalsToSlots(merged, cfg.start, cfg.end)
        : [];

      finalIntervalsMap[day.index] = merged;
      finalSchedule[day.index] = {
        start: normalizeTime(cfg.start),
        end: normalizeTime(cfg.end),
        isOpen: Boolean(cfg.isOpen),
        breaks: slots
      };
    }

    setDayIntervals(finalIntervalsMap);
    setDraftSchedule(finalSchedule);
    setIsSaving(true);

    try {
      if (onSave) {
        await onSave(finalSchedule);
      } else {
        const staffIdToSave = selectedStaffId || currentStaff?.id;
        if (!staffIdToSave) {
          throw new Error('Identificador de profissional não encontrado.');
        }

        const payload: Omit<StaffAvailability, 'id'>[] = Object.entries(finalSchedule).map(([d, config]) => {
          const cfg = config as DayConfig;
          return {
            staffId: staffIdToSave,
            dayOfWeek: Number(d),
            startTime: cfg.start,
            endTime: cfg.end,
            breaks: cfg.isOpen ? (cfg.breaks || []) : [],
            isOpen: cfg.isOpen
          };
        });

        await saveStaffAvailability(payload);

        const targetMember = validStaffList.find(s => s.id === staffIdToSave) || activeStaffMember;
        const isSavingOwnerSchedule = isOwnerOrAdmin && isOwnerStaffMember(targetMember);

        // Somente atualiza weekly_schedule geral quando o próprio horário do dono está sendo editado
        if (isSavingOwnerSchedule) {
          await Promise.all(
            Object.entries(finalSchedule).map(([d, config]) =>
              supabaseService.saveWeeklySchedule(Number(d), config as DayConfig)
            )
          );
        }
      }

      originalScheduleRef.current = JSON.parse(JSON.stringify(finalSchedule));
      onSuccess?.('Horários de trabalho salvos com sucesso!');
      onClose();
    } catch (err: any) {
      console.error('[WorkScheduleModal] Erro ao salvar horários:', err);
      const errMessage = err?.message || 'Ocorreu um erro ao salvar os horários. Tente novamente.';
      setSaveError(errMessage);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-schedule-title"
      onClick={handleRequestClose}
    >
      <div 
        className="relative w-full max-w-lg bg-[#1E1B4B] border-t sm:border border-white/15 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* A. CABEÇALHO FIXO (HEADER) */}
        <header className="px-4 pt-4 pb-3 border-b border-white/10 bg-[#252147] shrink-0 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#F99417]/15 border border-[#F99417]/30 flex items-center justify-center text-[#F99417] shrink-0">
                <Clock size={18} />
              </div>
              <div className="min-w-0">
                <h2 id="work-schedule-title" className="text-base font-black text-white tracking-tight uppercase truncate">
                  Horários de Trabalho
                </h2>
                {!canChooseStaff && (
                  <p className="text-[11px] text-white/60 font-medium truncate">
                    {displayName}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleRequestClose}
              aria-label="Fechar modal"
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center active:scale-95 transition-colors shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          {/* Seletor do Profissional compacto logo abaixo (visão de dono/admin) */}
          {canChooseStaff && validStaffList.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsStaffDropdownOpen(prev => !prev)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-black/25 border border-white/10 hover:border-white/20 active:scale-[0.99] transition-all text-left min-h-[42px]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-[#F99417]/20 border border-[#F99417]/40 flex items-center justify-center text-[10px] font-black text-[#F99417] overflow-hidden shrink-0">
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
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-white truncate">
                      {activeStaffMember?.name || 'Selecione o profissional'}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-white/70 shrink-0">
                      {isOwnerStaffMember(activeStaffMember) ? 'Proprietário' : 'Equipe'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-semibold text-[#F99417] shrink-0">
                  <span>Trocar</span>
                  <ChevronDown size={14} className={`transition-transform duration-150 ${isStaffDropdownOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {isStaffDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-20" 
                    onClick={() => setIsStaffDropdownOpen(false)}
                  />
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#252147] border border-white/15 rounded-2xl shadow-2xl z-30 py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3.5 py-1.5 text-[10px] font-black text-white/50 uppercase tracking-widest border-b border-white/10">
                      Selecionar Profissional
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-white/5">
                      {validStaffList.map(member => {
                        const isSelected = member.id === selectedStaffId;
                        const isMemberOwner = isOwnerStaffMember(member);
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => handleSelectStaff(member.id)}
                            className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs transition-colors min-h-[44px] ${
                              isSelected ? 'bg-[#F99417]/15 text-white font-bold' : 'text-white/80 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden shrink-0">
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
                              <div className="min-w-0">
                                <span className="block truncate">{member.name}</span>
                                <span className="text-[10px] text-white/50">
                                  {isMemberOwner ? 'Proprietário' : 'Profissional'}
                                </span>
                              </div>
                            </div>
                            {isSelected && <Check size={15} className="text-[#F99417] shrink-0 ml-2" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </header>

        {/* B. SELETOR DE DIAS DA SEMANA (GRID DE 7 COLUNAS SEM SCROLL HORIZONTAL) */}
        <div className="px-3.5 py-2.5 border-b border-white/10 bg-[#1E1B4B] shrink-0">
          <div 
            className="grid grid-cols-7 gap-1.5"
            role="tablist"
            aria-label="Dias da semana"
          >
            {DAYS_CONFIG.map(day => {
              const isSelected = selectedDay === day.index;
              const config = draftSchedule[day.index] || { isOpen: false };
              const isOpenDay = Boolean(config.isOpen);

              return (
                <button
                  key={day.index}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-label={`${day.full}, ${isOpenDay ? 'Ativo' : 'Folga'}`}
                  onClick={() => handleSelectDay(day.index)}
                  className={`relative flex flex-col items-center justify-center py-2 px-0.5 rounded-xl transition-all min-h-[50px] border ${
                    isSelected 
                      ? 'bg-[#F99417]/20 border-[#F99417] text-white font-black shadow-md shadow-[#F99417]/20 ring-1 ring-[#F99417]' 
                      : isOpenDay
                        ? 'bg-[#252147] border-white/10 text-white/90 hover:border-white/25 font-bold'
                        : 'bg-black/25 border-white/5 text-white/35 opacity-60 hover:opacity-80 font-semibold'
                  }`}
                >
                  <span className={`text-[11px] sm:text-xs tracking-tight leading-none ${
                    isSelected ? 'text-[#F99417] font-black' : ''
                  }`}>
                    {day.short}
                  </span>

                  {/* Ponto (dot) verde discreto abaixo da sigla se ativo, ou cinza escuro se folga */}
                  <span 
                    className={`w-1.5 h-1.5 rounded-full mt-1.5 transition-colors ${
                      isOpenDay 
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' 
                        : 'bg-white/20'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* CONTEÚDO DO DIA SELECIONADO */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3.5">
          {isLoadingAvailability ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <Loader2 size={28} className="text-[#F99417] animate-spin mb-2.5" />
              <p className="text-xs text-white/60">Carregando horários de {displayName}...</p>
            </div>
          ) : (
            <div className="rounded-2xl bg-[#252147] border border-white/10 p-4 space-y-4 shadow-lg">
              {/* C. TOPO DO CARD PRINCIPAL: NOME DO DIA + BADGE + SWITCH GRANDE */}
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
                      {DAYS_CONFIG[selectedDay].full}
                    </h3>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                      currentDayConfig.isOpen 
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' 
                        : 'bg-white/5 text-white/45 border-white/10'
                    }`}>
                      {currentDayConfig.isOpen ? 'Ativo' : 'Folga'}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/55 mt-0.5">
                    {currentDayConfig.isOpen 
                      ? 'Expediente aberto para agendamentos' 
                      : 'Sem expediente neste dia da semana'}
                  </p>
                </div>

                {/* Switch grande e fácil de tocar na direita */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={currentDayConfig.isOpen}
                  aria-label={`Alternar status de ${DAYS_CONFIG[selectedDay].full}`}
                  onClick={() => {
                    setSaveError(null);
                    updateDayAndIntervals(selectedDay, { isOpen: !currentDayConfig.isOpen });
                  }}
                  className="min-w-[56px] min-h-[48px] flex items-center justify-end cursor-pointer select-none focus:outline-none shrink-0"
                >
                  <div
                    className={`w-14 h-8 rounded-full transition-colors duration-200 ease-in-out relative flex items-center p-1 border ${
                      currentDayConfig.isOpen
                        ? 'bg-emerald-500 border-emerald-400 shadow-md shadow-emerald-500/25'
                        : 'bg-black/40 border-white/15'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                        currentDayConfig.isOpen ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </button>
              </div>

              {/* SE FECHADO/FOLGA: ESCONDER TODO O RESTO E MOSTRAR ESTADO VAZIO ELEGANTE */}
              {!currentDayConfig.isOpen ? (
                <div className="py-8 px-4 rounded-xl bg-black/20 border border-dashed border-white/10 flex flex-col items-center justify-center text-center space-y-2">
                  <div className="w-11 h-11 rounded-full bg-white/5 flex items-center justify-center text-white/35">
                    <CalendarOff size={20} />
                  </div>
                  <p className="text-xs sm:text-sm font-semibold text-white/75">
                    Dia de folga — nenhum horário disponível para agendamento
                  </p>
                  <p className="text-[11px] text-white/40 max-w-xs">
                    Ative a chave acima caso queira configurar horários de atendimento para {DAYS_CONFIG[selectedDay].full.toLowerCase()}.
                  </p>
                </div>
              ) : (
                <>
                  {/* D. EXPEDIENTE (HORÁRIO DE ATENDIMENTO) */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-black text-white/70 uppercase tracking-wider">
                      <Clock size={13} className="text-[#F99417]" />
                      <span>Expediente (Horário de Atendimento)</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-white/55 font-semibold mb-1">
                          Início do Turno
                        </label>
                        <div className="relative">
                          <select
                            value={currentDayConfig.start}
                            onChange={(e) => {
                              setSaveError(null);
                              updateDayAndIntervals(selectedDay, { start: e.target.value });
                            }}
                            className="w-full min-h-[48px] bg-black/35 border border-white/15 hover:border-white/25 focus:border-[#F99417] rounded-xl px-3.5 text-sm font-bold text-white focus:outline-none appearance-none transition-colors cursor-pointer"
                          >
                            {ALL_SHIFT_START_OPTIONS.map(t => (
                              <option key={t} value={t} className="bg-[#1E1B4B] text-white">
                                {t}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none" />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] text-white/55 font-semibold mb-1">
                          Fim do Turno
                        </label>
                        <div className="relative">
                          <select
                            value={currentDayConfig.end}
                            onChange={(e) => {
                              setSaveError(null);
                              updateDayAndIntervals(selectedDay, { end: e.target.value });
                            }}
                            className="w-full min-h-[48px] bg-black/35 border border-white/15 hover:border-white/25 focus:border-[#F99417] rounded-xl px-3.5 text-sm font-bold text-white focus:outline-none appearance-none transition-colors cursor-pointer"
                          >
                            {ALL_SHIFT_END_OPTIONS.map(t => (
                              <option key={t} value={t} className="bg-[#1E1B4B] text-white">
                                {t === '24:00' ? '00:00 (Meia-noite)' : t}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* E. SIMPLIFICAÇÃO RADICAL DE INTERVALOS E PAUSAS (INLINE, SEM GRADE) */}
                  <div className="pt-2 border-t border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-black text-white/70 uppercase tracking-wider">
                        <Coffee size={13} className="text-[#F99417]" />
                        <span>Intervalos (Almoço / Pausa)</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {currentIntervals.length === 0 &&
                          timeToMinutes(currentDayConfig.start) <= 12 * 60 &&
                          timeToMinutes(currentDayConfig.end) >= 13 * 60 && (
                            <button
                              type="button"
                              onClick={() => handleAddInterval('12:00', '13:00')}
                              className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-white/80 active:scale-95 transition-all"
                            >
                              + Almoço (12h-13h)
                            </button>
                          )}
                        <button
                          type="button"
                          onClick={() => handleAddInterval()}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F99417]/15 hover:bg-[#F99417]/25 border border-[#F99417]/30 text-[11px] font-bold text-[#F99417] active:scale-95 transition-all"
                        >
                          <Plus size={13} />
                          <span>Adicionar intervalo</span>
                        </button>
                      </div>
                    </div>

                    {currentIntervals.length === 0 ? (
                      <div className="px-3.5 py-3 rounded-xl bg-black/20 border border-white/5 flex items-center justify-between text-xs text-white/45">
                        <span>Nenhum intervalo configurado neste dia.</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {currentIntervals.map((interval) => {
                          const endOpts = getIntervalEndOptions(interval.start);
                          return (
                            <div
                              key={interval.id}
                              className="flex items-center gap-2 p-2 rounded-xl bg-black/30 border border-white/10"
                            >
                              <div className="relative flex-1">
                                <select
                                  aria-label="Início do intervalo"
                                  value={interval.start}
                                  onChange={(e) => handleUpdateIntervalRow(interval.id, 'start', e.target.value)}
                                  className="w-full min-h-[42px] bg-[#252147] border border-white/15 focus:border-[#F99417] rounded-lg pl-3 pr-7 text-xs sm:text-sm font-bold text-white focus:outline-none appearance-none cursor-pointer"
                                >
                                  {intervalStartOptions.map(t => (
                                    <option key={t} value={t} className="bg-[#1E1B4B] text-white">
                                      {t}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none" />
                              </div>

                              <span className="text-xs font-semibold text-white/50 shrink-0">
                                até
                              </span>

                              <div className="relative flex-1">
                                <select
                                  aria-label="Fim do intervalo"
                                  value={interval.end}
                                  onChange={(e) => handleUpdateIntervalRow(interval.id, 'end', e.target.value)}
                                  className="w-full min-h-[42px] bg-[#252147] border border-white/15 focus:border-[#F99417] rounded-lg pl-3 pr-7 text-xs sm:text-sm font-bold text-white focus:outline-none appearance-none cursor-pointer"
                                >
                                  {endOpts.map(t => (
                                    <option key={t} value={t} className="bg-[#1E1B4B] text-white">
                                      {t}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none" />
                              </div>

                              <button
                                type="button"
                                onClick={() => handleRemoveIntervalRow(interval.id)}
                                aria-label="Remover intervalo"
                                title="Remover intervalo"
                                className="w-10 h-10 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 flex items-center justify-center active:scale-95 transition-colors shrink-0"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* F. RECURSO DE PRODUTIVIDADE ("COPIAR ESTE HORÁRIO PARA...") */}
                  <div className="pt-2.5 border-t border-white/10 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-white/65">
                        <Copy size={12} className="text-[#F99417]" />
                        <span>Copiar este horário para...</span>
                      </div>

                      {replicateFeedback && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 animate-in fade-in duration-150">
                          <Check size={12} />
                          {replicateFeedback}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => handleReplicateSchedule('mon_fri')}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-white/85 active:scale-95 transition-all text-center"
                      >
                        Seg a Sex
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReplicateSchedule('tue_sat')}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-white/85 active:scale-95 transition-all text-center"
                      >
                        Ter a Sáb
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReplicateSchedule('all_active')}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-white/85 active:scale-95 transition-all text-center"
                      >
                        Dias ativos
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Save Error Alert */}
          {saveError && (
            <div className="p-3.5 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-200 flex items-start gap-2.5 animate-in fade-in duration-150">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-red-300">Não foi possível salvar os horários</p>
                <p className="mt-0.5 break-words">{saveError}</p>
              </div>
              <button
                type="button"
                onClick={() => setSaveError(null)}
                className="text-red-300/70 hover:text-white p-0.5"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* G. RODAPÉ FIXO (STICKY FOOTER) COM RESUMO COMPACTO */}
        <footer className="px-4 pt-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4 border-t border-white/10 bg-[#252147] shrink-0 space-y-2.5">
          {/* Linha discreta de resumo acima dos botões */}
          <div className="flex items-center justify-center text-center px-2">
            <p className="text-[11px] text-white/65 font-medium truncate">
              <span className="font-bold text-white/85">Resumo ({DAYS_CONFIG[selectedDay].short}):</span>{' '}
              {summaryStats.text}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={isSaving}
              className="min-h-[48px] px-4 py-2.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs sm:text-sm font-bold text-white/80 hover:text-white active:scale-98 transition-all disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isLoadingAvailability}
              className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#F99417] hover:bg-[#F99417]/90 text-xs sm:text-sm font-black uppercase tracking-wider text-white flex items-center justify-center gap-2 shadow-lg shadow-[#F99417]/25 active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Check size={16} className="shrink-0" />
                  <span>Salvar Horários</span>
                </>
              )}
            </button>
          </div>
        </footer>
      </div>

      {/* DISCARD CONFIRMATION MODAL */}
      {isDiscardModalOpen && (
        <div 
          className="fixed inset-0 z-[260] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150"
          role="alertdialog"
          aria-labelledby="discard-title"
          aria-describedby="discard-desc"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-sm bg-[#252147] border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 id="discard-title" className="text-base font-bold text-white">
                  Descartar alterações?
                </h3>
                <p id="discard-desc" className="text-xs text-white/65 mt-0.5">
                  Você fez alterações nos horários que ainda não foram salvas. Deseja sair mesmo assim?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsDiscardModalOpen(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold text-white/75 hover:text-white hover:bg-white/5 transition-all"
              >
                Continuar editando
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold hover:bg-red-500/30 active:scale-95 transition-all"
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
