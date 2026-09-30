import { cb } from '../ai/actions';
import type { ComicProject, MediaItem, Variation } from '../types/comic';
import { TrashIcon } from './Icons';
import ReferenceImages from './ReferenceImages';

type StoryKind = 'characters' | 'objects' | 'scenes';

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
}

function EntryCard({ kind, entry, media }: EntryCardProps) {
  const { singular, placeholder, referenceImages } = STORY_TABS[kind];
  const entries = cb()[kind];

  return (
    <div className="card mb-3">
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

/** The characters, objects or scenes of the story bible: add, rename, describe, delete. */
export default function StoryTab({ project, kind }: { project: ComicProject; kind: StoryKind }) {
  const { title, singular } = STORY_TABS[kind];
  const entries = project.metadata[kind];

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
        <EntryCard key={entry.id} kind={kind} entry={entry} media={project.metadata.media} />
      ))}
      {entries.length === 0 && <p className="text-muted">No {title.toLowerCase()} yet.</p>}
    </div>
  );
}
