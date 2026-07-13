import fs from 'fs';

let utilsCode = fs.readFileSync('utils/helpers.ts', 'utf8');

const occupancyFunc = `
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
`;

if (!utilsCode.includes('calcOccupancyRate')) {
  utilsCode += occupancyFunc;
  fs.writeFileSync('utils/helpers.ts', utilsCode);
}
