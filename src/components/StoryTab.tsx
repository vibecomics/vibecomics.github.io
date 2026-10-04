import { useEffect, useState } from 'react';
import { cb } from '../ai/actions';
import type { StoryKind } from '../ai/builders';
import type { GenerationTarget } from '../ai/generation';
import type { ComicProject, MediaItem, Variation } from '../types/comic';
import { TrashIcon } from './Icons';
import ReferenceImages from './ReferenceImages';

const STORY_TABS = {
  characters: {
    title: 'Characters',
    singular: 'character',
    placeholder: 'Visual description + continuity notes…',
    referenceImages: true,
  },
  objects: {
    title: 'Objects',
    singular: 'object',
    placeholder: 'Shape, size, material, colours, markings, continuity notes…',
    referenceImages: true,
  },
  scenes: {
    title: 'Scenes',
    singular: 'scene',
    placeholder: 'Setting, time of day, mood, lighting…',
    referenceImages: true,
  },
} as const;

interface EntryCardProps {
  kind: StoryKind;
  entry: {
    id: string;
    name: string;
    description: string;
    imageIds: string[];
    variations: Variation[];
  };
  media: MediaItem[];
  highlighted: boolean;
}

function EntryCard({ kind, entry, media, highlighted }: EntryCardProps) {
  const { singular, placeholder, referenceImages } = STORY_TABS[kind];
  const entries = cb()[kind];

  return (
    <div
      id={`entry-${entry.id}`}
      className={`card mb-3${highlighted ? ' border-primary border-2' : ''}`}
    >
      <div className="card-body">
        <div className="d-flex gap-2 align-items-center mb-2">
          <input
            className="form-control fw-semibold fs-4"
            defaultValue={entry.name}
            aria-label={`${singular} name`}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== entry.name) entries.update(entry.id, { name });
              else e.target.value = entry.name;
            }}
          />
          <button
            className="btn btn-outline-danger btn-sm flex-shrink-0"
            title={`Delete this ${singular}`}
            aria-label={`Delete this ${singular}`}
            onClick={() => {
              if (window.confirm(`Delete ${singular} "${entry.name}"?`)) entries.delete(entry.id);
            }}
          >
            <TrashIcon />
          </button>
        </div>
        <textarea
          className="form-control"
          rows={3}
          defaultValue={entry.description}
          aria-label={`${singular} description`}
          placeholder={placeholder}
          onBlur={(e) => {
            if (e.target.value !== entry.description) {
              entries.update(entry.id, { description: e.target.value });
            }
          }}
        />
        {referenceImages && (
          <ReferenceImages
            kind={kind}
            entryId={entry.id}
            imageIds={entry.imageIds}
            variations={entry.variations}
            media={media}
          />
        )}
      </div>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface StoryTabProps {
  project: ComicProject;
  kind: StoryKind;
  /** What the generation queue asked to show; this tab takes it only when it's an entry of this kind. */
  focus: GenerationTarget | null;
  onFocusApplied: () => void;
}

/** The characters, objects or scenes of the story bible: add, rename, describe, delete. */
export default function StoryTab({ project, kind, focus, onFocusApplied }: StoryTabProps) {
  const { title, singular } = STORY_TABS[kind];
  const entries = project.metadata[kind];
  // The entry just shown by the generation queue, lit up for a moment so it's easy to spot.
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    if (focus?.type !== 'reference' || focus.kind !== kind) return;
    setHighlighted(focus.entryId);
    document
      .getElementById(`entry-${focus.entryId}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onFocusApplied();
  }, [focus, kind, onFocusApplied]);

  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => setHighlighted(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  function add() {
    cb()[kind].create({ name: `New ${capitalize(singular)}` });
  }

  return (
    <div className="container py-4" style={{ maxWidth: 800 }}>
      <div className="d-flex align-items-center gap-2 mb-3">
        <h2 className="h5 mb-0">{title}</h2>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          title={`Add a new ${singular}`}
          aria-label={`Add a new ${singular}`}
          onClick={add}
        >
          +
        </button>
      </div>
      {entries.map((entry) => (
        <EntryCard
          key={entry.id}
          kind={kind}
          entry={entry}
          media={project.metadata.media}
          highlighted={entry.id === highlighted}
        />
      ))}
      {entries.length === 0 && <p className="text-muted">No {title.toLowerCase()} yet.</p>}
    </div>
  );
}
