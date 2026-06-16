import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const icons = {
  success: <CheckCircle size={16} className="text-green-400" />,
  error: <XCircle size={16} className="text-red-400" />,
  warn: <AlertTriangle size={16} className="text-yellow-400" />,
  info: <Info size={16} className="text-blue-400" />,
};

const borders = {
  success: 'border-green-500/40',
  error: 'border-red-500/40',
  warn: 'border-yellow-500/40',
  info: 'border-blue-500/40',
};

export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-lg border bg-[#151a22] shadow-2xl 
            pointer-events-auto animate-slide-up min-w-[280px] max-w-[400px] ${borders[toast.type]}`}
        >
          <span className="mt-0.5 shrink-0">{icons[toast.type]}</span>
          <span className="text-sm text-slate-200 flex-1 font-sans">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-slate-500 hover:text-slate-300 shrink-0 mt-0.5"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
