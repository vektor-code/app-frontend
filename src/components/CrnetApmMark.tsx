import { CloudraftMark } from './CloudraftMark';

export default function CrnetApmMark({ size = 40 }: { size?: number; color?: string }) {
  return (
    <span className="apm-brand-mark-wrap" style={{ height: size, display: 'inline-flex' }}>
      <CloudraftMark className="apm-brand-mark" title="Cloudraft" />
    </span>
  );
}

export { CloudraftMark };
