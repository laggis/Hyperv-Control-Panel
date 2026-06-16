import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader } from 'lucide-react';

export default function HyperVConsolePage() {
  const { name } = useParams();
  const navigate = useNavigate();
  const vmName = decodeURIComponent(name);

  useEffect(() => {
    navigate(`/vms/${encodeURIComponent(vmName)}/console`, { replace: true });
  }, [vmName, navigate]);

  return (
    <div className="flex flex-col bg-[#0b0e14] min-h-screen">
      <div className="flex-1 relative bg-black overflow-hidden min-h-[500px]">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Loader size={26} className="animate-spin text-blue-400" />
          <div className="text-slate-400 font-mono text-sm">Opening browser console…</div>
        </div>
      </div>
    </div>
  );
}
