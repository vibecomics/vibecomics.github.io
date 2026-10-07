import { useState } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { SaveState } from '../state/useProjectSaver';
import BackupButton from './BackupButton';
import ConflictDot from './ConflictDot';
import DropdownMenu, { DropdownItem } from './DropdownMenu';
import { EDITOR_TABS } from './editorTabs';
import type { EditorTab } from './editorTabs';
import GeneratorButton from './GeneratorButton';
import { useBusy } from './useBusy';
import RefreshButton from './RefreshButton';
import SaveButton from './SaveButton';

interface Props {
  title: string;
  tab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  saveState: SaveState;
  dirty: boolean;
  /** The open project's own storage connection: picks Save's icon and Backup's direction. */
  backendKind: 'drive' | 'server' | null;
  deviceCode: DeviceCodeInfo | null;
  /** Tabs that hold a conflict with changes made elsewhere. */
  conflictTabs: Set<EditorTab>;
  /** Reload the project from storage. */
  onRefresh: () => Promise<void>;
}

type OpenMenu = 'main' | 'tabs' | null;

export default function EditorNavbar({
  title,
  tab,
  onTabChange,
  saveState,
  dirty,
  backendKind,
  deviceCode,
  conflictTabs,
  onRefresh,
}: Props) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  // Opening the project list and closing a project (which saves first) go to storage.
  const menuTask = useBusy();
  const menuProps = (menu: Exclude<OpenMenu, null>) => ({
    open: openMenu === menu,
    onOpenChange: (open: boolean) => setOpenMenu(open ? menu : null),
    className: 'd-md-none',
  });

  return (
    <nav className="navbar navbar-dark bg-dark flex-nowrap gap-2 px-3">
      <DropdownMenu
        {...menuProps('main')}
        toggleDisabled={menuTask.busy}
        toggle={
          menuTask.busy ? (
            <span className="spinner-border spinner-border-sm" role="status" aria-label="Working" />
          ) : (
            <span className="navbar-toggler-icon" />
          )
        }
        toggleClassName="btn btn-outline-light btn-sm"
        toggleLabel="Menu"
      >
        <DropdownItem onClick={() => void menuTask.run(() => cb().storage.showProjects())}>
          Open project
        </DropdownItem>
        <DropdownItem onClick={() => cb().page.openPreview()}>Preview this page</DropdownItem>
        <DropdownItem onClick={() => void menuTask.run(() => cb().storage.closeProject())}>
          Close project
        </DropdownItem>
      </DropdownMenu>

      <span className="navbar-brand mb-0 h1 fs-5 text-truncate me-auto">{title}</span>

      <GeneratorButton />

      <DropdownMenu
        {...menuProps('tabs')}
        align="end"
        toggle={
          <>
            {EDITOR_TABS.find((t) => t.id === tab)?.label}
            {conflictTabs.size > 0 && <ConflictDot className="ms-1" />}
          </>
        }
        toggleClassName="btn btn-outline-light btn-sm dropdown-toggle"
      >
        {EDITOR_TABS.map((t) => (
          <DropdownItem key={t.id} active={t.id === tab} onClick={() => onTabChange(t.id)}>
            {t.label}
            {conflictTabs.has(t.id) && <ConflictDot className="ms-2" />}
          </DropdownItem>
        ))}
      </DropdownMenu>

      <RefreshButton onRefresh={onRefresh} disabled={saveState === 'saving'} />
      <SaveButton state={saveState} dirty={dirty} backendKind={backendKind} />
      <BackupButton
        backendKind={backendKind}
        deviceCode={deviceCode}
        disabled={saveState === 'saving'}
      />
    </nav>
  );
}
