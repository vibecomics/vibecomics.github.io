import { useState } from 'react';
import { cb } from '../ai/actions';
import type { ComicProject, MediaItem } from '../types/comic';
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
  entry: { id: string; name: string; description: string; imageIds: string[] };
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
            className="form-control fw-semibold"
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
            onClick={() => {
              if (window.confirm(`Delete ${singular} "${entry.name}"?`)) entries.delete(entry.id);
            }}
          >
            Delete
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
          <ReferenceImages kind={kind} entryId={entry.id} imageIds={entry.imageIds} media={media} />
        )}
      </div>
    </div>
  );
}

/** The characters, objects or scenes of the story bible: add, rename, describe, delete. */
export default function StoryTab({ project, kind }: { project: ComicProject; kind: StoryKind }) {
  const { title, singular } = STORY_TABS[kind];
  const [newName, setNewName] = useState('');
  const entries = project.metadata[kind];

  function add() {
    const name = newName.trim();
    if (!name) return;
    cb()[kind].create({ name });
    setNewName('');
  }

  return (
    <div className="container py-4" style={{ maxWidth: 800 }}>
      <h2 className="h5 mb-3">{title}</h2>
      <div className="input-group mb-4" style={{ maxWidth: 480 }}>
        <input
          className="form-control"
          placeholder={`New ${singular} name`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-primary" disabled={!newName.trim()} onClick={add}>
          Add
        </button>
      </div>
      {entries.map((entry) => (
        <EntryCard key={entry.id} kind={kind} entry={entry} media={project.metadata.media} />
      ))}
      {entries.length === 0 && <p className="text-muted">No {title.toLowerCase()} yet.</p>}
    </div>
  );
}
