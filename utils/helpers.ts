/**
 * Compresses an image file to a smaller Base64 string to save LocalStorage space.
 * Uses Canvas to resize and reduce quality.
 */
export const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const scaleSize = MAX_WIDTH / img.width;
        
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Canvas context not available"));
          return;
        }
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Compress to JPEG with 0.6 quality
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export const formatDate = (dateString: string): string => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
};

export const formatDateLong = (dateString: string): string => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(date);
  
  // Capitalize first letter and handle "quinta-feira" -> "Quinta"
  const parts = formatted.split(', ');
  const weekday = parts[0].split('-')[0];
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const rest = parts[1] || '';
  
  return `${capitalizedWeekday}, ${rest}`;
};

export const getTodayString = (): string => {
  const d = new Date();
  return formatYMD(d);
};

export const formatYMD = (d: Date): string => {
  if (!d || isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
};

export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

export const formatPhone = (value: string): string => {
  const numbers = value.replace(/\D/g, '').slice(0, 11);
  
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
};

/**
 * Normalizes a Brazilian phone number to a canonical 10-digit format.
 * Removes all non-numeric characters and the extra '9' from 11-digit mobile numbers.
 */
export const normalizePhone = (phone: string): string => {
  const numbers = phone.replace(/\D/g, '');
  // Brazilian mobile numbers with 11 digits: DDD + 9 + 8 digits
  // We normalize by removing the '9' at the 3rd position if it exists in an 11-digit number
  if (numbers.length === 11 && numbers[2] === '9') {
    return numbers.slice(0, 2) + numbers.slice(3);
  }
  return numbers;
};

export const normalizeTime = (time: string | null | undefined): string => {
  if (!time) return '';
  // Split by ':' to handle HH:MM:SS or HH:MM
  const parts = time.split(':');
  if (parts.length >= 2) {
    const hours = parts[0].trim().padStart(2, '0');
    const minutes = parts[1].trim().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  return time.substring(0, 5);
};

export const getAvatarColor = (name: string) => {
  const colors = [
    'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 
    'bg-emerald-500', 'bg-amber-500', 'bg-orange-500', 'bg-rose-500'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export const getInitials = (name: string) => {
  if (!name) return '';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export const capitalizeName = (name: string): string => {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(' ')
    .filter(word => word.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Generates time slots in 15-minute intervals between start and end time.
 * @param start HH:MM string (e.g., "09:00")
 * @param end HH:MM string (e.g., "18:00")
 */
export const generateTimeSlots = (start: string, end: string): string[] => {
  const slots: string[] = [];
  const [startHour, startMin] = start.split(':').map(Number);
  const [endHour, endMin] = end.split(':').map(Number);

  let current = new Date();
  current.setHours(startHour, startMin, 0, 0);

  const endTime = new Date();
  endTime.setHours(endHour, endMin, 0, 0);

  // Safety break to prevent infinite loops if end < start
  if (endTime <= current) return [];

  while (current < endTime) {
    const timeString = current.getHours().toString().padStart(2, '0') + ':' + current.getMinutes().toString().padStart(2, '0');
    slots.push(timeString);
    current.setMinutes(current.getMinutes() + 15);
  }

  return slots;
};

/**
 * Returns an array of slots (HH:MM) that would be occupied starting from a given time.
 * @param startTime HH:MM string
 * @param durationMinutes number (multiple of 15)
 */
export const getOccupiedSlots = (startTime: string, durationMinutes: number): string[] => {
  const slots: string[] = [];
  const [h, m] = startTime.split(':').map(Number);
  const current = new Date();
  current.setHours(h, m, 0, 0);

  const numSlots = Math.ceil(durationMinutes / 15);
  for (let i = 0; i < numSlots; i++) {
    const timeString = current.getHours().toString().padStart(2, '0') + ':' + current.getMinutes().toString().padStart(2, '0');
    slots.push(timeString);
    current.setMinutes(current.getMinutes() + 15);
  }
  return slots;
};

/**
 * Calcula a taxa de ocupação real de um dia.
 * @param appointments - Agendamentos do dia (precisam ter time, duration em minutos)
 * @param workStart - Início do expediente em minutos desde meia-noite (ex: 8*60 = 480)
 * @param workEnd   - Fim do expediente em minutos desde meia-noite (ex: 19*60 = 1140)
 * @param slotSize  - Granularidade dos slots em minutos (ex: 15)
 * @param minServiceDuration - Duração em minutos do serviço mais curto do catálogo
 */
export function calcOccupancyRate(
  appointments: { time: string; duration: number }[],
  workStart: number,
  workEnd: number,
  slotSize: number,
  minServiceDuration: number
): number {
  const { occupiedSlots, totalSlots } = calcOccupancySlots(appointments, workStart, workEnd, slotSize, minServiceDuration);
  if (totalSlots === 0) return 0;
  return Math.round((occupiedSlots / totalSlots) * 100);
}

export function calcOccupancySlots(
  appointments: { time: string; duration: number }[],
  workStart: number,
  workEnd: number,
  slotSize: number,
  minServiceDuration: number
): { occupiedSlots: number, totalSlots: number } {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const booked = appointments.map(a => ({
    start: toMin(a.time),
    end: toMin(a.time) + (a.duration > 0 ? a.duration : 30),
  }));

  let totalSlots = 0;
  let occupiedSlots = 0;

  for (let t = workStart; t < workEnd; t += slotSize) {
    const coveredByRunning = booked.some(b => t > b.start && t < b.end);
    if (coveredByRunning) continue;

    const isBooked = booked.some(b => b.start === t);
    if (isBooked) {
      totalSlots++;
      occupiedSlots++;
      continue;
    }

    const nextEvent = Math.min(
      workEnd,
      ...booked.filter(b => b.start > t).map(b => b.start)
    );
    const freeWindow = nextEvent - t;

    if (freeWindow < minServiceDuration) continue;

    totalSlots++;
  }

  return { occupiedSlots, totalSlots };
}
