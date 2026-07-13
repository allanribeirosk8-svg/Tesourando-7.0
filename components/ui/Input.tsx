import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: boolean;
  warning?: boolean;
  errorMessage?: string;
  requiredField?: boolean;
  optionalField?: boolean;
  icon?: React.ReactNode;
  inputClassName?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, warning, errorMessage, requiredField, optionalField, icon, className = '', inputClassName = '', ...props }) => {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className={`text-[10px] font-bold ml-1 uppercase tracking-widest flex items-center gap-1 ${error || errorMessage ? 'text-red-500' : warning ? 'text-amber-500' : 'text-muted '}`}>
        {label}
        {requiredField && <span className="text-red-500 ml-0.5">*</span>}
        {optionalField && <span className="text-muted  lowercase font-normal ml-1">(opcional)</span>}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
            {icon}
          </div>
        )}
        <input 
          className={`
            w-full ${icon ? 'pl-11' : 'px-4'} py-2.5 rounded-xl border text-sm
            transition-colors focus:outline-none focus:ring-2 
            ${error || errorMessage ? 'border-red-400 focus:ring-red-100' : warning ? 'border-amber-500 focus:ring-amber-100' : ''}
            ${inputClassName || 'bg-surface text-title border-title/30 placeholder-slate-400'}
            ${error || errorMessage ? 'pr-10' : ''}
          `}
          {...props}
        />
        {(error || errorMessage) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500">
            <AlertTriangle size={16} />
          </div>
        )}
      </div>
      {errorMessage && (
        <p className="text-xs text-red-500 ml-1 mt-0.5">{errorMessage}</p>
      )}
    </div>
  );
};