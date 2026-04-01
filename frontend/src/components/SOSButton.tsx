import { useNavigate } from 'react-router-dom';

export default function SOSButton() {
  const nav = useNavigate();
  return (
    <button
      onClick={() => nav('/requester/request')}
      className="w-36 h-36 rounded-full bg-primary text-on-primary flex flex-col items-center justify-center animate-pulse-sos mx-auto cursor-pointer select-none"
      style={{ boxShadow: '0px 12px 32px rgba(183,16,42,0.25)' }}
    >
      <span className="text-3xl font-display font-extrabold leading-none">SOS</span>
      <span className="text-xs mt-1 opacity-80 font-medium">긴급 돌봄 요청</span>
    </button>
  );
}
