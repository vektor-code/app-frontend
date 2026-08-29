/** Official Cloudraft mark from landing, tinted for APM indigo. */
export function CloudraftMark({
  className = '',
  title = 'Cloudraft',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span className={`cloudraft-mark ${className}`.trim()}>
      <img alt={title} className="cloudraft-mark-img light" src="/cloudraft-mark.svg" />
      <img alt="" className="cloudraft-mark-img dark" src="/cloudraft-mark-dark.svg" />
    </span>
  );
}
