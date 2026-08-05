import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Building2, User } from 'lucide-react';
import { useStore } from '../context/Store';
import { Transaction } from '../types';

interface LancamentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  defaultType?: 'income' | 'expense';
  initialScope?: 'shop' | 'staff';
  initialStaffId?: string;
}

const INCOME_CATEGORIES = [
  { id: 'tip', label: 'Gorjeta' },
  { id: 'product', label: 'Produto' },
  { id: 'walk_in', label: 'Serviço Avulso' },
  { id: 'other', label: 'Outro' }
] as const;

const EXPENSE_CATEGORIES = [
  { id: 'rent', label: 'Aluguel' },
  { id: 'supply', label: 'Insumos' },
  { id: 'equipment', label: 'Equipamento' },
  { id: 'fee', label: 'Taxa/Maquininha' },
  { id: 'other', label: 'Outro' }
] as const;

export const LancamentoModal: React.FC<LancamentoModalProps> = ({ 
  isOpen, 
  onClose, 
  isDarkMode, 
  defaultType = 'income',
  initialScope = 'shop',
  initialStaffId = ''
}) => {
  const { addTransaction, staff } = useStore();
  const activeStaff = staff.filter(s => s.status === 'active');
  
  const [type, setType] = useState<'income' | 'expense'>(defaultType);
  const [rawValue, setRawValue] = useState('0');
  const [category, setCategory] = useState<Transaction['category']>(defaultType === 'income' ? 'tip' : 'rent');
  const [description, setDescription] = useState('');
  
  // Escopo de pertencimento da movimentação manual (Obrigatório)
  const [entryScope, setEntryScope] = useState<'shop' | 'staff'>(initialScope);
  const [entryStaffId, setEntryStaffId] = useState<string>(initialStaffId || activeStaff[0]?.id || '');
  
  const [date, setDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  
  const [isSuccess, setIsSuccess] = useState(false);

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setType(defaultType);
      setRawValue('0');
      setCategory(defaultType === 'income' ? 'tip' : 'rent');
      setDescription('');
      const today = new Date();
      setDate(today.toISOString().split('T')[0]);
      setIsSuccess(false);
      setEntryScope(initialScope);
      const defaultStaff = initialStaffId || activeStaff[0]?.id || staff[0]?.id || '';
      setEntryStaffId(defaultStaff);
    }
  }, [isOpen, defaultType, initialScope, initialStaffId, staff]);

  const handleTypeChange = (newType: 'income' | 'expense') => {
    setType(newType);
    setCategory(newType === 'income' ? 'tip' : 'rent');
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '');
    if (val === '') {
      setRawValue('0');
    } else {
      setRawValue(val.replace(/^0+/, '') || '0');
    }
  };

  const formatCurrency = (val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) return 'R$ 0,00';
    return `R$ ${(num / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  };

  const amount = parseInt(rawValue, 10) / 100;

  const handleConfirm = async () => {
    if (amount === 0) return;
    if (entryScope === 'staff' && !entryStaffId) return;

    const finalStaffId = entryScope === 'staff' ? entryStaffId : undefined;

    await addTransaction({
      type,
      amount,
      category,
      description: description.trim() || undefined,
      date,
      staffId: finalStaffId,
    });

    setIsSuccess(true);
    setTimeout(() => {
      onClose();
    }, 800);
  };
  
  const activeCategories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-50 transition-opacity p-0 m-0 backdrop-blur-xs"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={`fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center max-h-[90vh] overflow-y-auto
              w-full max-w-full ${isDarkMode ? 'bg-[#242424] text-white' : 'bg-white text-slate-800'}
              rounded-t-[2rem] shadow-2xl p-6 pb-8`}
          >
            <div className="w-12 h-1 bg-[#D0D8E4] dark:bg-[#3A3A3A] rounded-full mx-auto mb-4 shrink-0" />
            
            <h2 className="text-xl font-bold mb-4 w-full text-center flex items-center justify-center gap-2 shrink-0">
              <span className="text-2xl">💸</span> Novo Lançamento
            </h2>

            {/* Toggle Tipo */}
            <div className="flex w-full bg-[#F4F7FB] dark:bg-[#1A1A1A] p-1 rounded-2xl mb-4 shrink-0">
              <button
                type="button"
                className={`flex-1 h-[44px] rounded-xl font-bold text-sm transition-colors cursor-pointer border-none ${
                  type === 'income'
                    ? 'bg-[#34D399] text-white shadow-sm'
                    : 'text-[#8A98A8] dark:text-[#8A98A8]'
                }`}
                onClick={() => handleTypeChange('income')}
              >
                ENTRADA
              </button>
              <button
                type="button"
                className={`flex-1 h-[44px] rounded-xl font-bold text-sm transition-colors cursor-pointer border-none ${
                  type === 'expense'
                    ? 'bg-[#F87171] text-white shadow-sm'
                    : 'text-[#8A98A8] dark:text-[#8A98A8]'
                }`}
                onClick={() => handleTypeChange('expense')}
              >
                SAÍDA
              </button>
            </div>

            {/* Valor */}
            <div className="relative w-full mb-4 flex justify-center shrink-0">
              <input
                type="text"
                inputMode="decimal"
                value={formatCurrency(rawValue)}
                onChange={handleValueChange}
                className={`w-full text-center text-[38px] font-black bg-transparent border-none outline-none focus:ring-0 ${
                  type === 'income' ? 'text-[#34D399]' : 'text-[#F87171]'
                }`}
                style={{ height: '56px' }}
              />
            </div>

            {/* ESCOPO DE PERTENCIMENTO DA MOVIMENTAÇÃO (OBRIGATÓRIO) */}
            <div className="w-full mb-4 bg-[#F4F7FB] dark:bg-[#1A1A1A]/80 p-3 rounded-2xl border border-white/5 shrink-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#8A98A8] mb-2 flex items-center justify-between">
                <span>Pertencimento do Lançamento</span>
                <span className="text-[#34D399] text-[10px] font-black">Obrigatório</span>
              </label>

              <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setEntryScope('shop')}
                  className={`py-2 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border-none ${
                    entryScope === 'shop'
                      ? 'bg-secondary text-white shadow-md font-black'
                      : 'text-[#8A98A8] hover:text-white bg-transparent'
                  }`}
                >
                  <Building2 size={14} /> Barbearia Inteira
                </button>

                <button
                  type="button"
                  onClick={() => setEntryScope('staff')}
                  className={`py-2 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border-none ${
                    entryScope === 'staff'
                      ? 'bg-[#8B7CFF] text-white shadow-md font-black'
                      : 'text-[#8A98A8] hover:text-white bg-transparent'
                  }`}
                >
                  <User size={14} /> Profissional
                </button>
              </div>

              {/* Seletor de Profissional (se escopo === staff) */}
              {entryScope === 'staff' && (
                <div className="mt-3 animate-in fade-in duration-200">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A98A8] mb-1">
                    Selecione o Profissional Responsável
                  </label>
                  <select
                    value={entryStaffId}
                    onChange={(e) => setEntryStaffId(e.target.value)}
                    className={`w-full h-[44px] px-3 rounded-xl border-none font-bold text-xs ${
                      isDarkMode ? 'bg-[#242424] text-white border border-white/10' : 'bg-white text-slate-800'
                    } focus:outline-none focus:ring-2 focus:ring-[#2898D8]/50 cursor-pointer`}
                  >
                    {activeStaff.length === 0 ? (
                      <option value="">Nenhum profissional cadastrado</option>
                    ) : (
                      activeStaff.map(s => (
                        <option key={s.id} value={s.id} className="bg-[#242424] text-white">
                          {s.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>

            {/* Categorias */}
            <div className="w-full mb-4 shrink-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#8A98A8] mb-2">Categoria</label>
              <div className="flex flex-wrap gap-2">
                {activeCategories.map((cat) => {
                  const isActive = category === cat.id;
                  let activeClass = '';
                  if (isActive) {
                     activeClass = type === 'income' ? 'bg-[#34D399] text-white' : 'bg-[#F87171] text-white';
                  } else {
                     activeClass = 'bg-[#F4F7FB] dark:bg-[#1A1A1A] text-[#8A98A8]';
                  }

                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id as Transaction['category'])}
                      className={`px-4 h-[40px] rounded-xl text-xs font-bold transition-colors cursor-pointer border-none ${activeClass}`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Descrição */}
            <div className="w-full mb-4 shrink-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#8A98A8] mb-2">Descrição (opcional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Pagamento de energia / Comissão adiantada"
                className={`w-full h-[46px] px-4 rounded-xl border-none ${
                    isDarkMode ? 'bg-[#1A1A1A] text-white placeholder-[#4B5563]' : 'bg-[#F4F7FB] text-slate-800 placeholder-[#9CA3AF]'
                } focus:outline-none focus:ring-2 focus:ring-[#2898D8]/50`}
              />
            </div>

            {/* Data */}
            <div className="w-full mb-6 shrink-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#8A98A8] mb-2">Data</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`w-full h-[46px] px-4 rounded-xl border-none font-medium ${
                    isDarkMode ? 'bg-[#1A1A1A] text-white' : 'bg-[#F4F7FB] text-slate-800'
                } focus:outline-none focus:ring-2 focus:ring-[#2898D8]/50 appearance-none`}
              />
            </div>

            {/* Action */}
            <div className="w-full relative h-[52px] shrink-0">
              {isSuccess ? (
                <div className="w-full h-full flex items-center justify-center bg-[#34D399] text-white rounded-2xl">
                   <motion.div
                     initial={{ scale: 0 }}
                     animate={{ scale: [1.2, 1] }}
                     transition={{ duration: 0.4 }}
                   >
                     <Check size={28} strokeWidth={3} />
                   </motion.div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={amount === 0 || (entryScope === 'staff' && !entryStaffId)}
                  onClick={handleConfirm}
                  className="w-full h-[52px] bg-[#2898D8] text-white rounded-2xl font-bold text-sm disabled:opacity-50 transition-opacity cursor-pointer border-none shadow-lg"
                >
                  Confirmar Lançamento
                </button>
              )}
            </div>
            
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
