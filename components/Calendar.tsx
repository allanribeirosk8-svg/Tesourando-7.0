import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTodayString, formatYMD } from '../utils/helpers';
import { useSwipe } from '../hooks/useSwipe';

interface CalendarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  getBadgeCount?: (date: string) => number;
  isClosed?: (date: string) => boolean;
  isHighlighted?: (date: string) => boolean;
  minDate?: string;
  maxDate?: string;
  className?: string;
}

const Calendar: React.FC<CalendarProps> = ({
  selectedDate,
  onSelectDate,
  getBadgeCount,
  isClosed,
  isHighlighted,
  minDate,
  maxDate,
  className = ""
}) => {
  const [viewDate, setViewDate] = useState(() => {
    const initial = selectedDate ? new Date(selectedDate + 'T12:00:00') : new Date();
    return isNaN(initial.getTime()) ? new Date() : initial;
  });
  const [viewMode, setViewMode] = useState<'days' | 'years'>('days');
  const [slideDirection, setSlideDirection] = useState(0);

  // Update viewDate when selectedDate changes to a valid date
  React.useEffect(() => {
    if (selectedDate) {
      const newDate = new Date(selectedDate + 'T12:00:00');
      if (!isNaN(newDate.getTime())) {
        setViewDate(newDate);
      }
    }
  }, [selectedDate]);

  const formatMonthYear = (date: Date) => {
    return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      .replace(/^\w/, (c) => c.toUpperCase())
      .replace(' de ', ' ');
  };

  const days = useMemo(() => {
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
    const offset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1; // Monday start
    
    const result = [];
    const prevMonthLastDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0).getDate();
    
    // Previous month
    for (let i = offset - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, d);
      result.push({ date, type: 'prev' as const });
    }
    
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
      result.push({ date, type: 'current' as const });
    }
    
    // Next month
    const remaining = 42 - result.length;
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, d);
      result.push({ date, type: 'next' as const });
    }
    
    return result;
  }, [viewDate]);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const result = [];
    for (let y = 2020; y <= currentYear + 5; y++) {
      result.push(y);
    }
    return result;
  }, []);

  const handlePrevMonth = () => {
    if (viewMode !== 'days') return;
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    if (newDate.getFullYear() >= 2020) {
      setSlideDirection(-1);
      setViewDate(newDate);
    }
  };

  const handleNextMonth = () => {
    if (viewMode !== 'days') return;
    setSlideDirection(1);
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const swipeHandlers = useSwipe(handleNextMonth, handlePrevMonth);

  return (
    <div className={`bg-surface  rounded-2xl overflow-hidden ${className}`}>
      <div className="p-4 flex items-center justify-between">
        <button 
          onClick={handlePrevMonth}
          className="p-2 hover:bg-[#E8EEF5] :bg-[#303030] rounded-full transition-colors text-[#8A98A8]"
        >
          <ChevronLeft size={20} />
        </button>

        <button 
          onClick={() => setViewMode(viewMode === 'days' ? 'years' : 'days')}
          className="text-sm font-bold text-[#5A6878]  hover:text-[#2898D8] transition-colors"
        >
          {formatMonthYear(viewDate)}
        </button>

        <button 
          onClick={handleNextMonth}
          className="p-2 hover:bg-[#E8EEF5] :bg-[#303030] rounded-full transition-colors text-[#8A98A8]"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div {...swipeHandlers}>
        <AnimatePresence mode="wait">
          {viewMode === 'days' ? (
          <motion.div
            key={`days-${viewDate.getTime()}`}
            initial={{ opacity: 0, x: slideDirection * 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -slideDirection * 20 }}
            transition={{ duration: 0.2 }}
            className="px-4 pb-4"
          >
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
                <div key={i} className="h-8 flex items-center justify-center text-[10px] font-bold text-[#8A98A8] uppercase">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map(({ date, type }, i) => {
                const dateStr = formatYMD(date);
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === getTodayString();
                const count = getBadgeCount?.(dateStr) || 0;
                const closed = isClosed?.(dateStr);
                const highlighted = isHighlighted?.(dateStr);
                const isOutOfRange = (minDate && dateStr < minDate) || (maxDate && dateStr > maxDate);

                return (
                  <button
                    key={`${type}-${dateStr}-${i}`}
                    disabled={isOutOfRange}
                    onClick={() => {
                      if (type === 'current') {
                        onSelectDate(dateStr);
                      } else {
                        setViewDate(date);
                        onSelectDate(dateStr);
                      }
                    }}
                    className={`h-10 w-full rounded-xl flex items-center justify-center text-xs font-bold transition-all relative
                      ${isSelected ? 'bg-[#2898D8] text-white shadow-md scale-105 z-10' : 
                        isToday ? 'bg-[#F59E0B] text-white' : 
                        highlighted ? 'bg-[#E8F4FC] text-[#2898D8]  ' :
                        type !== 'current' || isOutOfRange ? 'text-[#8A98A8] ' : 
                        closed ? 'text-red-400 ' :
                        'text-[#5A6878]  hover:bg-[#F4F7FB] :bg-[#303030]'}`}
                  >
                    {date.getDate()}
                    {count > 0 && type === 'current' && (
                      <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border-2
                        ${isSelected ? 'bg-surface text-[#2898D8] border-[#2898D8]' : 'bg-[#2898D8] text-white border-white '}`}>
                        {count > 9 ? '9+' : count}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="years"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="px-4 pb-4 grid grid-cols-3 gap-2"
          >
            {years.map(year => (
              <button
                key={year}
                onClick={() => {
                  setViewDate(new Date(year, viewDate.getMonth(), 1));
                  setViewMode('days');
                }}
                className={`h-12 rounded-xl flex items-center justify-center font-bold text-sm transition-all
                  ${viewDate.getFullYear() === year ? 'bg-[#2898D8] text-white shadow-sm' : 'bg-[#F4F7FB]  text-[#5A6878]  hover:bg-[#E8EEF5]'}`}
              >
                {year}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
};

export default Calendar;
