import { useState, useEffect } from 'react';
import { X, Server, Cpu, MemoryStick, HardDrive, Network, Disc, Loader, Check, ChevronRight, AlertCircle } from 'lucide-react';
import * as api from '../api';

const STEPS = ['Basics', 'Resources', 'Storage', 'Network', 'Review'];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-mono font-bold transition-all
            ${i < current ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : i === current ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
            : 'bg-slate-800 text-slate-600 border border-slate-700'}`}>
            {i < current ? <Check size={10} /> : i + 1}
          </div>
          <span className={`text-[10px] font-mono hidden sm:block ${i === current ? 'text-slate-300' : 'text-slate-600'}`}>{s}</span>
          {i < STEPS.length - 1 && <div className="w-4 h-px bg-slate-800 mx-1" />}
        </div>
      ))}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-600 mt-1 font-mono">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', min, max, step }) {
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} min={min} max={max} step={step}
      className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
        font-mono focus:outline-none focus:border-blue-500/60 transition-colors"
    />
  );
}

export default function CreateVMWizard({ onDone, onCancel }) {
  const [step, setStep]       = useState(0);
  const [switches, setSwitches] = useState([]);
  const [isos, setIsos]       = useState([]);
  const [creating, setCreating] = useState(false);
  const [error, setError]     = useState('');

  const [form, setForm] = useState({
    name: '',
    generation: 2,
    ramMB: 2048,
    cpuCount: 2,
    diskGB: 50,
    vhdPath: '',
    isoPath: '',
    switchName: '',
  });

  const set = (field) => (val) => setForm(f => ({ ...f, [field]: val }));

  useEffect(() => {
    (async () => {
      try {
        const [sw, isoData] = await Promise.all([api.listSwitches(), api.listISOs()]);
        setSwitches(Array.isArray(sw) ? sw : []);
        setIsos(isoData?.isos || []);
        // Pre-fill vhd path suggestion
        if (!form.vhdPath) {
          setForm(f => ({ ...f, vhdPath: `C:\\Virtual Machines\\${f.name || 'NewVM'}.vhdx` }));
        }
      } catch {}
    })();
  }, []);

  // Auto-update vhdPath when name changes
  useEffect(() => {
    if (form.name) {
      setForm(f => ({ ...f, vhdPath: `C:\\Virtual Machines\\${form.name}.vhdx` }));
    }
  }, [form.name]);

  const validateStep = () => {
    if (step === 0 && !form.name.trim()) return 'VM name is required';
    if (step === 2 && !form.vhdPath.trim()) return 'VHD path is required';
    return null;
  };

  const next = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError('');
    setStep(s => s + 1);
  };

  const back = () => { setError(''); setStep(s => s - 1); };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      await api.createVM({
        ...form,
        ramMB:    parseInt(form.ramMB),
        cpuCount: parseInt(form.cpuCount),
        diskGB:   parseInt(form.diskGB),
        generation: parseInt(form.generation),
        isoPath:  form.isoPath || undefined,
        switchName: form.switchName || undefined,
      });
      onDone(`VM "${form.name}" created successfully`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setCreating(false);
    }
  };

  const ramOptions = [512, 1024, 2048, 4096, 8192, 16384, 32768];
  const cpuOptions = [1, 2, 4, 6, 8, 12, 16, 32];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-slide-up mx-4 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-blue-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Create Virtual Machine</h3>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        <StepIndicator current={step} />

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mb-4 text-sm text-red-300">
            <AlertCircle size={13} className="shrink-0" />{error}
          </div>
        )}

        {/* Step 0: Basics */}
        {step === 0 && (
          <div>
            <Field label="VM Name" hint="Alphanumeric, hyphens and underscores only">
              <Input value={form.name} onChange={set('name')} placeholder="e.g. web-server-01" />
            </Field>
            <Field label="Generation" hint="Gen 2 recommended for modern Windows/Linux. Use Gen 1 for legacy OS.">
              <div className="grid grid-cols-2 gap-2">
                {[2, 1].map(g => (
                  <button key={g}
                    onClick={() => set('generation')(g)}
                    className={`py-3 rounded-xl border text-sm font-mono font-medium transition-all
                      ${form.generation === g
                        ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                        : 'bg-[#0f1318] border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                    Generation {g}
                    <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                      {g === 2 ? 'UEFI · Secure Boot' : 'BIOS · Legacy'}
                    </div>
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {/* Step 1: Resources */}
        {step === 1 && (
          <div>
            <Field label="RAM" hint={`${form.ramMB >= 1024 ? (form.ramMB / 1024).toFixed(form.ramMB % 1024 === 0 ? 0 : 1) + ' GB' : form.ramMB + ' MB'}`}>
              <div className="grid grid-cols-4 gap-1.5">
                {ramOptions.map(r => (
                  <button key={r}
                    onClick={() => set('ramMB')(r)}
                    className={`py-2 rounded-lg text-xs font-mono transition-all border
                      ${form.ramMB === r
                        ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                        : 'bg-[#0f1318] border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                    {r >= 1024 ? `${r / 1024}GB` : `${r}MB`}
                  </button>
                ))}
                <div className="col-span-4 mt-1">
                  <Input type="number" value={form.ramMB} onChange={set('ramMB')} min={512} max={131072} step={512} placeholder="Custom MB" />
                </div>
              </div>
            </Field>

            <Field label="vCPUs">
              <div className="grid grid-cols-4 gap-1.5">
                {cpuOptions.map(c => (
                  <button key={c}
                    onClick={() => set('cpuCount')(c)}
                    className={`py-2 rounded-lg text-xs font-mono transition-all border
                      ${form.cpuCount === c
                        ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                        : 'bg-[#0f1318] border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                    {c}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {/* Step 2: Storage */}
        {step === 2 && (
          <div>
            <Field label="Disk Size (GB)">
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {[20, 40, 80, 100, 200].map(d => (
                  <button key={d}
                    onClick={() => set('diskGB')(d)}
                    className={`py-2 rounded-lg text-xs font-mono transition-all border
                      ${form.diskGB === d
                        ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                        : 'bg-[#0f1318] border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                    {d}GB
                  </button>
                ))}
              </div>
              <Input type="number" value={form.diskGB} onChange={set('diskGB')} min={1} max={65536} placeholder="Custom GB" />
            </Field>

            <Field label="VHD Path" hint="Full path where the .vhdx file will be created on the host">
              <Input value={form.vhdPath} onChange={set('vhdPath')} placeholder="C:\Virtual Machines\MyVM.vhdx" />
            </Field>

            <Field label="Boot ISO (optional)" hint="Attach an ISO to boot from on first start">
              {isos.length > 0 ? (
                <div className="space-y-1 max-h-36 overflow-y-auto border border-slate-800 rounded-lg">
                  <label className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800/30 cursor-pointer border-b border-slate-800/50">
                    <input type="radio" name="iso" checked={!form.isoPath} onChange={() => set('isoPath')('')} className="accent-blue-500" />
                    <span className="text-xs font-mono text-slate-500">No ISO</span>
                  </label>
                  {isos.map(iso => (
                    <label key={iso.FullName} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800/30 cursor-pointer border-b border-slate-800/50 last:border-0">
                      <input type="radio" name="iso" checked={form.isoPath === iso.FullName}
                        onChange={() => set('isoPath')(iso.FullName)} className="accent-blue-500" />
                      <Disc size={11} className="text-slate-500 shrink-0" />
                      <span className="text-xs font-mono text-slate-300 truncate">{iso.Name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <Input value={form.isoPath} onChange={set('isoPath')} placeholder="C:\ISO\windows-server.iso (or leave blank)" />
              )}
            </Field>
          </div>
        )}

        {/* Step 3: Network */}
        {step === 3 && (
          <div>
            <Field label="Virtual Switch" hint="Connect this VM to a virtual switch on the host">
              <div className="space-y-1 border border-slate-800 rounded-lg overflow-hidden">
                <label className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/30 cursor-pointer border-b border-slate-800/50">
                  <input type="radio" name="switch" checked={!form.switchName} onChange={() => set('switchName')('')} className="accent-blue-500" />
                  <span className="text-xs font-mono text-slate-500">No network (isolated)</span>
                </label>
                {switches.map(sw => (
                  <label key={sw.Name} className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/30 cursor-pointer border-b border-slate-800/50 last:border-0">
                    <input type="radio" name="switch" checked={form.switchName === sw.Name}
                      onChange={() => set('switchName')(sw.Name)} className="accent-blue-500" />
                    <Network size={11} className="text-blue-400 shrink-0" />
                    <div>
                      <div className="text-xs font-mono text-slate-300">{sw.Name}</div>
                      <div className="text-[10px] text-slate-600">{sw.SwitchType}</div>
                    </div>
                  </label>
                ))}
                {switches.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-600 font-mono">No virtual switches found on host</div>
                )}
              </div>
            </Field>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div>
            <div className="bg-[#0f1318] border border-slate-800 rounded-xl p-4 space-y-2.5">
              {[
                { icon: Server,      label: 'Name',       value: form.name },
                { icon: Server,      label: 'Generation', value: `Generation ${form.generation}` },
                { icon: Cpu,         label: 'vCPUs',      value: `${form.cpuCount} vCPU${form.cpuCount > 1 ? 's' : ''}` },
                { icon: MemoryStick, label: 'RAM',        value: form.ramMB >= 1024 ? `${form.ramMB / 1024} GB` : `${form.ramMB} MB` },
                { icon: HardDrive,   label: 'Disk',       value: `${form.diskGB} GB dynamic` },
                { icon: HardDrive,   label: 'VHD Path',   value: form.vhdPath },
                { icon: Disc,        label: 'ISO',        value: form.isoPath ? form.isoPath.split('\\').pop() : 'None' },
                { icon: Network,     label: 'Switch',     value: form.switchName || 'None (isolated)' },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3">
                  <Icon size={12} className="text-slate-500 mt-0.5 shrink-0" />
                  <div className="flex-1 flex items-start justify-between gap-4">
                    <span className="text-xs font-mono text-slate-500">{label}</span>
                    <span className="text-xs font-mono text-slate-300 text-right truncate max-w-[60%]">{value}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600 font-mono mt-3">
              This will create a new Hyper-V VM on the host. The VHD file will be created at the specified path.
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-2 justify-between mt-6">
          <button onClick={step === 0 ? onCancel : back}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={next}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all">
              Next <ChevronRight size={13} />
            </button>
          ) : (
            <button onClick={handleCreate} disabled={creating}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-500 disabled:opacity-60 rounded-lg transition-all">
              {creating ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
              Create VM
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
