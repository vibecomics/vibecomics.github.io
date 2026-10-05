import { PAGE_SIZE_PRESETS } from '../types/comic';

/** One option per standard page size, valued by its index in PAGE_SIZE_PRESETS. */
export default function PageSizeOptions() {
  return (
    <>
      {PAGE_SIZE_PRESETS.map((preset, i) => (
        <option key={preset.label} value={i}>
          {preset.label}
        </option>
      ))}
    </>
  );
}
