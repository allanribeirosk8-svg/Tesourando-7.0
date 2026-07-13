import fs from 'fs';

let adminCode = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// 1. Add calcOccupancySlots import
if (adminCode.includes("import { compressImage") && !adminCode.includes("calcOccupancySlots")) {
  adminCode = adminCode.replace(
    /import \{ compressImage([^}]+)\} from '\.\.\/utils\/helpers';/,
    "import { compressImage$1, calcOccupancySlots } from '../utils/helpers';"
  );
} else {
    console.log("Could not find compressImage import");
}

// Ensure Services is pulled from useStore
if (!adminCode.includes("const { appointments, customers, isDarkMode, weeklySchedule, services } = useStore();")) {
    adminCode = adminCode.replace(
        "const { appointments, customers, isDarkMode, weeklySchedule } = useStore();",
        "const { appointments, customers, isDarkMode, weeklySchedule, services } = useStore();"
    );
}

// 2. Replace occupancyRatio
const occupancyRatioRegex = /const occupancyRatio = useMemo\(\(\) => \{[\s\S]*?\}, \[weeklySchedule, currentDate, currentRange, period, stats\.current\.count\]\);/;

const occupancyRatioReplacement = `const occupancyRatio = useMemo(() => {
    if (!services || !weeklySchedule) return 0;
    
    // Buscar a menor duração entre todos os serviços do catálogo
    const minServiceDuration = services.reduce(
      (min, s) => Math.min(min, s.duration ?? 30),
      Infinity
    );
    const minDuration = minServiceDuration === Infinity ? 30 : minServiceDuration;

    let globalTotal = 0;
    let globalOccupied = 0;

    const processDay = (dateStr: string, config: any) => {
      if (!config?.isOpen) return;

      const toMin = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };

      const workStart = toMin(config.start);
      const workEnd = toMin(config.end);
      
      const dayAppointments = appointments
        .filter(a => a.date === dateStr && a.status !== 'canceled' && a.status !== 'no-show')
        .map(a => ({
           time: a.time,
           duration: a.duration ?? (services.find(s => s.name === a.service)?.duration ?? 30),
        }));
        
      const { occupiedSlots, totalSlots } = calcOccupancySlots(
        dayAppointments,
        workStart,
        workEnd,
        15, // SLOT_SIZE
        minDuration
      );

      globalTotal += totalSlots;
      globalOccupied += occupiedSlots;
    };

    if (period === 'dia') {
       const dateStr = currentDate.toISOString().split('T')[0];
       const dayOfWeek = currentDate.getDay();
       processDay(dateStr, weeklySchedule[dayOfWeek]);
    } else {
       const start = new Date(currentRange.start + 'T12:00:00');
       const end = new Date(currentRange.end + 'T12:00:00');
       let curr = new Date(start);
       while (curr <= end) {
         const dateStr = curr.toISOString().split('T')[0];
         const dayOfWeek = curr.getDay();
         processDay(dateStr, weeklySchedule[dayOfWeek]);
         curr.setDate(curr.getDate() + 1);
       }
    }
    
    if (globalTotal === 0) return 0;
    return Math.min(globalOccupied / globalTotal, 1);
  }, [weeklySchedule, currentDate, currentRange, period, appointments, services]);`;

if (occupancyRatioRegex.test(adminCode)) {
    adminCode = adminCode.replace(occupancyRatioRegex, occupancyRatioReplacement);
} else {
    console.log("Could not find occupancyRatio block!");
}

// 3. Replace the centering style request
// div#root:nth-of-type(1) > div:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(5) > h4:nth-of-type(1)
// Wait! "Sua agenda de hoje" or similar.
// Let me look at "Top 5 Clientes", "Ranking de Serviços". I just replaced their text-center in the previous step. Wait, let's verify if they have text-center.

fs.writeFileSync('pages/AdminApp.tsx', adminCode);
