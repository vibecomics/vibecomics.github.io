import { useState } from 'react';
import { RefreshIcon } from './Icons';

interface Props {
  /** Reload the open project from Drive. */
  onRefresh: () => Promise<void>;
  /** True while a save is running: refreshing then would race it. */
  disabled: boolean;
}

/** Button that fetches the project fresh from Drive; it shows a spinner while loading. */
export default function RefreshButton({ onRefresh, disabled }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <span title={refreshing ? 'Refreshing…' : 'Refresh from Google Drive'}>
      <button
        type="button"
        className="btn btn-sm btn-outline-light d-flex align-items-center justify-content-center"
        style={{ width: 36, height: 31 }}
        disabled={disabled || refreshing}
        aria-label="Refresh from Google Drive"
        onClick={() => void refresh()}
      >
        {refreshing ? (
          <span
            className="spinner-border spinner-border-sm"
            role="status"
            aria-label="Refreshing"
          />
        ) : (
          <RefreshIcon />
        )}
      </button>
    </span>
  );
}
